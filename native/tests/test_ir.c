#include "ir.h"
#include <assert.h>
#include <math.h>
#include <string.h>

static void rejected(const KetProgram *p) {
    KetDiagnostic e;
    KetResult r;
    KetState s;
    FILE *out = tmpfile();
    assert(out);
    assert(!ket_run(p, 1, 42, &r, &e) && strstr(e.message, "invalid circuit"));
    assert(!ket_inspect(p, &s, &e) && strstr(e.message, "invalid circuit"));
    assert(!ket_qasm(p, out, &e) && ftell(out) == 0);
    ket_result_free(&r); ket_state_free(&s); fclose(out);
}

int main(void) {
    KetProgram *p; KetDiagnostic e; KetResult r;
    assert(ket_compile("qubit q[2] X q[0] let a = measure q[0] let b = measure q[1]", &p, &e));
    KetProgramInfo info = ket_program_info(p);
    assert(info.qubits == 2 && info.bits == 2 && info.measurements == 2 && info.operations == 3 && !info.remote);
    unsigned width;
    assert(!strcmp(ket_measurement_name(p, 0, &width), "a") && width == 1);
    assert(!ket_measurement_name(p, info.measurements, &width) && width == 0);
    p->ops[1].classical = 1; p->ops[2].classical = 0;
    assert(ket_run(p, 4, 0, &r, &e) && r.counts[1] == 4);
    ket_result_free(&r);
    KetOp last = p->ops[2];
    p->ops[2].classical = 1; rejected(p);
    p->ops[1].classical = p->ops[2].classical = 0;
    p->bits = p->nclassical = 1; rejected(p);
    p->bits = p->nclassical = 2; p->ops[1].classical = 1; p->ops[2] = last;
    p->ops[2].q[0] = 99; rejected(p); p->ops[2] = last;
    p->ops[2].width = 3; rejected(p); p->ops[2] = last;
    p->ops[2].classical = 77; rejected(p); p->ops[2] = last;
    p->ops[2].kind = (KetOpKind)999; rejected(p); p->ops[2] = last;
    p->ops[0].angle = NAN; rejected(p); p->ops[0].angle = 0;
    p->qubits = 65; rejected(p); p->qubits = 2;
    p->bits = 32; rejected(p); p->bits = 2;
    p->nclassical = 21; rejected(p); p->nclassical = 2;
    p->ops[0] = (KetOp){.kind=K_IF, .end=1}; rejected(p);
    ket_program_free(p);
    assert(ket_compile("qubit q[2] let a = measure q[0] if a == 1 { X q[1] } let b = measure q[1]", &p, &e));
    p->ops[1].end = 0; rejected(p);
    p->ops[1].end = p->count+1; rejected(p);
    p->ops[1].end = p->count; rejected(p);
    p->ops[1].end = 3; p->ops[1].value = 9; rejected(p);
    p->ops[1].value = 1; p->ops[0].classical = 1; p->ops[1].classical = 1; p->ops[3].classical = 0;
    p->ops[2].kind = K_X; p->ops[1].value = 0;
    assert(ket_run(p, 8, 0, &r, &e) && r.counts[2] == 8);
    ket_result_free(&r); ket_program_free(p);
    rejected(NULL);
    puts("C API regression cases passed");
}
