#define _POSIX_C_SOURCE 200809L
#include "output.h"
#include "ir.h"
#include <stdlib.h>
#include <string.h>

static void quoted(FILE *out, const char *text) {
    fputc('"', out);
    for (const unsigned char *p = (const unsigned char *)text; *p; p++) {
        if (*p == '"' || *p == '\\') fputc('\\', out);
        if (*p < 32) fprintf(out, "\\u%04x", *p);
        else fputc(*p, out);
    }
    fputc('"', out);
}

static void diagnostic(FILE *out, const KetDiagnostic *e) {
    fprintf(out, "{\"line\":%u,\"column\":%u,\"message\":", e->span.line, e->span.column);
    quoted(out, e->message);
    fputc('}', out);
}

static void circuit(FILE *out, const KetProgram *p) {
    static const char *const names[] = {
        "H","X","Y","Z","S","T","Rx","Ry","Rz","CX","CZ","SWAP","CCX","CP","P","M","if"
    };
    fprintf(out, "{\"qubits\":%u,\"total\":%zu,\"ops\":[", p->qubits, p->count);
    for (size_t i = 0; i < p->count && i < 160; i++) {
        const KetOp *op = &p->ops[i];
        fprintf(out, "%s{\"gate\":\"%s\",\"line\":%u,\"q\":[", i ? "," : "", names[op->kind], op->span.line);
        unsigned n = op->kind == K_IF ? 0 : op->kind == K_MEASURE ? op->width : ket_arity(op->kind);
        for (unsigned j = 0; j < n; j++) fprintf(out, "%s%u", j ? "," : "", op->kind == K_MEASURE ? op->q[0]+j : op->q[j]);
        fputc(']', out);
        if (op->kind == K_MEASURE || op->kind == K_IF) {
            fputs(",\"binding\":", out);
            quoted(out, p->classical[op->classical].name);
        }
        if (op->kind == K_IF) fprintf(out, ",\"equals\":%u,\"end\":%zu", op->value, op->end);
        if ((op->kind >= K_RX && op->kind <= K_RZ) || op->kind == K_PHASE || op->kind == K_CP)
            fprintf(out, ",\"angle\":%.17g", op->angle);
        fputc('}', out);
    }
    fputs("]}", out);
}

char *ket_web(const char *source, int run, unsigned shots, unsigned seed) {
    char *response = NULL;
    size_t size = 0;
    FILE *out = open_memstream(&response, &size);
    if (!out) return NULL;
    KetProgram *p = NULL;
    KetDiagnostic e;
    if (!ket_compile(source, &p, &e) || !ket_validate(p, &e)) {
        fputs("{\"error\":", out);
        diagnostic(out, &e);
    } else {
        fputs("{\"circuit\":", out);
        circuit(out, p);
        char *qasm = NULL;
        size_t length = 0;
        FILE *assembly = open_memstream(&qasm, &length);
        bool exported = assembly && ket_qasm(p, assembly, &e);
        if (!assembly) strcpy(e.message, "out of memory exporting OpenQASM");
        if (assembly && fclose(assembly)) { exported = false; strcpy(e.message, "could not finish OpenQASM output"); }
        if (exported) { fputs(",\"qasm\":", out); quoted(out, qasm); }
        else { fputs(",\"qasmError\":", out); diagnostic(out, &e); }
        free(qasm);
        if (run) {
            KetResult result;
            if (p->remote) {
                fputs(",\"error\":{\"message\":\"This circuit selects IBM Quantum. Use ket run in the terminal, or select on local in the source.\"}", out);
            } else if (ket_run(p, shots, seed, &result, &e)) {
                fputs(",\"result\":", out);
                ket_print_result(out, p, &result, true, false);
                ket_result_free(&result);
            } else { fputs(",\"error\":", out); diagnostic(out, &e); }
        }
    }
    ket_program_free(p);
    fputc('}', out);
    if (fclose(out)) { free(response); return NULL; }
    return response;
}
