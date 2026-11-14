#include "output.h"
#include "ibm.h"

bool ket_viz(const char *source, bool print_only);
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
          "  ket run FILE [--backend local|ibm] [--shots N] [--seed N] [--json]\n"
          "  ket inspect FILE [--json]              amplitudes before terminal measurements\n"
          "  ket compile FILE [-o FILE]             emit OpenQASM 2.0\n"
          "  ket viz FILE [--url]                   open the circuit in the playground\n"
          "  ket auth --ibm KEY --instance CRN --backend NAME\n"
          "  ket --version\n\n"
          "Use - as FILE to read stdin; -o - writes stdout.\n"
          "Default shots: 1024. Maximum qubits: 20.\n"
          "Use --seed for repeatable local shots. IBM jobs use IBM Quantum credentials.\n", out);
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
int main(int argc, char **argv) {
    if (argc == 1 || !strcmp(argv[1], "--help") || !strcmp(argv[1], "-h")) { usage(stdout); return 0; }
    if (!strcmp(argv[1], "--version")) { puts("ket " KET_VERSION); return 0; }
    if (!strcmp(argv[1], "auth")) return ibm_auth(argc, argv);
    const char *command = argv[1], *path = NULL, *output = NULL, *backend = NULL;
    bool viz = !strcmp(command, "viz"), url = false, explicit_seed = false;
    bool run = !strcmp(command, "run"), inspect = !strcmp(command, "inspect"),
         compile = !strcmp(command, "compile"), check = !strcmp(command, "check"), json = false;
    if (!run && !inspect && !compile && !check && !viz) { fprintf(stderr, "ket: unknown command '%s'\n", command); usage(stderr); return 2; }
    uint64_t shots = 1024, seed = (uint64_t)time(NULL);
    for (int i = 2; i < argc; i++) {
        const char *arg = argv[i];
        if (!strcmp(arg, "--json") && (run || inspect)) json = true;
        else if (viz && !strcmp(arg, "--url")) url = true;
        else if (run && !strcmp(arg, "--backend")) {
            if (++i == argc || backend || (strcmp(argv[i], "local") && strcmp(argv[i], "ibm"))) {
                fputs("ket: --backend requires local or ibm\n", stderr); return 2;
            }
            backend = argv[i];
        } else if ((!strcmp(arg, "--shots") || !strcmp(arg, "--seed")) && run) {
            bool is_shots = !strcmp(arg, "--shots"); uint64_t value;
            if (++i == argc || !number(argv[i], &value) || (is_shots && (value < 1 || value > 1000000))) {
                fprintf(stderr, "ket: %s requires %s\n", arg, is_shots ? "an integer from 1 to 1000000" : "an unsigned 64-bit integer"); return 2;
            }
            if (is_shots) shots = value;
            else { seed = value; explicit_seed = true; }
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
    KetProgramInfo info = ket_program_info(program);
    bool hardware = run && (backend ? !strcmp(backend, "ibm") : info.remote);
    if (hardware && explicit_seed) {
        fputs("ket: --seed is available for local simulation only\n", stderr); ok = false;
    } else if (viz) {
        ok = ket_viz(source, url);
    } else if (check) {
        printf("OK: %u qubit%s, %zu lowered operation%s, %u measurement binding%s\n",
               info.qubits, info.qubits == 1 ? "" : "s", info.operations, info.operations == 1 ? "" : "s",
               info.measurements, info.measurements == 1 ? "" : "s");
    } else if (run) {
        KetResult result;
        ok = hardware ? ibm_run(program, (unsigned)shots, &result, &error) :
                        ket_run(program, shots, seed, &result, &error);
        if (ok) { ket_print_result(stdout, program, &result, json, hardware); ket_result_free(&result); }
        else ket_diagnostic(stderr, path, source, &error);
    } else if (inspect) {
        KetState state;
        ok = ket_inspect(program, &state, &error);
        if (ok) { ket_print_state(stdout, &state, json); ket_state_free(&state); }
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
