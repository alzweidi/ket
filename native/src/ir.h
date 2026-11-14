#ifndef KET_IR_H
#define KET_IR_H

#include "ket.h"

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
struct KetProgram {
    unsigned qubits, bits, nclassical;
    KetClassical classical[KET_MAX_QUBITS];
    KetOp *ops;
    size_t count, capacity;
    bool remote;
};

unsigned ket_arity(KetOpKind kind);
bool ket_validate(const KetProgram *program, KetDiagnostic *error);

#endif
