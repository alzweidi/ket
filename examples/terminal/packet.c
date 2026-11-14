#define _POSIX_C_SOURCE 200809L
#include "ket.h"
#include <ctype.h>
#include <math.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

enum { sites = 128, first_wall = 64, end_wall = 68, columns = 64, rows = 15, fps = 10 };
static const char ice[] = "\033[38;2;123;220;231m", gold[] = "\033[38;2;255;186;105m";
static const char text[] = "\033[38;2;231;239;240m", muted[] = "\033[38;2;163;181;192m";
static const char keyword[] = "\033[38;2;203;179;248m", comment[] = "\033[38;2;143;165;151m";
static const char dim[] = "\033[38;2;90;112;127m", reset[] = "\033[0m";
static volatile sig_atomic_t interrupted;

typedef struct {
    double probability[sites], left, inside, right;
} Snapshot;

static void stop(int number) { (void)number; interrupted = 1; }
static void line(int y) { printf("\033[%d;2H\033[K", y); }
static void put(const char *ink, const char *words) { fputs(ink,stdout); fputs(words,stdout); }

static char *read_file(const char *path) {
    FILE *in = fopen(path,"rb");
    if (!in) { perror(path); return NULL; }
    char *source = malloc(KET_MAX_SOURCE+1);
    if (!source) { fclose(in); return NULL; }
    size_t n = fread(source,1,KET_MAX_SOURCE,in);
    bool valid = !ferror(in) && n <= KET_MAX_SOURCE && fgetc(in) == EOF && !memchr(source,0,n);
    fclose(in);
    if (!valid) { fprintf(stderr,"invalid or oversized source in %s\n",path); free(source); return NULL; }
    source[n] = 0;
    return source;
}

/* sample the circuit at earlier times by changing only its run argument. */
static bool snapshots(const char *source, const char *path, const char *digits, const char *end,
                      unsigned steps, Snapshot *frames) {
    char *input = malloc(strlen(source)+24);
    if (!input) return false;
    size_t prefix = (size_t)(digits-source);
    memcpy(input,source,prefix);
    bool ok = true;
    for (unsigned i=0; i<=steps && !interrupted; i++) {
        sprintf(input+prefix,"%u%s",i,end);
        KetProgram *program; KetState state; KetDiagnostic e;
        if (!ket_compile(input,&program,&e)) { ket_diagnostic(stderr,path,input,&e); ok = false; break; }
        if (!ket_inspect(program,&state,&e)) {
            ket_diagnostic(stderr,path,input,&e); ket_program_free(program); ok = false; break;
        }
        ket_program_free(program);
        if (state.size != sites) { fputs("packet needs a seven-qubit position register\n",stderr); ok=false; }
        double sum = 0;
        for (unsigned x=0; x<sites && ok; x++) {
            double a = creal(state.amplitudes[x]), b = cimag(state.amplitudes[x]);
            double p = a*a+b*b;
            frames[i].probability[x] = p;
            if (x < first_wall) frames[i].left += p;
            else if (x < end_wall) frames[i].inside += p;
            else frames[i].right += p;
            sum += p;
        }
        ket_state_free(&state);
        if (!ok || !isfinite(sum) || fabs(sum-1)>1e-9) {
            fputs("invalid packet normalisation\n",stderr); ok = false; break;
        }
    }
    free(input); return ok && !interrupted;
}

