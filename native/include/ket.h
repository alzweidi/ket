#ifndef KET_H
#define KET_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <complex.h>

#define KET_VERSION "0.2.0-native"
#define KET_MAX_QUBITS 20
#define KET_MAX_OPS 100000
#define KET_MAX_SOURCE (1024 * 1024)
#define KET_NAME 64

typedef struct { size_t offset, length; unsigned line, column; } KetSpan;
typedef struct { KetSpan span; char message[256]; } KetDiagnostic;
typedef enum {
    K_H, K_X, K_Y, K_Z, K_S, K_T, K_RX, K_RY, K_RZ,
    K_CX, K_CZ, K_SWAP, K_CCX, K_CP, K_PHASE,
    K_MEASURE, K_IF
} KetOpKind;

/* backends receive resolved qubit indices. */
typedef struct {
    KetOpKind kind;
    unsigned q[3], width, classical;
    uint32_t value;
    double angle;
    size_t end;
    KetSpan span;
} KetOp;

typedef struct { char name[KET_NAME]; unsigned width; } KetClassical;
typedef struct {
    unsigned qubits, bits, nclassical;
    KetClassical classical[KET_MAX_QUBITS];
    KetOp *ops;
    size_t count, capacity;
    bool remote;
} KetProgram;

/* the program owns its storage; the caller can free the source after compilation. */
bool ket_compile(const char *source, KetProgram **out, KetDiagnostic *error);
void ket_program_free(KetProgram *program);
void ket_diagnostic(FILE *out, const char *path, const char *source,
                    const KetDiagnostic *error);

typedef struct { unsigned qubits; size_t size; double complex *amplitudes; } KetState;
typedef struct { unsigned bits; uint64_t shots, seed; uint64_t *counts; } KetResult;
bool ket_inspect(const KetProgram *program, KetState *state, KetDiagnostic *error);
bool ket_run(const KetProgram *program, uint64_t shots, uint64_t seed,
             KetResult *result, KetDiagnostic *error);
void ket_state_free(KetState *state);
void ket_result_free(KetResult *result);
bool ket_qasm(const KetProgram *program, FILE *out, KetDiagnostic *error);

#endif
