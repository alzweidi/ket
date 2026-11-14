#include "ket.h"
#include <errno.h>
#include <inttypes.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>

static void usage(FILE *out) {
    fputs("Ket " KET_VERSION " — native quantum language toolchain\n\n"
          "  ket check FILE                         check and lower a circuit\n"
          "  ket run FILE [--shots N] [--seed N] [--json]\n"
          "  ket inspect FILE [--json]              amplitudes before terminal measurements\n"
          "  ket compile FILE [-o FILE]             emit OpenQASM 2.0\n"
          "  ket --version\n\n"
          "Use - as FILE to read stdin; -o - writes stdout.\n"
          "Default shots: 1024. Maximum qubits: 20.\n"
          "run is a local simulator; compile exports circuits for external hardware tools.\n", out);
}
static bool number(const char *s, uint64_t *value) {
    if (!s || !*s) return false;
    for (const char *p = s; *p; p++) if (*p < '0' || *p > '9') return false;
    char *end; errno = 0;
    unsigned long long n = strtoull(s, &end, 10);
    if (errno || *end) return false;
    *value = (uint64_t)n; return true;
}
static bool same_file(const char *source, const char *output) {
    if (!output || !strcmp(source, "-") || !strcmp(output, "-")) return false;
    if (!strcmp(source, output)) return true;
    struct stat a, b;
    return stat(source, &a) == 0 && stat(output, &b) == 0 &&
           a.st_dev == b.st_dev && a.st_ino == b.st_ino;
}
static char *read_source(const char *path) {
    bool use_stdin = !strcmp(path, "-");
    FILE *in = use_stdin ? stdin : fopen(path, "rb");
    if (!in) { fprintf(stderr, "ket: cannot open %s: %s\n", path, strerror(errno)); return NULL; }
    char *source = malloc(KET_MAX_SOURCE + 2);
    if (!source) { fputs("ket: out of memory\n", stderr); if (!use_stdin) fclose(in); return NULL; }
    size_t n = fread(source, 1, KET_MAX_SOURCE+1, in);
    bool io_error = ferror(in) != 0;
    if (!use_stdin) fclose(in);
    if (io_error || n > KET_MAX_SOURCE || memchr(source, 0, n)) {
        fputs("ket: source must be a text file of at most 1 MiB without NUL bytes\n", stderr);
        free(source); return NULL;
    }
    source[n] = 0; return source;
}
static void bitstring(size_t n, unsigned width, char *out) {
    for (unsigned i = 0; i < width; i++) out[i] = ((n >> (width-1-i)) & 1) ? '1' : '0';
    out[width] = 0;
}
static void print_state(const KetState *s, bool json) {
    char bits[KET_MAX_QUBITS+1]; bool first = true;
    if (json) printf("{\"qubits\":%u,\"basis_order\":\"declaration order, first qubit is MSB\",\"amplitudes\":[", s->qubits);
    else printf("%u qubits · state before terminal measurements\n\n%-22s %14s %14s %14s\n", s->qubits, "basis", "real", "imaginary", "probability");
    for (size_t i = 0; i < s->size; i++) {
        double re = creal(s->amplitudes[i]), im = cimag(s->amplitudes[i]), p = re*re + im*im;
        if (p < 1e-14) continue;
        bitstring(i, s->qubits, bits);
        if (json) printf("%s{\"basis\":\"%s\",\"real\":%.17g,\"imaginary\":%.17g,\"probability\":%.17g}", first ? "" : ",", bits, re, im, p);
        else printf("%-22s %14.9f %14.9f %14.9f\n", bits, re, im, p);
        first = false;
    }
    if (json) puts("]}");
}
static void print_result(const KetProgram *p, const KetResult *r, bool json) {
    char bits[KET_MAX_QUBITS+1]; bool first = true;
    if (json) printf("{\"qubits\":%u,\"shots\":%" PRIu64 ",\"seed\":%" PRIu64 ",\"measurements\":[", p->qubits, r->shots, r->seed);
    else printf("%u qubits · %" PRIu64 " shots · seed %" PRIu64 "\nMeasurements:", p->qubits, r->shots, r->seed);
    for (unsigned i = 0; i < p->nclassical; i++) {
        if (json) printf("%s{\"name\":\"%s\",\"width\":%u}", i ? "," : "", p->classical[i].name, p->classical[i].width);
        else printf(" %s[%u]", p->classical[i].name, p->classical[i].width);
    }
    if (json) fputs("],\"counts\":{", stdout); else fputs("\n\n", stdout);
    for (size_t i = 0; i < ((size_t)1 << r->bits); i++) if (r->counts[i]) {
        bitstring(i, r->bits, bits);
        if (json) printf("%s\"%s\":%" PRIu64, first ? "" : ",", bits, r->counts[i]);
        else {
            double fraction = (double)r->counts[i] / (double)r->shots;
            printf("  %s  %8" PRIu64 "  %6.2f%%  ", bits, r->counts[i], fraction*100);
            unsigned bars = (unsigned)lround(fraction*30);
            for (unsigned j = 0; j < bars; j++) fputc('#', stdout);
            fputc('\n', stdout);
        }
        first = false;
    }
    if (json) puts("}}");
}

