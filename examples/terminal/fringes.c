#define _POSIX_C_SOURCE 200809L
#include "ket.h"
#include <complex.h>
#include <math.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

enum { bins = 64, height = 24, cycles = 3, wave_frames = 40, fps = 10, frames = 200 };
static const double pi = 3.14159265358979323846;
static const char *const mode[cycles] = {"BOTH PATHS OPEN", "PATH RECORDED", "MARKER REMOVED"};
static const char *const note[cycles] = {
    "Bright and dark bands alternate.",
    "Every screen bin is equally likely.",
    "The interference fringes return."
};
static volatile sig_atomic_t interrupted;

typedef struct {
    unsigned hit[height][bins], shots;
} Screen;
typedef struct {
    double prob[bins], visibility;
} Profile;

static void on_interrupt(int signal_number) { (void)signal_number; interrupted = 1; }

static char *read_source(const char *path) {
    FILE *file = fopen(path, "rb");
    if (!file) { perror(path); return NULL; }
    char *src = malloc(KET_MAX_SOURCE + 1);
    if (!src) { fclose(file); return NULL; }
    size_t n = fread(src, 1, KET_MAX_SOURCE, file);
    int next = fgetc(file);
    if (ferror(file) || next != EOF || memchr(src, 0, n)) {
        fprintf(stderr, "%s: invalid or oversized source\n", path);
        free(src); src = NULL;
    } else src[n] = 0;
    fclose(file); return src;
}

static KetProgram *compile_at(const char *example, double phase, unsigned tag) {
    const char *call = strstr(example, "\nrun fringes(");
    if (!call) { fputs("expected a call to fringes at the end of the example\n", stderr); return NULL; }
    size_t length = (size_t)(call-example);
    char *src = malloc(length + 96);
    if (!src) return NULL;
    memcpy(src, example, length);
    snprintf(src+length, 96, "\nrun fringes(%.17g, %u)\n", phase, tag);
    KetProgram *program = NULL;
    KetDiagnostic error;
    if (!ket_compile(src, &program, &error)) ket_diagnostic(stderr, "fringes.ket", src, &error);
    free(src);
    return program;
}

static bool check_layout(const KetProgram *program) {
    KetProgramInfo info = ket_program_info(program);
    unsigned pixel_width = 0, path_width = 0;
    const char *pixel = ket_measurement_name(program, 0, &pixel_width);
    const char *path = ket_measurement_name(program, 1, &path_width);
    return info.qubits == 7 && info.bits == 7 && info.measurements == 2 &&
           pixel && !strcmp(pixel,"pixel") && pixel_width == 6 &&
           path && !strcmp(path,"path") && path_width == 1;
}

static bool profile(const KetProgram *program, Profile *out) {
    KetDiagnostic error; KetState state;
    if (!ket_inspect(program, &state, &error)) { fprintf(stderr, "%s\n", error.message); return false; }
    double low = 1.0, high = 0.0, sum = 0.0;
    for (unsigned x = 0; x < bins; x++) {
        double a = cabs(state.amplitudes[2*x]), b = cabs(state.amplitudes[2*x+1]);
        out->prob[x] = a*a + b*b;
        low = fmin(low, out->prob[x]); high = fmax(high, out->prob[x]);
        sum += out->prob[x];
    }
    out->visibility = (high-low)/(high+low);
    ket_state_free(&state);
    return fabs(sum-1) < 1e-10;
}

/* only x is measured. the vertical jitter separates hits in the same column. */
static uint32_t jitter(uint32_t *state) {
    uint32_t x = *state;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    return *state = x;
}

static bool sample(const KetProgram *program, unsigned shots, uint64_t seed, Screen *screen, uint32_t *noise) {
    KetResult result; KetDiagnostic error;
    if (!ket_run(program, shots, seed, &result, &error)) { fprintf(stderr, "%s\n", error.message); return false; }
    for (unsigned x = 0; x < bins; x++) {
        uint64_t n = result.counts[2*x]+result.counts[2*x+1];
        for (uint64_t i = 0; i < n; i++) screen->hit[jitter(noise)%height][x]++;
    }
    screen->shots += shots;
    ket_result_free(&result);
    return true;
}
static double seconds(void) {
    struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec/1e9;
}
static void until(double when) {
    while (!interrupted) {
        double left = when-seconds();
        if (left <= 0) return;
        struct timespec ts = {(time_t)left, (long)((left-floor(left))*1e9)};
        nanosleep(&ts, NULL);
    }
}

static void ink(int r, int g, int b) { printf("\033[38;2;%d;%d;%dm", r,g,b); }
static void row(unsigned n) { printf("\033[%u;1H\033[K", n); }
static void text_at(unsigned n, const char *s) { row(n); fputs(s, stdout); }

