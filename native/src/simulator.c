#include "ir.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

#define PI 3.14159265358979323846264338327950288

static double norm(double complex a) { return creal(a)*creal(a) + cimag(a)*cimag(a); }

/* splitmix64 keeps the random stream local to each run. */
static double random_unit(uint64_t *state) {
    uint64_t z = (*state += UINT64_C(0x9e3779b97f4a7c15));
    z = (z ^ (z >> 30)) * UINT64_C(0xbf58476d1ce4e5b9);
    z = (z ^ (z >> 27)) * UINT64_C(0x94d049bb133111eb);
    z ^= z >> 31;
    return (double)(z >> 11) * 0x1.0p-53;
}
static bool init_state(unsigned qubits, KetState *s, KetDiagnostic *e) {
    memset(s, 0, sizeof(*s));
    s->qubits = qubits; s->size = (size_t)1 << qubits;
    s->amplitudes = calloc(s->size, sizeof(*s->amplitudes));
    if (!s->amplitudes) { strcpy(e->message, "out of memory allocating the state vector"); return false; }
    s->amplitudes[0] = 1; return true;
}

static size_t mask(const KetState *s, unsigned q) { return (size_t)1 << (s->qubits-1-q); }

static void single(KetState *s, unsigned q, size_t controls,
                   double complex a, double complex b, double complex c, double complex d) {
    size_t bit = mask(s, q);
    for (size_t i = 0; i < s->size; i++) {
        if ((i & bit) || (i & controls) != controls) continue;
        size_t j = i | bit;
        double complex x = s->amplitudes[i], y = s->amplitudes[j];
        s->amplitudes[i] = a*x + b*y; s->amplitudes[j] = c*x + d*y;
    }
}

static void apply(KetState *s, const KetOp *op) {
    unsigned q = op->q[0];
    double cs = cos(op->angle/2), sn = sin(op->angle/2);
    switch (op->kind) {
        case K_H: {
            double h = 1/sqrt(2.0); single(s, q, 0, h, h, h, -h); break;
        }
        case K_X: single(s, q, 0, 0, 1, 1, 0); break;
        case K_Y: single(s, q, 0, 0, -I, I, 0); break;
        case K_Z: single(s, q, 0, 1, 0, 0, -1); break;
        case K_S: single(s, q, 0, 1, 0, 0, I); break;
        case K_T: single(s, q, 0, 1, 0, 0, cexp(I*PI/4)); break;
        case K_RX: single(s, q, 0, cs, -I*sn, -I*sn, cs); break;
        case K_RY: single(s, q, 0, cs, -sn, sn, cs); break;
        case K_RZ: single(s, q, 0, cexp(-I*op->angle/2), 0, 0, cexp(I*op->angle/2)); break;
        case K_PHASE: single(s, q, 0, 1, 0, 0, cexp(I*op->angle)); break;
        case K_CX: single(s, op->q[1], mask(s,q), 0, 1, 1, 0); break;
        case K_CZ: single(s, op->q[1], mask(s,q), 1, 0, 0, -1); break;
        case K_CP: single(s, op->q[1], mask(s,q), 1, 0, 0, cexp(I*op->angle)); break;
        case K_CCX: single(s, op->q[2], mask(s,q)|mask(s,op->q[1]), 0, 1, 1, 0); break;
        case K_SWAP: {
            size_t a = mask(s,q), b = mask(s,op->q[1]);
            for (size_t i = 0; i < s->size; i++) if ((i & a) && !(i & b)) {
                size_t j = i ^ a ^ b;
                double complex temp = s->amplitudes[i]; s->amplitudes[i] = s->amplitudes[j]; s->amplitudes[j] = temp;
            }
            break;
        }
        case K_MEASURE: case K_IF: break;
    }
}

static unsigned measure(KetState *s, unsigned q, uint64_t *rng) {
    size_t bit = mask(s,q);
    double p0 = 0, p1 = 0;
    for (size_t i = 0; i < s->size; i++) {
        if (i & bit) p1 += norm(s->amplitudes[i]); else p0 += norm(s->amplitudes[i]);
    }
    unsigned result = random_unit(rng) * (p0+p1) < p1;
    /* rounding must not select a zero-probability branch. */
    if ((result ? p1 : p0) <= 0) result ^= 1;
    double scale = 1 / sqrt(result ? p1 : p0);
    for (size_t i = 0; i < s->size; i++) {
        if (((i & bit) != 0) == (result != 0)) s->amplitudes[i] *= scale;
        else s->amplitudes[i] = 0;
    }
    return result;
}

