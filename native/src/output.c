#include "output.h"
#include <inttypes.h>
#include <math.h>

static void bitstring(size_t n, unsigned width, char *out) {
    for (unsigned i = 0; i < width; i++) out[i] = ((n >> (width-1-i)) & 1) ? '1' : '0';
    out[width] = 0;
}
void ket_print_state(FILE *out, const KetState *s, bool json) {
    char bits[KET_MAX_QUBITS+1]; bool first = true;
    if (json) fprintf(out, "{\"qubits\":%u,\"basis_order\":\"declaration order, first qubit is MSB\",\"amplitudes\":[", s->qubits);
    else fprintf(out, "%u qubits · state before terminal measurements\n\n%-22s %14s %14s %14s\n", s->qubits, "basis", "real", "imaginary", "probability");
    for (size_t i = 0; i < s->size; i++) {
        double re = creal(s->amplitudes[i]), im = cimag(s->amplitudes[i]), p = re*re + im*im;
        if (p < 1e-14) continue;
        bitstring(i, s->qubits, bits);
        if (json) fprintf(out, "%s{\"basis\":\"%s\",\"real\":%.17g,\"imaginary\":%.17g,\"probability\":%.17g}", first ? "" : ",", bits, re, im, p);
        else fprintf(out, "%-22s %14.9f %14.9f %14.9f\n", bits, re, im, p);
        first = false;
    }
    if (json) fputs("]}\n", out);
}
void ket_print_result(FILE *out, const KetProgram *p, const KetResult *r, bool json, bool hardware) {
    KetProgramInfo info = ket_program_info(p);
    char bits[KET_MAX_QUBITS+1]; bool first = true;
    if (json) {
        fprintf(out, "{\"qubits\":%u,\"shots\":%" PRIu64, info.qubits, r->shots);
        if (hardware) fputs(",\"backend\":\"ibm\"", out);
        else fprintf(out, ",\"seed\":%" PRIu64, r->seed);
        fputs(",\"measurements\":[", out);
    } else {
        fprintf(out, "%u qubits · %" PRIu64 " shots", info.qubits, r->shots);
        if (hardware) fputs(" · IBM Quantum", out);
        else fprintf(out, " · seed %" PRIu64, r->seed);
        fputs("\nMeasurements:", out);
    }
    for (unsigned i = 0; i < info.measurements; i++) {
        unsigned width;
        const char *name = ket_measurement_name(p, i, &width);
        if (json) fprintf(out, "%s{\"name\":\"%s\",\"width\":%u}", i ? "," : "", name, width);
        else fprintf(out, " %s[%u]", name, width);
    }
    if (json) fputs("],\"counts\":{", out); else fputs("\n\n", out);
    for (size_t i = 0; i < ((size_t)1 << r->bits); i++) if (r->counts[i]) {
        bitstring(i, r->bits, bits);
        if (json) fprintf(out, "%s\"%s\":%" PRIu64, first ? "" : ",", bits, r->counts[i]);
        else {
            double fraction = (double)r->counts[i] / (double)r->shots;
            fprintf(out, "  %s  %8" PRIu64 "  %6.2f%%  ", bits, r->counts[i], fraction*100);
            unsigned bars = (unsigned)lround(fraction*30);
            for (unsigned j = 0; j < bars; j++) fputc('#', out);
            fputc('\n', out);
        }
        first = false;
    }
    if (json) fputs("}}\n", out);
}
