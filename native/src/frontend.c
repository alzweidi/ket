#include "ket.h"
#include <ctype.h>
#include <errno.h>
#include <math.h>
#include <setjmp.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>

#define PI 3.14159265358979323846264338327950288
#define MAX_DEPTH 64
#define MAX_BINDINGS 256
#define MAX_WORK 1000000

typedef enum { T_END = 256, T_ID, T_NUMBER, T_KET, T_EQUAL } TokenKind;
typedef struct { int kind; char text[KET_NAME]; double number; KetSpan span; } Token;
typedef struct Allocation { void *data; struct Allocation *next; } Allocation;
typedef struct Expr {
    int kind;
    Token token;
    struct Expr *left, *right;
} Expr;
typedef struct { Token name; int index; } Ref;
typedef enum { N_QUBIT, N_BIT, N_MEASURE, N_GATE, N_REPEAT, N_IF, N_ORACLE } NodeKind;
typedef struct Node {
    NodeKind kind;
    Token token, name, match;
    Ref refs[KET_MAX_QUBITS];
    unsigned nargs, width;
    Expr *expr;
    struct Node *body, *next;
} Node;
typedef struct Def {
    Token name, params[KET_MAX_QUBITS], types[KET_MAX_QUBITS];
    unsigned nargs;
    bool gate, active;
    Node *body;
    struct Def *next;
} Def;
typedef enum { B_QUANTUM, B_CLASSICAL, B_ANGLE, B_BITS, B_UNUSED_BIT } BindingKind;
typedef struct {
    Token name;
    BindingKind kind;
    unsigned start, width, classical;
    double number;
    char bits[KET_MAX_QUBITS + 1];
} Binding;
typedef struct { Binding *entries; unsigned count, capacity; } Env;
typedef struct {
    const char *source;
    size_t cursor, allocated, nodes, work;
    unsigned line, column, depth;
    Token token;
    Allocation *allocations;
    jmp_buf escape;
    KetDiagnostic *error;
    KetProgram *program;
    Def *defs;
    uint32_t measured;
} Context;

static _Noreturn void fail(Context *c, Token t, const char *format, ...) {
    c->error->span = t.span;
    va_list args;
    va_start(args, format);
    vsnprintf(c->error->message, sizeof(c->error->message), format, args);
    va_end(args);
    longjmp(c->escape, 1);
}

static void *allocate(Context *c, size_t size) {
    if (c->allocated + size > 64 * 1024 * 1024)
        fail(c, c->token, "source is too complex (64 MiB compiler allocation limit)");
    Allocation *item = malloc(sizeof(*item));
    void *data = calloc(1, size);
    if (!item || !data) {
        free(item); free(data);
        fail(c, c->token, "out of memory");
    }
    item->data = data; item->next = c->allocations;
    c->allocations = item; c->allocated += size;
    return data;
}

static void advance_byte(Context *c) {
    unsigned char b = (unsigned char)c->source[c->cursor++];
    if (b == '\n') { c->line++; c->column = 1; }
    else if ((b & 0xc0) != 0x80) c->column++;
}

static bool starts(Context *c, const char *s) {
    return strncmp(c->source + c->cursor, s, strlen(s)) == 0;
}

