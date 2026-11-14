#ifndef KET_IBM_H
#define KET_IBM_H

#include "ir.h"
#include <json-c/json.h>

typedef struct { char token[4096], instance[1024], backend[128]; } IBMConfig;
bool ibm_config(IBMConfig *config, KetDiagnostic *error);
int ibm_auth(int argc, char **argv);
bool ibm_run(const KetProgram *program, unsigned shots, KetResult *result, KetDiagnostic *error);
char *ibm_assembly(const KetProgram *program, json_object *device, KetDiagnostic *error);

#endif
