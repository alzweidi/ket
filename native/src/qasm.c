#include "ir.h"
#include <string.h>

static void prefix(FILE *out, const KetOp *condition) {
    if (condition) fprintf(out, "if(m%u==%u) ", condition->classical, condition->value);
}

static void write_cx(FILE *out, const KetOp *condition, unsigned control, unsigned target) {
    prefix(out, condition);
    fprintf(out, "cx q[%u],q[%u];\n", control, target);
}

bool ket_qasm(const KetProgram *p, FILE *out, KetDiagnostic *e) {
    if (!ket_validate(p, e)) return false;
    /* openqasm 2 cannot combine arbitrary conditions; reject before writing. */
    size_t conditional_end = 0;
    for (size_t i = 0; i < p->count; i++) if (p->ops[i].kind == K_IF) {
        if (i < conditional_end) {
            e->span = p->ops[i].span;
            strcpy(e->message, "OpenQASM 2 export does not support nested classical conditions");
            return false;
        }
        conditional_end = p->ops[i].end;
    }
    fputs("OPENQASM 2.0;\ninclude \"qelib1.inc\";\n\n", out);
    fprintf(out, "qreg q[%u];\n", p->qubits);
    for (unsigned i = 0; i < p->nclassical; i++)
        fprintf(out, "creg m%u[%u]; // %s; most significant bit printed first\n", i, p->classical[i].width, p->classical[i].name);
    fputc('\n', out);
    static const char *const names[] = {
        [K_H]="h", [K_X]="x", [K_Y]="y", [K_Z]="z", [K_S]="s", [K_T]="t",
        [K_RX]="rx", [K_RY]="ry", [K_RZ]="rz", [K_CZ]="cz",
        [K_CCX]="ccx", [K_CP]="cu1", [K_PHASE]="u1"
    };
    const KetOp *condition = NULL;
    for (size_t i = 0; i < p->count; i++) {
        const KetOp *op = &p->ops[i];
        if (condition && i >= condition->end) condition = NULL;
        if (op->kind == K_IF) { condition = op; continue; }
        if (op->kind == K_MEASURE) {
            for (unsigned j = 0; j < op->width; j++) {
                prefix(out, condition);
                fprintf(out, "measure q[%u] -> m%u[%u];\n", op->q[0]+j, op->classical, op->width-1-j);
            }
        } else if (op->kind == K_CX || op->kind == K_SWAP) {
            unsigned a = op->q[0], b = op->q[1];
            write_cx(out, condition, a, b);
            if (op->kind == K_SWAP) {
                /* qelib1 has no swap. the condition must guard all three gates. */
                write_cx(out, condition, b, a);
                write_cx(out, condition, a, b);
            }
        } else {
            prefix(out, condition);
            fputs(names[op->kind], out);
            if ((op->kind >= K_RX && op->kind <= K_RZ) || op->kind == K_CP || op->kind == K_PHASE)
                fprintf(out, "(%#.17g)", op->angle);
            fprintf(out, " q[%u]", op->q[0]);
            if (op->kind >= K_CX && op->kind <= K_CP) fprintf(out, ",q[%u]", op->q[1]);
            if (op->kind == K_CCX) fprintf(out, ",q[%u]", op->q[2]);
            fputs(";\n", out);
        }
    }
    if (ferror(out)) { strcpy(e->message, "could not write OpenQASM output"); return false; }
    return true;
}