static void next(Context *c) {
    for (;;) {
        while (isspace((unsigned char)c->source[c->cursor])) advance_byte(c);
        if (!starts(c, "//")) break;
        while (c->source[c->cursor] && c->source[c->cursor] != '\n') advance_byte(c);
    }
    Token t = {0};
    size_t start = c->cursor;
    t.span = (KetSpan){start, 1, c->line, c->column};
    unsigned char b = (unsigned char)c->source[c->cursor];
    if (!b) t.kind = T_END;
    else if (starts(c, "π")) {
        advance_byte(c); advance_byte(c);
        t.kind = T_ID; strcpy(t.text, "pi");
    } else if ((isalpha(b) && b < 128) || b == '_') {
        t.kind = T_ID;
        while ((unsigned char)c->source[c->cursor] < 128 &&
               (isalnum((unsigned char)c->source[c->cursor]) || c->source[c->cursor] == '_'))
            advance_byte(c);
        size_t len = c->cursor - start;
        if (len >= KET_NAME) fail(c, t, "identifier exceeds 63 bytes");
        memcpy(t.text, c->source + start, len);
    } else if (isdigit(b) || (b == '.' && isdigit((unsigned char)c->source[c->cursor+1]))) {
        t.kind = T_NUMBER;
        while (isdigit((unsigned char)c->source[c->cursor])) advance_byte(c);
        if (c->source[c->cursor] == '.') {
            advance_byte(c);
            while (isdigit((unsigned char)c->source[c->cursor])) advance_byte(c);
        }
        if (c->source[c->cursor] == 'e' || c->source[c->cursor] == 'E') {
            advance_byte(c);
            if (c->source[c->cursor] == '+' || c->source[c->cursor] == '-') advance_byte(c);
            if (!isdigit((unsigned char)c->source[c->cursor])) fail(c, t, "malformed numeric exponent");
            while (isdigit((unsigned char)c->source[c->cursor])) advance_byte(c);
        }
        char *end;
        errno = 0;
        t.number = strtod(c->source + start, &end);
        if (errno == ERANGE || !isfinite(t.number)) fail(c, t, "number is outside the finite range");
        b = (unsigned char)c->source[c->cursor];
        if (end != c->source + c->cursor || isalnum(b) || b == '.' || b == '_')
            fail(c, t, "malformed numeric literal");
    } else if (b == '|') {
        t.kind = T_KET; advance_byte(c);
        unsigned n = 0;
        while (c->source[c->cursor] == '0' || c->source[c->cursor] == '1') {
            if (n >= KET_MAX_QUBITS) fail(c, t, "ket literal exceeds 20 bits");
            t.text[n++] = c->source[c->cursor]; advance_byte(c);
        }
        if (!n) fail(c, t, "ket literal must contain at least one binary digit");
        if (starts(c, "⟩")) { advance_byte(c); advance_byte(c); advance_byte(c); }
        else if (c->source[c->cursor] == '>') advance_byte(c);
        else fail(c, t, "expected '>' or '⟩' after the binary digits");
    } else if (starts(c, "==")) {
        t.kind = T_EQUAL; advance_byte(c); advance_byte(c);
    } else if (strchr("(){}[],;:+-*/=", b)) {
        t.kind = b; advance_byte(c);
    } else fail(c, t, "unexpected character (use ASCII identifiers; π and ket brackets are supported)");
    t.span.length = c->cursor - start;
    c->token = t;
}

static bool is(Context *c, const char *word) {
    return c->token.kind == T_ID && strcmp(c->token.text, word) == 0;
}
static bool take(Context *c, int kind) {
    if (c->token.kind != kind) return false;
    next(c); return true;
}
static Token expect(Context *c, int kind, const char *what) {
    Token t = c->token;
    if (t.kind != kind) fail(c, t, "expected %s", what);
    next(c); return t;
}
static void enter(Context *c) {
    if (++c->depth > MAX_DEPTH) fail(c, c->token, "nesting exceeds 64 levels");
}

static Expr *expression(Context *c, int minimum);
static Expr *primary(Context *c) {
    enter(c);
    Token t = c->token;
    Expr *e = allocate(c, sizeof(*e)); e->token = t; e->kind = t.kind;
    if (take(c, '-')) { e->kind = '~'; e->left = primary(c); }
    else if (take(c, '+')) { e = primary(c); }
    else if (take(c, '(')) { e = expression(c, 0); expect(c, ')', "')'"); }
    else if (take(c, T_NUMBER)) { }
    else if (take(c, T_ID)) {
        if (strcmp(t.text, "sqrt") == 0 || strcmp(t.text, "floor") == 0 || strcmp(t.text, "ceil") == 0) {
            e->kind = 'f'; expect(c, '(', "'('");
            e->left = expression(c, 0); expect(c, ')', "')'");
        }
    } else fail(c, t, "expected a number, angle parameter, pi, or parenthesised expression");
    c->depth--; return e;
}
static Expr *expression(Context *c, int minimum) {
    enter(c);
    Expr *left = primary(c);
    for (;;) {
        int op = c->token.kind;
        int priority = op == '+' || op == '-' ? 1 : op == '*' || op == '/' ? 2 : -1;
        if (priority < minimum) break;
        Expr *e = allocate(c, sizeof(*e)); e->kind = op; e->token = c->token;
        next(c); e->left = left; e->right = expression(c, priority + 1); left = e;
    }
    c->depth--; return left;
}
static unsigned integer(Context *c, Token t, unsigned limit, const char *what) {
    if (t.number < 0 || t.number > limit || floor(t.number) != t.number)
        fail(c, t, "%s must be an integer between 0 and %u", what, limit);
    return (unsigned)t.number;
}
static Ref reference(Context *c) {
    Ref ref = {expect(c, T_ID, "a qubit name"), -1};
    if (take(c, '[')) {
        Token index = expect(c, T_NUMBER, "a non-negative qubit index");
        ref.index = (int)integer(c, index, KET_MAX_QUBITS, "qubit index");
        expect(c, ']', "']'");
    }
    return ref;
}