static bool word_eq(const char *p, size_t n, const char *word) {
    return strlen(word) == n && !memcmp(p,word,n);
}
static void source_line(const char *p, size_t length) {
    const char *end = p+length;
    while (p < end) {
        const char *ink = text, *q=p+1;
        if (*p=='/' && q<end && *q=='/') { put(comment,""); fwrite(p,1,(size_t)(end-p),stdout); return; }
        if (isalnum((unsigned char)*p) || *p=='_') {
            while (q<end && (isalnum((unsigned char)*q) || *q=='_')) q++;
            size_t n=(size_t)(q-p);
            if (word_eq(p,n,"barrier")) ink=gold;
            else if (word_eq(p,n,"gaussian") || word_eq(p,n,"free_step") || word_eq(p,n,"qft")) ink=ice;
            else if (word_eq(p,n,"circuit") || word_eq(p,n,"qubit") || word_eq(p,n,"repeat") ||
                     word_eq(p,n,"let") || word_eq(p,n,"measure") || word_eq(p,n,"run")) ink=keyword;
        }
        fputs(ink,stdout); fwrite(p,1,(size_t)(q-p),stdout); p=q;
    }
}
static void heading(const char *source, size_t shown, bool reveal) {
    line(1); put(ice,"KET"); put(muted,"  /  wave packet scattering");
    line(3); put(muted,"$ "); put(text,"make wavepacket");
    const char *p=source;
    for (unsigned i=0; i<15; i++) {
        const char *end=strchr(p,'\n');
        if (!end) end=p+strlen(p);
        line(5+(int)i); printf("%s%2u  ",dim,i+1);
        if (!reveal || (size_t)(p-source)<shown) {
            size_t n=(size_t)(end-p);
            if (reveal && n>shown-(size_t)(p-source)) n=shown-(size_t)(p-source);
            source_line(p,n);
        }
        p=*end ? end+1 : end;
    }
}
static void graph(const Snapshot *sample, unsigned step, unsigned last) {
    double amplitude[columns];
    for (unsigned x=0; x<columns; x++)
        amplitude[x]=sqrt(fmax(sample->probability[2*x],sample->probability[2*x+1]));
    line(21); put(ice,"|psi(x)|"); put(muted,"   wave amplitude");
    line(22); put(gold,"potential barrier"); put(muted," at x = 64..67");
    const char *blocks[] = {" ","▁","▂","▃","▄","▅","▆","▇","█"};
    for (int y=rows-1; y>=0; y--) {
        line(23+rows-1-y);
        for (unsigned x=0; x<columns; x++) {
            bool wall=2*x>=first_wall && 2*x<end_wall;
            fputs(wall ? "\033[48;2;88;66;49m" : "\033[49m",stdout);
            int level=(int)lround(amplitude[x]/.42*(rows*8))-8*y;
            if (level <= 0) {
                if (wall) put(gold,"┆");
                else if (y%5==0 && x%4==0) put(dim,"·");
                else fputc(' ',stdout);
            } else {
                if (2*x<first_wall) fputs(ice,stdout);
                else fputs(wall ? gold : "\033[38;2;174;233;173m",stdout);
                fputs(blocks[level>8 ? 8 : level],stdout);
            }
        }
        fputs("\033[49m",stdout);
    }
    line(38); put(dim,"0                              64                            127");
    line(40); put(muted,"time "); printf("%s%5.2f%s   step %s%3u%s / %u",text,step*.25,muted,text,step,muted,last);
    line(42); put(ice,"left "); printf("%5.1f%%",100*sample->left);
    put(muted,"    inside "); printf("%4.1f%%",100*sample->inside);
    put("\033[38;2;174;233;173m","    right "); printf("%5.1f%%",100*sample->right);
    line(44);
    if (!step) put(text,"A Gaussian packet moves towards the barrier.");
    else if (step<88) put(text,"The packet travels to the right.");
    else if (step<150) put(text,"The packet reaches the barrier and splits.");
    else put(text,"One part reflects. The other passes through.");
    line(46); put(muted,"github.com/alzweidi/ket");
    fputs(reset,stdout); fflush(stdout);
}

static double clock_time(void) {
    struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t); return t.tv_sec+t.tv_nsec*1e-9;
}
static void wait_until(double deadline) {
    double left;
    while (!interrupted && (left=deadline-clock_time())>0) {
        struct timespec delay={(time_t)left, (long)((left-floor(left))*1e9)};
        nanosleep(&delay,NULL);
    }
}
int main(int argc, char **argv) {
    if (argc<2 || argc>3 || (argc==3 && strcmp(argv[2],"--frames"))) {
        fprintf(stderr,"usage: %s examples/packet.ket [--frames]\n",argv[0]); return 2;
    }
    char *src=read_file(argv[1]);
    if (!src) return 1;
    const char *call=strstr(src,"\nrun packet(");
    if (!call) { fputs("expected run packet(steps)\n",stderr); free(src); return 1; }
    const char *digits=call+strlen("\nrun packet("); char *end;
    unsigned long n=strtoul(digits,&end,10);
    if (!isdigit((unsigned char)*digits) || *end!=')' || n>240) {
        fputs("the viewer accepts 0 to 240 steps\n",stderr); free(src); return 1;
    }
    signal(SIGINT,stop); signal(SIGTERM,stop);
    Snapshot *frames=calloc(n+1,sizeof(*frames));
    if (!frames || !snapshots(src,argv[1],digits,end,(unsigned)n,frames)) { free(src); free(frames); return 1; }
    size_t length=(size_t)(end+1-src);
    fputs("\033[?25l\033[2J\033[H",stdout);
    unsigned intro=33, motion=177, hold=30;
    double start=clock_time();
    for (unsigned f=0; f<intro+motion+hold && !interrupted; f++) {
        if (!f || f<=intro) heading(src,length*(f+8)/(intro+8),f<intro);
        unsigned i=f<intro ? 0 : f>=intro+motion ? (unsigned)n :
                   (unsigned)((f-intro)*n/(motion-1));
        graph(&frames[i],i,(unsigned)n);
        if (argc==2) wait_until(start+(f+1)/(double)fps);
    }
    fputs("\033[0m\033[?25h\033[47;1H\n",stdout);
    free(frames); free(src); return 0;
}
