#include "ir.h"
#include <ctype.h>
#include <math.h>
#include <string.h>

KetProgramInfo ket_program_info(const KetProgram *p) {
    if (!p) return (KetProgramInfo){0};
    return (KetProgramInfo){.qubits=p->qubits, .bits=p->bits, .measurements=p->nclassical,
                            .operations=p->count, .remote=p->remote};
}

const char *ket_measurement_name(const KetProgram *p, unsigned i, unsigned *width) {
    if (width) *width = 0;
    if (!p || i >= p->nclassical || i >= KET_MAX_QUBITS) return NULL;
    if (width) *width = p->classical[i].width;
    return p->classical[i].name;
}

unsigned ket_arity(KetOpKind kind) {
    if (kind == K_CCX) return 3;
    if (kind == K_CX || kind == K_CZ || kind == K_SWAP || kind == K_CP) return 2;
    return 1;
}

static bool invalid(KetDiagnostic *error, const KetOp *op, const char *message) {
    if (op) error->span = op->span;
    snprintf(error->message, sizeof(error->message), "invalid circuit: %s", message);
    return false;
}

bool ket_validate(const KetProgram *p, KetDiagnostic *error) {
    *error = (KetDiagnostic){0};
    if (!p || p->qubits == 0 || p->qubits > KET_MAX_QUBITS ||
        p->bits == 0 || p->bits > p->qubits || p->nclassical == 0 || p->nclassical > p->bits)
        return invalid(error, NULL, "invalid register dimensions");
    if (!p->ops || !p->count || p->count > p->capacity || p->count > KET_MAX_OPS)
        return invalid(error, NULL, "invalid operation count");
    unsigned bits = 0;
    for (unsigned i = 0; i < p->nclassical; i++) {
        const KetClassical *reg = &p->classical[i];
        if (!reg->width || reg->width > p->bits || !reg->name[0] ||
            !memchr(reg->name, 0, sizeof(reg->name)))
            return invalid(error, NULL, "invalid measurement binding");
        for (const unsigned char *s = (const unsigned char *)reg->name; *s; ++s)
            if (!isalnum(*s) && *s != '_') return invalid(error, NULL, "invalid binding name");
        bits += reg->width;
    }
    if (bits != p->bits) return invalid(error, NULL, "inconsistent result width");

    size_t ends[64], depth = 0;
    uint32_t assigned = 0, consumed = 0;
    for (size_t i = 0; i < p->count; i++) {
        const KetOp *op = &p->ops[i];
        while (depth && ends[depth-1] == i) depth--;
        if ((unsigned)op->kind > K_IF) return invalid(error, op, "unknown instruction");
        if (op->kind == K_IF || op->kind == K_MEASURE) {
            if (op->classical >= p->nclassical) return invalid(error, op, "unknown measurement binding");
            uint32_t binding = 1u << op->classical;
            if (op->kind == K_IF) {
                if (!(assigned & binding)) return invalid(error, op, "condition precedes its measurement");
                if (op->value >= (1u << p->classical[op->classical].width) ||
                    op->end <= i || op->end > (depth ? ends[depth-1] : p->count) || depth == 64)
                    return invalid(error, op, "invalid conditional block");
                ends[depth++] = op->end;
                continue;
            }
            if (depth || (assigned & binding) || op->width != p->classical[op->classical].width)
                return invalid(error, op, "invalid or repeated measurement assignment");
            assigned |= binding;
        }
        unsigned width = op->kind == K_MEASURE ? op->width : ket_arity(op->kind);
        uint32_t operands = 0;
        for (unsigned j = 0; j < width; j++) {
            if (op->kind == K_MEASURE && op->q[0] > p->qubits - width)
                return invalid(error, op, "measurement outside the quantum register");
            unsigned q = op->kind == K_MEASURE ? op->q[0] + j : op->q[j];
            if (q >= p->qubits) return invalid(error, op, "qubit index outside the register");
            uint32_t bit = 1u << q;
            if ((consumed | operands) & bit) return invalid(error, op, "repeated or consumed qubit");
            operands |= bit;
        }
        if (op->kind == K_MEASURE) consumed |= operands;
        if (!isfinite(op->angle)) return invalid(error, op, "non-finite gate angle");
    }
    if (assigned != (1u << p->nclassical) - 1) return invalid(error, NULL, "missing measurement");
    return true;
}