static void draw(unsigned scene, unsigned tick, double phase, const Profile *p, const Screen *screen) {
    static const char *const dots[] = {"·","∘","•","●","●"};
    static const char *const bar[] = {" ","▁","▂","▃","▄","▅","▆","▇","█"};
    static const int green[][3] = {{22,43,42},{44,103,87},{53,147,116},{88,194,146},{153,234,166},{223,255,197}};
    static const int copper[][3] = {{43,39,33},{107,78,46},{165,111,57},{198,144,77},{237,182,103},{255,222,161}};
    const int (*colour)[3] = scene == 1 ? copper : green;
    printf("\033[0m\033[H");
    ink(157,177,172); text_at(1,"KET   /   QUANTUM CIRCUIT LANGUAGE");
    ink(234,244,233); text_at(2,"Two-path interference");
    ink(121,147,141); text_at(4,"fringes.ket   ·   7 qubits   ·   64 screen bins");
    ink(136,160,151); text_at(6,"DETECTOR X");
    ink(colour[4][0],colour[4][1],colour[4][2]);
    printf("   %s   ", mode[scene]);
    ink(167,184,174); printf("%u shots", screen->shots);

    for (unsigned y=0; y<height; y++) {
        row(7+y);
        for (unsigned x=0; x<bins; x++) {
            unsigned n = screen->hit[y][x];
            unsigned level = n == 0 ? 0 : n == 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : n <= 10 ? 4 : 5;
            ink(colour[level][0],colour[level][1],colour[level][2]);
            if (level) fputs(dots[level-1],stdout);
            else fputs(y%6==0 || x%8==0 ? "·" : " ",stdout);
        }
    }
    ink(101,129,121); text_at(31,"0                               32                            63");
    ink(164,185,174); text_at(33,"SCREEN PROBABILITY");
    ink(131,156,145); printf("    phase %.2fπ", phase/pi);
    double peak = 2.0/bins;
    for (int line=2; line>=0; line--) {
        row((unsigned)(36-line));
        for (unsigned x=0; x<bins; x++) {
            int value = (int)lround(p->prob[x]/peak*24)-line*8;
            value = value < 0 ? 0 : value > 8 ? 8 : value;
            ink(colour[3+line][0],colour[3+line][1],colour[3+line][2]);
            fputs(bar[value], stdout);
        }
    }
    ink(219,237,222); row(38);
    printf("Fringe visibility  %3.0f%%", p->visibility*100);
    ink(155,180,167); text_at(39, tick>=25 ? note[scene] :
                             scene==1 ? "One qubit stores the path." : "The two paths can interfere.");
    ink(118,145,137); text_at(41, "github.com/alzweidi/ket");
    printf("\033[0m"); fflush(stdout);
}

static bool show(const char *source, bool paced) {
    unsigned prev = cycles;
    Screen screen = {0}; uint32_t noise = 137;
    double start = seconds();
    for (unsigned f=0; f<frames && !interrupted; f++) {
        unsigned scene = f < 85 ? 0 : f < 145 ? 1 : 2;
        unsigned tick = f-(scene==0 ? 0 : scene==1 ? 85 : 145);
        unsigned target = tick < 40 ? 32 + tick*tick*4 : 8192;
        bool sweep = scene == 0 && tick >= 45;
        double phase = sweep ? 2*pi*(tick-45)/(wave_frames-1) : 0;
        if (scene != prev || sweep) screen = (Screen){0};
        prev = scene;
        KetProgram *program = compile_at(source,phase,scene==1);
        if (!program) return false;
        Profile current;
        bool ok = check_layout(program) && profile(program,&current);
        if (ok && target>screen.shots)
            ok = sample(program, target-screen.shots, 0x2a0000u+f, &screen, &noise);
        ket_program_free(program);
        if (!ok) { fputs("could not resolve the detector and path measurements\n",stderr); return false; }
        draw(scene,tick,phase,&current,&screen);
        if (paced) until(start+(f+1)/(double)fps);
    }
    return true;
}

int main(int argc, char **argv) {
    if (argc < 2 || argc > 3 || (argc == 3 && strcmp(argv[2],"--frames"))) {
        fprintf(stderr,"usage: %s fringes.ket [--frames]\n",argv[0]); return 2;
    }
    char *src = read_source(argv[1]);
    if (!src) return 1;
    signal(SIGINT,on_interrupt); signal(SIGTERM,on_interrupt);
    fputs("\033[?25l\033[2J",stdout);
    bool ok = show(src,argc==2);
    fputs("\033[0m\033[?25h\033[42;1H\n",stdout);
    free(src);
    return ok ? 0 : 1;
}
