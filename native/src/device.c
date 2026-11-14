#define _POSIX_C_SOURCE 200809L
#include "ibm.h"
#include <stdlib.h>
#include <string.h>

#define PI 3.14159265358979323846
#define MAX_DEVICE 1024
#define MAX_INSTRUCTIONS 500000

enum Edge { CX = 1, CZ = 2, ECR = 4 };

typedef struct {
    unsigned n, layout[KET_MAX_QUBITS];
    unsigned char *edges;
    size_t emitted;
    FILE *out;
    KetDiagnostic *error;
} Device;

static void fail(Device *d, const char *message) {
    if (!d->error->message[0]) snprintf(d->error->message, sizeof(d->error->message), "%s", message);
}

static bool array_has(json_object *array, const char *name) {
    if (!json_object_is_type(array, json_type_array)) return false;
    for (size_t i = 0; i < json_object_array_length(array); ++i) {
        json_object *item = json_object_array_get_idx(array, i);
        if (json_object_is_type(item, json_type_string) && !strcmp(json_object_get_string(item), name)) return true;
    }
    return false;
}

static bool read_edges(Device *d, json_object *map, enum Edge gate) {
    if (!json_object_is_type(map, json_type_array)) return false;
    for (size_t i = 0; i < json_object_array_length(map); i++) {
        json_object *pair = json_object_array_get_idx(map, i);
        if (!json_object_is_type(pair, json_type_array) || json_object_array_length(pair) != 2) return false;
        unsigned q[2];
        for (unsigned j = 0; j < 2; j++) {
            json_object *item = json_object_array_get_idx(pair, j);
            if (!json_object_is_type(item, json_type_int)) return false;
            int64_t value = json_object_get_int64(item);
            if (value < 0 || value >= d->n) return false;
            q[j] = (unsigned)value;
        }
        d->edges[q[0]*d->n+q[1]] |= gate;
    }
    return true;
}

/* the fixed layout is restored after each routed gate, including conditional gates. */
static size_t neighbours(Device *d, unsigned start, int *parent, unsigned *order, unsigned target) {
    for (unsigned i = 0; i < d->n; i++) parent[i] = -1;
    order[0] = start;
    parent[start] = (int)start;
    size_t length = 1;
    for (size_t i = 0; i < length; i++) {
        unsigned a = order[i];
        if (a == target) break;
        for (unsigned b = 0; b < d->n; b++) {
            if (parent[b] >= 0 || !(d->edges[a*d->n+b] | d->edges[b*d->n+a])) continue;
            parent[b] = (int)a;
            order[length++] = b;
        }
    }
    return length;
}

static bool configure(Device *d, json_object *config, unsigned qubits) {
    int n = json_object_get_int(json_object_object_get(config, "n_qubits"));
    json_object *basis = json_object_object_get(config, "basis_gates");
    if (n < (int)qubits || n > MAX_DEVICE || !array_has(basis, "rz") ||
        !array_has(basis, "sx") || !array_has(basis, "x")) {
        fail(d, "IBM device needs enough qubits and the rz, sx and x gates"); return false;
    }
    d->n = (unsigned)n;
    d->edges = calloc((size_t)n*n, 1);
    if (!d->edges) { fail(d, "out of memory reading device connections"); return false; }
    json_object *gates = json_object_object_get(config, "gates");
    const char *const names[] = {"cx", "cz", "ecr"};
    for (unsigned k = 0; k < 3; k++) {
        if (!array_has(basis, names[k])) continue;
        json_object *map = json_object_object_get(config, "coupling_map");
        if (json_object_is_type(gates, json_type_array)) {
            for (size_t i = 0; i < json_object_array_length(gates); i++) {
                json_object *g = json_object_array_get_idx(gates, i);
                json_object *name = json_object_object_get(g, "name"), *specific = NULL;
                if (name && !strcmp(json_object_get_string(name), names[k]) &&
                    json_object_object_get_ex(g, "coupling_map", &specific) && specific) map = specific;
            }
        }
        if (map && !read_edges(d, map, (enum Edge)(1u << k))) {
            fail(d, "invalid coupling map from IBM"); return false;
        }
    }
    int parent[MAX_DEVICE];
    bool seen[MAX_DEVICE] = {false};
    unsigned order[MAX_DEVICE];
    for (unsigned start = 0; start < d->n; start++) {
        if (seen[start]) continue;
        size_t length = neighbours(d, start, parent, order, d->n);
        if (length >= qubits) {
            memcpy(d->layout, order, qubits*sizeof(*order)); return true;
        }
        for (size_t j = 0; j < length; j++) seen[order[j]] = true;
    }
    fail(d, "device has too few connected qubits with cx, cz or ecr gates"); return false;
}

static bool emit(Device *d) {
    if (d->error->message[0]) return false;
    if (++d->emitted <= MAX_INSTRUCTIONS) return true;
    fail(d, "IBM circuit exceeds 500000 physical instructions"); return false;
}
static void one(Device *d, const char *gate, unsigned q) {
    if (emit(d)) fprintf(d->out, "%s $%u;\n", gate, q);
}
static void two(Device *d, const char *gate, unsigned a, unsigned b) {
    if (emit(d)) fprintf(d->out, "%s $%u,$%u;\n", gate, a, b);
}
static void rz(Device *d, unsigned q, double angle) {
    if (emit(d)) fprintf(d->out, "rz(%#.17g) $%u;\n", angle, q);
}
static void h(Device *d, unsigned q) {
    rz(d, q, PI/2); one(d, "sx", q); rz(d, q, PI/2);
}