static Node *statement(Context *c);
static Node *block(Context *c) {
    enter(c); expect(c, '{', "'{'");
    Node *head = NULL, **tail = &head;
    while (c->token.kind != '}') {
        if (c->token.kind == T_END) fail(c, c->token, "expected '}' before end of file");
        if (take(c, ';')) continue;
        *tail = statement(c); tail = &(*tail)->next;
    }
    next(c); c->depth--; return head;
}
static Node *statement(Context *c) {
    if (++c->nodes > 100000) fail(c, c->token, "too many source statements");
    Node *n = allocate(c, sizeof(*n)); n->token = c->token;
    if (is(c, "qubit") || is(c, "bit")) {
        n->kind = is(c, "qubit") ? N_QUBIT : N_BIT; next(c);
        n->name = expect(c, T_ID, "a declaration name"); n->width = 1;
        if (take(c, '[')) {
            Token size = expect(c, T_NUMBER, "a register size");
            n->width = integer(c, size, KET_MAX_QUBITS, "register size");
            if (!n->width) fail(c, size, "register size must be positive");
            expect(c, ']', "']'");
        }
    } else if (is(c, "let")) {
        n->kind = N_MEASURE; next(c); n->name = expect(c, T_ID, "a measurement name");
        expect(c, '=', "'='");
        if (!is(c, "measure")) fail(c, c->token, "let currently binds measurement results: let name = measure q");
        next(c); n->refs[0] = reference(c);
    } else if (is(c, "repeat")) {
        n->kind = N_REPEAT; next(c); n->expr = expression(c, 0); n->body = block(c);
    } else if (is(c, "if")) {
        n->kind = N_IF; next(c); n->name = expect(c, T_ID, "a measurement name");
        expect(c, T_EQUAL, "'=='");
        n->match = c->token;
        if (!take(c, T_KET) && !take(c, T_NUMBER)) fail(c, c->token, "expected a ket literal or integer");
        n->body = block(c);
    } else if (is(c, "phase_oracle")) {
        n->kind = N_ORACLE; next(c); n->refs[0] = reference(c);
        if (!is(c, "matches")) fail(c, c->token, "expected 'matches'");
        next(c); n->match = c->token;
        if (!take(c, T_KET) && !take(c, T_ID)) fail(c, c->token, "expected a ket literal or bitstring parameter");
    } else {
        n->kind = N_GATE; n->name = expect(c, T_ID, "a declaration or quantum operation");
        if (take(c, '(')) { n->expr = expression(c, 0); expect(c, ')', "')'"); }
        do {
            if (n->nargs == KET_MAX_QUBITS) fail(c, n->token, "too many gate operands");
            n->refs[n->nargs++] = reference(c);
        } while (take(c, ','));
    }
    take(c, ';'); return n;
}