int main(int argc, char **argv) {
    if (argc == 1 || !strcmp(argv[1], "--help") || !strcmp(argv[1], "-h")) { usage(stdout); return 0; }
    if (!strcmp(argv[1], "--version")) { puts("ket " KET_VERSION); return 0; }
    const char *command = argv[1], *path = NULL, *output = NULL;
    bool run = !strcmp(command, "run"), inspect = !strcmp(command, "inspect"),
         compile = !strcmp(command, "compile"), check = !strcmp(command, "check"), json = false;
    if (!run && !inspect && !compile && !check) { fprintf(stderr, "ket: unknown command '%s'\n", command); usage(stderr); return 2; }
    uint64_t shots = 1024, seed = (uint64_t)time(NULL);
    for (int i = 2; i < argc; i++) {
        const char *arg = argv[i];
        if (!strcmp(arg, "--json") && (run || inspect)) json = true;
        else if ((!strcmp(arg, "--shots") || !strcmp(arg, "--seed")) && run) {
            bool is_shots = !strcmp(arg, "--shots"); uint64_t value;
            if (++i == argc || !number(argv[i], &value) || (is_shots && (value < 1 || value > 1000000))) {
                fprintf(stderr, "ket: %s requires %s\n", arg, is_shots ? "an integer from 1 to 1000000" : "an unsigned 64-bit integer"); return 2;
            }
            if (is_shots) shots = value; else seed = value;
        } else if ((!strcmp(arg, "-o") || !strcmp(arg, "--output")) && compile) {
            if (++i == argc || output) { fputs("ket: provide one output path\n", stderr); return 2; }
            output = argv[i];
        } else if (arg[0] == '-' && strcmp(arg, "-")) { fprintf(stderr, "ket: unsupported option '%s' for %s\n", arg, command); return 2; }
        else if (path) { fputs("ket: provide exactly one source file\n", stderr); return 2; }
        else path = arg;
    }
    if (!path) { fputs("ket: missing source file\n", stderr); return 2; }
    if (same_file(path, output)) { fputs("ket: output must not overwrite the source file\n", stderr); return 2; }
    if (output && !strcmp(output, "-")) output = NULL;
    char *source = read_source(path);
    if (!source) return 1;
    KetProgram *program; KetDiagnostic error;
    if (!ket_compile(source, &program, &error)) { ket_diagnostic(stderr, path, source, &error); free(source); return 1; }
    bool ok = true;
    if (run && program->remote) {
        fputs("ket: 'on ibm' requests remote execution; this native milestone runs locally only.\nUse ket compile to export, or change the source backend to local.\n", stderr);
        ok = false;
    } else if (check) {
        printf("OK: %u qubits, %zu lowered operations, %u measurement bindings\n", program->qubits, program->count, program->nclassical);
    } else if (run) {
        KetResult result;
        ok = ket_run(program, shots, seed, &result, &error);
        if (ok) { print_result(program, &result, json); ket_result_free(&result); }
        else ket_diagnostic(stderr, path, source, &error);
    } else if (inspect) {
        KetState state;
        ok = ket_inspect(program, &state, &error);
        if (ok) { print_state(&state, json); ket_state_free(&state); }
        else ket_diagnostic(stderr, path, source, &error);
    } else if (compile) {
        /* finish export checks before opening an existing output file. */
        FILE *staged = tmpfile();
        if (!staged) { fputs("ket: cannot create temporary output\n", stderr); ok = false; }
        else {
            ok = ket_qasm(program, staged, &error);
            if (ok && (fflush(staged) || fseek(staged, 0, SEEK_SET))) {
                strcpy(error.message, "could not finish temporary OpenQASM output"); ok = false;
            }
            if (!ok) ket_diagnostic(stderr, path, source, &error);
            else {
                FILE *out = output ? fopen(output, "wb") : stdout;
                if (!out) { fprintf(stderr, "ket: cannot open output: %s\n", strerror(errno)); ok = false; }
                else {
                    char buffer[4096]; size_t n;
                    while ((n = fread(buffer, 1, sizeof(buffer), staged)) != 0)
                        if (fwrite(buffer, 1, n, out) != n) { ok = false; break; }
                    if (ferror(staged) || ferror(out)) ok = false;
                    if (output && fclose(out)) ok = false;
                    if (!ok) fputs("ket: failed writing output\n", stderr);
                }
            }
            fclose(staged);
        }
    }
    if (fflush(stdout) || ferror(stdout)) ok = false;
    ket_program_free(program); free(source); return ok ? 0 : 1;
}