static void adjacent_cx(Device *d, unsigned a, unsigned b) {
    unsigned edge = d->edges[a*d->n+b];
    unsigned back = d->edges[b*d->n+a];
    if (edge & CX) { two(d, "cx", a, b); return; }
    if ((edge | back) & CZ) {
        h(d, b);
        if (edge & CZ) two(d, "cz", a, b); else two(d, "cz", b, a);
        h(d, b); return;
    }
    if (edge & ECR) {
        rz(d, a, -PI/2);
        one(d, "sx", b); one(d, "x", b);
        two(d, "ecr", a, b); one(d, "x", a); return;
    }
    if (!(back & (CX | ECR))) { fail(d, "missing IBM two-qubit connection"); return; }
    h(d, a); h(d, b);
    adjacent_cx(d, b, a);
    h(d, a); h(d, b);
}
static void swap_edge(Device *d, unsigned a, unsigned b) {
    adjacent_cx(d, a, b); adjacent_cx(d, b, a); adjacent_cx(d, a, b);
}
static void cx(Device *d, unsigned a, unsigned b) {
    if (d->error->message[0]) return;
    if (d->edges[a*d->n+b] || d->edges[b*d->n+a]) { adjacent_cx(d, a, b); return; }
    int parent[MAX_DEVICE];
    unsigned path[MAX_DEVICE];
    neighbours(d, a, parent, path, b);
    if (parent[b] < 0) { fail(d, "no route between IBM qubits"); return; }
    size_t n = 0;
    for (unsigned i = b; i != a; i = (unsigned)parent[i]) path[n++] = i;
    path[n++] = a;
    for (size_t i = n-1; i > 1; i--) swap_edge(d, path[i], path[i-1]);
    adjacent_cx(d, path[1], path[0]);
    for (size_t i = 1; i+1 < n; i++) swap_edge(d, path[i], path[i+1]);
}
static void ccx(Device *d, unsigned a, unsigned b, unsigned t) {
    h(d,t); cx(d,b,t); rz(d,t,-PI/4); cx(d,a,t); rz(d,t,PI/4);
    cx(d,b,t); rz(d,t,-PI/4); cx(d,a,t); rz(d,b,PI/4); rz(d,t,PI/4);
    h(d,t); cx(d,a,b); rz(d,a,PI/4); rz(d,b,-PI/4); cx(d,a,b);
}
static void gate(Device *d, const KetOp *op) {
    unsigned a = d->layout[op->q[0]];
    unsigned b = ket_arity(op->kind) > 1 ? d->layout[op->q[1]] : 0;
    double angle = op->angle;
    switch (op->kind) {
        case K_H: h(d,a); break;
        case K_X: one(d,"x",a); break;
        case K_Y: one(d,"x",a); rz(d,a,PI); break;
        case K_Z: rz(d,a,PI); break;
        case K_S: rz(d,a,PI/2); break;
        case K_T: rz(d,a,PI/4); break;
        case K_RZ: case K_PHASE: rz(d,a,angle); break;
        case K_RX: h(d,a); rz(d,a,angle); h(d,a); break;
        case K_RY: rz(d,a,-PI/2); h(d,a); rz(d,a,angle); h(d,a); rz(d,a,PI/2); break;
        case K_CX: cx(d,a,b); break;
        case K_CZ: h(d,b); cx(d,a,b); h(d,b); break;
        case K_SWAP: cx(d,a,b); cx(d,b,a); cx(d,a,b); break;
        case K_CP: rz(d,a,angle/2); cx(d,a,b); rz(d,b,-angle/2); cx(d,a,b); rz(d,b,angle/2); break;
        case K_CCX: ccx(d,a,b,d->layout[op->q[2]]); break;
        case K_MEASURE: case K_IF: break;
    }
}

char *ibm_assembly(const KetProgram *p, json_object *config, KetDiagnostic *error) {
    if (!ket_validate(p, error)) return NULL;
    Device d = {.error=error};
    char *text = NULL;
    size_t size = 0;
    if (configure(&d, config, p->qubits)) {
        d.out = open_memstream(&text, &size);
        if (!d.out) fail(&d, "out of memory generating IBM assembly");
    }
    if (d.out) {
        fputs("OPENQASM 3.0;\ninclude \"stdgates.inc\";\n", d.out);
        if (array_has(json_object_object_get(config, "basis_gates"), "ecr"))
            fputs("gate ecr a,b { s a; sx b; cx a,b; x a; }\n", d.out);
        for (unsigned i = 0; i < p->nclassical; i++)
            fprintf(d.out, "bit[%u] m%u;\n", p->classical[i].width, i);
        size_t end = 0;
        for (size_t i = 0; i < p->count && !error->message[0]; i++) {
            const KetOp *op = &p->ops[i];
            error->span = op->span;
            if (end && i == end) { fputs("}\n", d.out); end = 0; }
            if (op->kind == K_IF) {
                if (end) { fail(&d, "nested conditions are unsupported on IBM hardware"); break; }
                fprintf(d.out, "if (m%u == %u) {\n", op->classical, op->value);
                end = op->end;
            } else if (op->kind == K_MEASURE) {
                for (unsigned j = 0; j < op->width; j++) if (emit(&d))
                    fprintf(d.out, "m%u[%u] = measure $%u;\n", op->classical, op->width-1-j, d.layout[op->q[0]+j]);
            } else gate(&d, op);
        }
        if (end) fputs("}\n", d.out);
        bool written = !ferror(d.out);
        if (fclose(d.out) || !written) fail(&d, "could not finish IBM assembly");
    }
    free(d.edges);
    if (error->message[0]) { free(text); return NULL; }
    return text;
}