static bool reserved(const char *s) {
    const char *words[] = {"qubit", "bit", "let", "measure", "if", "repeat", "gate", "circuit",
        "run", "on", "matches", "angle", "bitstring", "pi", "sqrt", "floor", "ceil",
        "H", "X", "Y", "Z", "S", "T", "Rx", "Ry", "Rz", "CNOT", "CZ", "SWAP",
        "Toffoli", "qft", "diffuse", "grover_diffuse", "phase_oracle"};
    for (size_t i = 0; i < sizeof(words)/sizeof(*words); i++) if (strcmp(words[i], s) == 0) return true;
    return false;
}
static Def *find_def(Context *c, const char *name) {
    for (Def *d = c->defs; d; d = d->next) if (strcmp(d->name.text, name) == 0) return d;
    return NULL;
}
static void definition(Context *c) {
    Def *d = allocate(c, sizeof(*d)); d->gate = is(c, "gate"); next(c);
    d->name = expect(c, T_ID, "a definition name");
    if (reserved(d->name.text) || find_def(c, d->name.text)) fail(c, d->name, "definition name '%s' is already used or reserved", d->name.text);
    expect(c, '(', "'('");
    if (!take(c, ')')) {
        do {
            if (d->nargs == KET_MAX_QUBITS) fail(c, c->token, "at most 20 parameters are supported");
            Token name = expect(c, T_ID, "a parameter name");
            if (reserved(name.text)) fail(c, name, "parameter name '%s' is reserved", name.text);
            for (unsigned i = 0; i < d->nargs; i++) if (strcmp(name.text, d->params[i].text) == 0)
                fail(c, name, "duplicate parameter '%s'", name.text);
            d->params[d->nargs] = name;
            if (!d->gate) {
                expect(c, ':', "':' and an angle or bitstring type");
                Token type = expect(c, T_ID, "angle or bitstring");
                if (strcmp(type.text, "angle") && strcmp(type.text, "bitstring"))
                    fail(c, type, "circuit parameters must be angle or bitstring");
                d->types[d->nargs] = type;
            }
            d->nargs++;
        } while (take(c, ','));
        expect(c, ')', "')'");
    }
    d->body = block(c); d->next = c->defs; c->defs = d;
}

static Binding *lookup(Env *env, const char *name) {
    for (unsigned i = env->count; i; i--) if (strcmp(env->entries[i-1].name.text, name) == 0) return &env->entries[i-1];
    return NULL;
}
static Binding *bind(Context *c, Env *env, Token name, BindingKind kind) {
    if (reserved(name.text) || lookup(env, name.text) || find_def(c, name.text))
        fail(c, name, "name '%s' is already declared or reserved", name.text);
    if (env->count == env->capacity) fail(c, name, "too many bindings");
    Binding *b = &env->entries[env->count++]; b->name = name; b->kind = kind; return b;
}
static double evaluate(Context *c, Env *env, Expr *e) {
    enter(c);
    double value = 0;
    if (e->kind == T_NUMBER) value = e->token.number;
    else if (e->kind == T_ID) {
        Binding *b = lookup(env, e->token.text);
        if (strcmp(e->token.text, "pi") == 0) value = PI;
        else if (b && b->kind == B_ANGLE) value = b->number;
        else fail(c, e->token, "unknown angle parameter '%s'", e->token.text);
    } else if (e->kind == '~') value = -evaluate(c, env, e->left);
    else if (e->kind == 'f') {
        double a = evaluate(c, env, e->left);
        if (strcmp(e->token.text, "sqrt") == 0) value = sqrt(a);
        else if (strcmp(e->token.text, "floor") == 0) value = floor(a);
        else value = ceil(a);
    } else {
        double a = evaluate(c, env, e->left), b = evaluate(c, env, e->right);
        switch (e->kind) {
            case '+': value = a+b; break; case '-': value = a-b; break;
            case '*': value = a*b; break; case '/': value = a/b; break;
        }
    }
    if (!isfinite(value)) fail(c, e->token, "expression is not finite (check division by zero or sqrt domain)");
    c->depth--; return value;
}

