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
typedef struct KetProgram KetProgram;

/* the program owns its storage; the caller can free the source after compilation. */
bool ket_compile(const char *source, KetProgram **out, KetDiagnostic *error);
void ket_program_free(KetProgram *program);

typedef struct {
    unsigned qubits, bits, measurements;
    size_t operations;
    bool remote;
} KetProgramInfo;
KetProgramInfo ket_program_info(const KetProgram *program);
/* the name belongs to the program. an unknown index returns null. */
const char *ket_measurement_name(const KetProgram *program, unsigned index, unsigned *width);
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
