#ifndef KET_OUTPUT_H
#define KET_OUTPUT_H

#include "ket.h"

void ket_print_result(FILE *out, const KetProgram *program, const KetResult *result,
                      bool json, bool hardware);
void ket_print_state(FILE *out, const KetState *state, bool json);

#endif