static unsigned resolve(Context *c, Env *env, Ref ref, unsigned *start) {
    Binding *b = lookup(env, ref.name.text);
    if (!b || b->kind != B_QUANTUM) fail(c, ref.name, "'%s' is not a declared qubit", ref.name.text);
    unsigned width = b->width;
    *start = b->start;
    if (ref.index >= 0) {
        if ((unsigned)ref.index >= width) fail(c, ref.name, "qubit index %d is outside '%s' (size %u)", ref.index, ref.name.text, width);
        *start += (unsigned)ref.index; width = 1;
    }
    for (unsigned i = 0; i < width; i++) if (c->measured & (1u << (*start+i)))
        fail(c, ref.name, "qubit '%s' has already been measured", ref.name.text);
    return width;
}
static void emit(Context *c, KetOp op) {
    KetProgram *p = c->program;
    if (p->count == KET_MAX_OPS) fail(c, (Token){.span=op.span}, "expanded circuit exceeds 100000 operations");
    if (p->count == p->capacity) {
        size_t capacity = p->capacity ? p->capacity * 2 : 64;
        KetOp *ops = realloc(p->ops, capacity * sizeof(*ops));
        if (!ops) fail(c, (Token){.span=op.span}, "out of memory");
        p->ops = ops; p->capacity = capacity;
    }
    p->ops[p->count++] = op;
}
static void gate(Context *c, KetOpKind kind, unsigned a, unsigned b, unsigned d, double angle, Token t) {
    emit(c, (KetOp){.kind=kind, .q={a,b,d}, .angle=angle, .span=t.span});
}

/* decompose exp(i*pi*x0*...*xn) into parity phases, without ancillary qubits. */
static void multi_z(Context *c, unsigned start, unsigned width, Token t) {
    if (!width) fail(c, t, "phase operation requires at least one qubit");
    if (width == 1) { gate(c, K_Z, start, 0, 0, 0, t); return; }
    if (width == 2) { gate(c, K_CZ, start, start+1, 0, 0, t); return; }
    if (width == 3) {
        gate(c, K_H, start+2, 0, 0, 0, t);
        gate(c, K_CCX, start, start+1, start+2, 0, t);
        gate(c, K_H, start+2, 0, 0, 0, t); return;
    }
    if (width > 10) fail(c, t, "exact oracle/diffusion decomposition is limited to 10 qubits; no gates were omitted");
    double angle = PI / (double)(1u << (width-1));
    for (unsigned subset = 1; subset < (1u << width); subset++) {
        unsigned last = 0, count = 0;
        for (unsigned i = 0; i < width; i++) if (subset & (1u << i)) { last = i; count++; }
        for (unsigned i = 0; i < last; i++) if (subset & (1u << i)) gate(c, K_CX, start+i, start+last, 0, 0, t);
        gate(c, K_PHASE, start+last, 0, 0, count % 2 ? angle : -angle, t);
        for (unsigned i = 0; i < last; i++) if (subset & (1u << i)) gate(c, K_CX, start+i, start+last, 0, 0, t);
    }
}