bool ket_inspect(const KetProgram *p, KetState *s, KetDiagnostic *e) {
    memset(s, 0, sizeof(*s));
    if (!ket_validate(p, e)) return false;
    bool seen_measure = false;
    for (size_t i = 0; i < p->count; i++) {
        if (p->ops[i].kind == K_MEASURE) seen_measure = true;
        else if (seen_measure) {
            e->span = p->ops[i].span;
            strcpy(e->message, "inspect requires terminal measurements; use run for measurement-dependent circuits");
            return false;
        }
    }
    if (!init_state(p->qubits, s, e)) return false;
    for (size_t i = 0; i < p->count && p->ops[i].kind != K_MEASURE; i++) apply(s, &p->ops[i]);
    return true;
}

static uint32_t pack_result(const KetProgram *p, const uint32_t *values) {
    uint32_t result = 0;
    for (unsigned i = 0; i < p->nclassical; i++)
        result = (result << p->classical[i].width) | values[i];
    return result;
}

/* terminal measurements can sample one distribution without collapsing a fresh
   state for each shot. selecting the requested bits also handles partial reads. */
static bool sample_terminal(const KetProgram *p, const KetState *s, size_t first,
                            uint64_t *rng, KetResult *r, KetDiagnostic *e) {
    double *cdf = malloc(s->size * sizeof(*cdf));
    if (!cdf) { strcpy(e->message, "out of memory allocating the sampling distribution"); return false; }
    double total = 0;
    for (size_t i = 0; i < s->size; i++) { total += norm(s->amplitudes[i]); cdf[i] = total; }
    if (!(total > 0) || !isfinite(total)) {
        free(cdf); strcpy(e->message, "state has an invalid norm"); return false;
    }
    for (uint64_t shot = 0; shot < r->shots; shot++) {
        double target = random_unit(rng) * total;
        size_t low = 0, high = s->size-1;
        while (low < high) {
            size_t middle = low + (high-low)/2;
            if (cdf[middle] > target) high = middle;
            else low = middle+1;
        }
        uint32_t values[KET_MAX_QUBITS] = {0};
        for (size_t i = first; i < p->count; i++) {
            const KetOp *op = &p->ops[i];
            uint32_t value = 0;
            for (unsigned j = 0; j < op->width; j++)
                value = (value << 1) | ((low & mask(s, op->q[0]+j)) != 0);
            values[op->classical] = value;
        }
        r->counts[pack_result(p, values)]++;
    }
    free(cdf); return true;
}

bool ket_run(const KetProgram *p, uint64_t shots, uint64_t seed, KetResult *r, KetDiagnostic *e) {
    memset(r, 0, sizeof(*r));
    if (!ket_validate(p, e)) return false;
    if (shots < 1 || shots > 1000000) { strcpy(e->message, "shots must be between 1 and 1000000"); return false; }
    KetState s;
    if (!init_state(p->qubits, &s, e)) return false;
    r->bits = p->bits; r->shots = shots; r->seed = seed;
    r->counts = calloc((size_t)1 << r->bits, sizeof(*r->counts));
    if (!r->counts) { ket_state_free(&s); strcpy(e->message, "out of memory allocating counts"); return false; }

    size_t first_measure = 0;
    while (first_measure < p->count && p->ops[first_measure].kind != K_MEASURE &&
           p->ops[first_measure].kind != K_IF) first_measure++;
    for (size_t i = 0; i < first_measure; i++) apply(&s, &p->ops[i]);
    bool terminal = true;
    for (size_t i = first_measure; i < p->count; i++) if (p->ops[i].kind != K_MEASURE) terminal = false;
    uint64_t rng = seed;
    if (terminal) {
        bool ok = sample_terminal(p, &s, first_measure, &rng, r, e);
        if (!ok) ket_result_free(r);
        ket_state_free(&s); return ok;
    }
    double complex *prefix = malloc(s.size * sizeof(*prefix));
    if (!prefix) { ket_state_free(&s); ket_result_free(r); strcpy(e->message, "out of memory caching the unitary prefix"); return false; }
    memcpy(prefix, s.amplitudes, s.size * sizeof(*prefix));

    for (uint64_t shot = 0; shot < shots; shot++) {
        if (shot) memcpy(s.amplitudes, prefix, s.size * sizeof(*prefix));
        uint32_t classical[KET_MAX_QUBITS] = {0};
        for (size_t pc = first_measure; pc < p->count; pc++) {
            const KetOp *op = &p->ops[pc];
            if (op->kind == K_IF) {
                if (classical[op->classical] != op->value) pc = op->end - 1;
            } else if (op->kind == K_MEASURE) {
                uint32_t bits = 0;
                for (unsigned j = 0; j < op->width; j++) bits = (bits << 1) | measure(&s, op->q[0]+j, &rng);
                classical[op->classical] = bits;
            } else apply(&s, op);
        }
        r->counts[pack_result(p, classical)]++;
    }
    free(prefix); ket_state_free(&s); return true;
}
void ket_state_free(KetState *s) { free(s->amplitudes); memset(s, 0, sizeof(*s)); }
void ket_result_free(KetResult *r) { free(r->counts); memset(r, 0, sizeof(*r)); }