static void lower(Context *c, Env *env, Node *nodes, bool nested, bool in_gate);
static void lower_gate(Context *c, Env *env, Node *n) {
    const char *names[] = {"H","X","Y","Z","S","T","Rx","Ry","Rz","CNOT","CZ","SWAP","Toffoli"};
    int kind = -1;
    for (unsigned i = 0; i < sizeof(names)/sizeof(*names); i++) if (!strcmp(n->name.text, names[i])) kind = (int)i;
    if (kind >= 0) {
        unsigned arity = kind < K_CX ? 1 : kind == K_CCX ? 3 : 2;
        if (n->nargs != arity) fail(c, n->name, "%s expects %u operands, got %u", n->name.text, arity, n->nargs);
        bool rotation = kind >= K_RX && kind <= K_RZ;
        if (rotation != (n->expr != NULL)) fail(c, n->name, rotation ? "rotation requires an angle" : "this gate does not take an angle");
        double angle = rotation ? evaluate(c, env, n->expr) : 0;
        unsigned q[3] = {0}, width = 1;
        for (unsigned i = 0; i < arity; i++) {
            unsigned size = resolve(c, env, n->refs[i], &q[i]);
            if (arity > 1 && size != 1) fail(c, n->refs[i].name, "multi-qubit gates require individual qubits; index the register");
            if (arity == 1) width = size;
            for (unsigned j = 0; j < i; j++) if (q[i] == q[j]) fail(c, n->name, "gate operands must be distinct qubits");
        }
        for (unsigned i = 0; i < width; i++) gate(c, (KetOpKind)kind, q[0]+i, q[1], q[2], angle, n->token);
        return;
    }
    if (!strcmp(n->name.text, "qft") || !strcmp(n->name.text, "diffuse") || !strcmp(n->name.text, "grover_diffuse")) {
        if (n->nargs != 1 || n->expr) fail(c, n->name, "algorithm expects exactly one quantum operand and no angle");
        unsigned start, width = resolve(c, env, n->refs[0], &start);
        if (!strcmp(n->name.text, "qft")) {
            for (unsigned j = 0; j < width; j++) {
                gate(c, K_H, start+j, 0, 0, 0, n->token);
                for (unsigned k = j+1; k < width; k++)
                    gate(c, K_CP, start+k, start+j, 0, PI / (double)(1u << (k-j)), n->token);
            }
            for (unsigned i = 0; i < width/2; i++) gate(c, K_SWAP, start+i, start+width-1-i, 0, 0, n->token);
        } else {
            for (unsigned i = 0; i < width; i++) gate(c, K_H, start+i, 0, 0, 0, n->token);
            for (unsigned i = 0; i < width; i++) gate(c, K_X, start+i, 0, 0, 0, n->token);
            multi_z(c, start, width, n->token);
            for (unsigned i = 0; i < width; i++) gate(c, K_X, start+i, 0, 0, 0, n->token);
            for (unsigned i = 0; i < width; i++) gate(c, K_H, start+i, 0, 0, 0, n->token);
            /* the reflection has the opposite global phase; these four gates
               correct it so amplitude inspection matches the diffusion matrix. */
            gate(c, K_X, start, 0, 0, 0, n->token);
            gate(c, K_Z, start, 0, 0, 0, n->token);
            gate(c, K_X, start, 0, 0, 0, n->token);
            gate(c, K_Z, start, 0, 0, 0, n->token);
        }
        return;
    }
    Def *d = find_def(c, n->name.text);
    if (!d || !d->gate) fail(c, n->name, "unknown gate '%s'", n->name.text);
    if (d->active) fail(c, n->name, "recursive gate expansion involving '%s'", n->name.text);
    if (n->nargs != d->nargs || n->expr) fail(c, n->name, "gate '%s' expects %u qubit operands and no angle", n->name.text, d->nargs);
    /* gate scopes contain only parameters and expire after each expansion. */
    Binding parameters[KET_MAX_QUBITS] = {0};
    Env local = {.entries=parameters, .capacity=KET_MAX_QUBITS};
    for (unsigned i = 0; i < d->nargs; i++) {
        unsigned start, width = resolve(c, env, n->refs[i], &start);
        if (width != 1) fail(c, n->refs[i].name, "custom gates require individual qubits");
        for (unsigned j = 0; j < i; j++) if (local.entries[j].start == start) fail(c, n->name, "custom gate operands must be distinct qubits");
        Binding *b = bind(c, &local, d->params[i], B_QUANTUM); b->start = start; b->width = 1;
    }
    d->active = true; lower(c, &local, d->body, true, true); d->active = false;
}

static uint32_t bit_value(const char *bits) {
    uint32_t n = 0;
    for (; *bits; bits++) n = (n << 1) | (unsigned)(*bits-'0');
    return n;
}
static void lower(Context *c, Env *env, Node *nodes, bool nested, bool in_gate) {
    enter(c);
    if (++c->work > MAX_WORK) fail(c, c->token, "circuit expansion work limit exceeded");
    for (Node *n = nodes; n; n = n->next) {
        if (++c->work > MAX_WORK) fail(c, n->token, "circuit expansion work limit exceeded");
        switch (n->kind) {
            case N_QUBIT: case N_BIT: {
                if (nested) fail(c, n->token, "declarations are only allowed at circuit/top level");
                Binding *b = bind(c, env, n->name, n->kind == N_QUBIT ? B_QUANTUM : B_UNUSED_BIT);
                b->width = n->width;
                if (n->kind == N_QUBIT) {
                    if (c->program->qubits + n->width > KET_MAX_QUBITS) fail(c, n->token, "local simulation is limited to 20 qubits");
                    b->start = c->program->qubits; c->program->qubits += n->width;
                }
                break;
            }
            case N_GATE: lower_gate(c, env, n); break;
            case N_ORACLE: {
                unsigned start, width = resolve(c, env, n->refs[0], &start);
                const char *bits = n->match.text;
                if (n->match.kind == T_ID) {
                    Binding *b = lookup(env, n->match.text);
                    if (!b || b->kind != B_BITS) fail(c, n->match, "expected a bitstring parameter");
                    bits = b->bits;
                }
                if (strlen(bits) != width) fail(c, n->match, "oracle bitstring width does not match the quantum operand (%u)", width);
                for (unsigned i = 0; i < width; i++) if (bits[i] == '0') gate(c, K_X, start+i, 0, 0, 0, n->token);
                multi_z(c, start, width, n->token);
                for (unsigned i = 0; i < width; i++) if (bits[i] == '0') gate(c, K_X, start+i, 0, 0, 0, n->token);
                break;
            }
            case N_MEASURE: {
                if (nested || in_gate) fail(c, n->token, "measurement bindings are only allowed at circuit/top level");
                unsigned start, width = resolve(c, env, n->refs[0], &start);
                Binding *b = bind(c, env, n->name, B_CLASSICAL); b->width = width;
                KetProgram *p = c->program; b->classical = p->nclassical++;
                KetClassical *r = &p->classical[b->classical]; r->width = width;
                strcpy(r->name, n->name.text); p->bits += width;
                emit(c, (KetOp){.kind=K_MEASURE,.q={start},.width=width,.classical=b->classical,.span=n->token.span});
                for (unsigned i = 0; i < width; i++) c->measured |= 1u << (start+i);
                break;
            }
            case N_REPEAT: {
                double count = evaluate(c, env, n->expr);
                if (count < 0 || count > 10000 || floor(count) != count) fail(c, n->token, "repeat count must be an integer between 0 and 10000");
                /* check zero-repeat bodies too, then discard their operations. */
                size_t saved = c->program->count;
                unsigned iterations = count == 0 ? 1 : (unsigned)count;
                for (unsigned i = 0; i < iterations; i++) lower(c, env, n->body, true, in_gate);
                if (count == 0) c->program->count = saved;
                break;
            }
            case N_IF: {
                if (in_gate) fail(c, n->token, "custom gates must be unitary; classical conditions belong in circuits");
                Binding *b = lookup(env, n->name.text);
                if (!b || b->kind != B_CLASSICAL) fail(c, n->name, "condition requires a previous measurement binding");
                uint32_t value;
                if (n->match.kind == T_KET) {
                    if (strlen(n->match.text) != b->width) fail(c, n->match, "condition bitstring width must match the measurement (%u)", b->width);
                    value = bit_value(n->match.text);
                } else value = integer(c, n->match, (1u << b->width)-1, "condition value");
                size_t index = c->program->count;
                emit(c, (KetOp){.kind=K_IF,.classical=b->classical,.value=value,.span=n->token.span});
                lower(c, env, n->body, true, false); c->program->ops[index].end = c->program->count;
                break;
            }
        }
    }
    c->depth--;
}

static void parse_program(Context *c) {
    next(c);
    Node *top = NULL, **tail = &top;
    Token run = {0}, args[KET_MAX_QUBITS] = {{0}};
    Expr *exprs[KET_MAX_QUBITS] = {0};
    unsigned nargs = 0;
    bool has_run = false;
    while (c->token.kind != T_END) {
        if (take(c, ';')) continue;
        if (is(c, "gate") || is(c, "circuit")) definition(c);
        else if (is(c, "run")) {
            if (has_run) fail(c, c->token, "a program must have at most one run statement");
            has_run = true; next(c); run = expect(c, T_ID, "a circuit name"); expect(c, '(', "'('");
            if (!take(c, ')')) {
                do {
                    if (nargs == KET_MAX_QUBITS) fail(c, c->token, "too many run arguments");
                    args[nargs] = c->token;
                    if (!take(c, T_KET)) exprs[nargs] = expression(c, 0);
                    nargs++;
                } while (take(c, ','));
                expect(c, ')', "')'");
            }
            if (is(c, "on")) {
                next(c);
                if (!is(c, "local") && !is(c, "ibm")) fail(c, c->token, "backend must be local or ibm");
                c->program->remote = is(c, "ibm"); next(c);
            }
            take(c, ';');
        } else { *tail = statement(c); tail = &(*tail)->next; }
    }
    Env *env = allocate(c, sizeof(*env));
    env->capacity = MAX_BINDINGS;
    env->entries = allocate(c, MAX_BINDINGS * sizeof(*env->entries));
    Node *body = top;
    if (has_run) {
        if (top) fail(c, top->token, "top-level executable statements cannot be combined with run; put them in the circuit");
        Def *d = find_def(c, run.text);
        if (!d || d->gate) fail(c, run, "unknown circuit '%s'", run.text);
        if (nargs != d->nargs) fail(c, run, "circuit '%s' expects %u arguments, got %u", run.text, d->nargs, nargs);
        for (unsigned i = 0; i < nargs; i++) {
            bool bits = !strcmp(d->types[i].text, "bitstring");
            if (bits != (args[i].kind == T_KET)) fail(c, args[i], "argument for '%s' must have type %s", d->params[i].text, d->types[i].text);
            /* arguments cannot refer to parameters being bound by this call. */
            Env empty = {0};
            double number = bits ? 0 : evaluate(c, &empty, exprs[i]);
            Binding *b = bind(c, env, d->params[i], bits ? B_BITS : B_ANGLE);
            if (bits) strcpy(b->bits, args[i].text); else b->number = number;
        }
        body = d->body;
    }
    if (!body) fail(c, c->token, "program has no executable circuit; add run circuit_name()");
    lower(c, env, body, false, false);
    if (!c->program->qubits) fail(c, c->token, "program must declare at least one qubit");
    if (!c->program->nclassical) {
        KetProgram *p = c->program;
        p->nclassical = 1; p->bits = p->qubits;
        p->classical[0].width = p->qubits; strcpy(p->classical[0].name, "result");
        emit(c, (KetOp){.kind=K_MEASURE,.width=p->qubits,.span=c->token.span});
    }
}

bool ket_compile(const char *source, KetProgram **out, KetDiagnostic *error) {
    *out = NULL; memset(error, 0, sizeof(*error));
    if (strlen(source) > KET_MAX_SOURCE) { strcpy(error->message, "source exceeds 1 MiB"); return false; }
    Context *c = calloc(1, sizeof(*c));
    if (!c) { strcpy(error->message, "out of memory"); return false; }
    c->source = source; c->error = error; c->line = c->column = 1;
    c->program = calloc(1, sizeof(*c->program));
    bool ok = false;
    if (!c->program) strcpy(error->message, "out of memory");
    else if (!setjmp(c->escape)) { parse_program(c); *out = c->program; ok = true; }
    for (Allocation *a = c->allocations; a;) { Allocation *next_a = a->next; free(a->data); free(a); a = next_a; }
    if (!ok) ket_program_free(c->program);
    free(c); return ok;
}
void ket_program_free(KetProgram *p) { if (p) { free(p->ops); free(p); } }

void ket_diagnostic(FILE *out, const char *path, const char *source, const KetDiagnostic *error) {
    unsigned line = error->span.line ? error->span.line : 1;
    unsigned column = error->span.column ? error->span.column : 1;
    fprintf(out, "%s:%u:%u: error: %s\n", path, line, column, error->message);
    size_t length = strlen(source), offset = error->span.offset;
    if (offset > length) return;
    size_t start = offset, end = offset;
    while (start && source[start-1] != '\n') start--;
    while (end < length && source[end] != '\n' && source[end] != '\r') end++;
    if (end - start > 240) return;
    fprintf(out, "  %.*s\n  ", (int)(end-start), source+start);
    for (size_t i = start; i < offset; i++) {
        unsigned char b = (unsigned char)source[i];
        if ((b & 0xc0) != 0x80) fputc(b == '\t' ? '\t' : ' ', out);
    }
    fputs("^\n", out);
}
