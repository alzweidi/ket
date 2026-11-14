#define _POSIX_C_SOURCE 200809L
#include "ibm.h"
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static const char *const variables[] = {"IBM_QUANTUM_TOKEN", "IBM_QUANTUM_INSTANCE", "IBM_QUANTUM_BACKEND"};
static const char *const keys[] = {"token", "instance", "backend"};

static bool assign(IBMConfig *c, unsigned field, const char *value, KetDiagnostic *e) {
    char *fields[] = {c->token, c->instance, c->backend};
    size_t sizes[] = {sizeof(c->token), sizeof(c->instance), sizeof(c->backend)};
    if (strlen(value) >= sizes[field] || strpbrk(value, "\r\n")) {
        snprintf(e->message, sizeof(e->message), "invalid value for %s", variables[field]); return false;
    }
    strcpy(fields[field], value); return true;
}
static char *config_path(const char *suffix) {
    const char *home = getenv("HOME");
    if (!home || !*home) return NULL;
    size_t n = strlen(home) + strlen(suffix) + 1;
    char *path = malloc(n);
    if (path) snprintf(path, n, "%s%s", home, suffix);
    return path;
}
static char *trim(char *s) {
    while (isspace((unsigned char)*s)) s++;
    char *end = s + strlen(s);
    while (end > s && isspace((unsigned char)end[-1])) end--;
    *end = 0; return s;
}
static bool from_dotenv(IBMConfig *c, KetDiagnostic *e) {
    FILE *f = fopen(".env", "r");
    if (!f) {
        if (errno == ENOENT) return true;
        strcpy(e->message, "cannot read .env"); return false;
    }
    char *line = NULL; size_t cap = 0;
    bool ok = true;
    while (ok && getline(&line, &cap, f) >= 0) {
        char *eq = strchr(line, '=');
        if (!eq) continue;
        *eq = 0;
        char *key = trim(line), *value = trim(eq+1);
        size_t n = strlen(value);
        if (n >= 2 && (*value == '"' || *value == '\'') && value[n-1] == *value) {
            value[n-1] = 0; value++;
        }
        for (unsigned i = 0; i < 3; i++)
            if (!strcmp(key, variables[i]) && !assign(c, i, value, e)) ok = false;
    }
    if (ferror(f)) { strcpy(e->message, "cannot read .env"); ok = false; }
    free(line); fclose(f); return ok;
}
bool ibm_config(IBMConfig *c, KetDiagnostic *e) {
    *c = (IBMConfig){0};
    char *path = config_path("/.ket/config");
    if (path && access(path, F_OK) == 0) {
        json_object *root = json_object_from_file(path);
        json_object *ibm = json_object_object_get(root, "ibm");
        bool ok = json_object_is_type(root, json_type_object) && (!ibm || json_object_is_type(ibm, json_type_object));
        for (unsigned i = 0; ok && i < 3; i++) {
            json_object *v = json_object_object_get(ibm, keys[i]);
            if (v) ok = json_object_is_type(v, json_type_string) && assign(c, i, json_object_get_string(v), e);
        }
        json_object_put(root);
        if (!ok) { free(path); strcpy(e->message, "invalid IBM configuration in ~/.ket/config"); return false; }
    }
    free(path);
    if (!from_dotenv(c, e)) return false;
    for (unsigned i = 0; i < 3; i++) {
        const char *v = getenv(variables[i]);
        if (v && !assign(c, i, v, e)) return false;
    }
    if (!c->token[0] || strncmp(c->instance, "crn:", 4) || !c->backend[0]) {
        strcpy(e->message, "IBM remote execution needs an IBM Cloud API key, an instance CRN and a backend name"); return false;
    }
    for (const char *s = c->backend; *s; s++)
        if (!isalnum((unsigned char)*s) && *s != '_' && *s != '-') {
            strcpy(e->message, "invalid IBM backend name"); return false;
        }
    return true;
}
int ibm_auth(int argc, char **argv) {
    const char *fields[3] = {0};
    for (int i = 2; i < argc; i += 2) {
        unsigned n = !strcmp(argv[i], "--ibm") ? 0 : !strcmp(argv[i], "--instance") ? 1 : !strcmp(argv[i], "--backend") ? 2 : 3;
        if (n == 3 || fields[n] || i+1 >= argc) { fputs("ket: expected --ibm KEY, --instance CRN and --backend NAME\n", stderr); return 2; }
        fields[n] = argv[i+1];
    }
    IBMConfig c = {0}; KetDiagnostic e = {0};
    for (unsigned i = 0; i < 3; i++) {
        if (!fields[i]) fields[i] = getenv(variables[i]);
        if (!fields[i] || !*fields[i] || !assign(&c, i, fields[i], &e)) {
            fprintf(stderr, "ket: supply %s or its command-line option\n", variables[i]); return 2;
        }
    }
    if (strncmp(c.instance, "crn:", 4)) { fputs("ket: --instance needs an IBM Cloud CRN\n", stderr); return 2; }
    char *dir = config_path("/.ket"), *path = config_path("/.ket/config"), *tmp = config_path("/.ket/config.XXXXXX");
    bool ok = dir && path && tmp && (!mkdir(dir, 0700) || errno == EEXIST);
    int fd = ok ? mkstemp(tmp) : -1;
    json_object *root = json_object_new_object(), *ibm = json_object_new_object();
    json_object_object_add(root, "ibm", ibm);
    for (unsigned i = 0; i < 3; i++) json_object_object_add(ibm, keys[i], json_object_new_string(fields[i]));
    ok = fd >= 0;
    if (ok) {
        ok = json_object_to_fd(fd, root, JSON_C_TO_STRING_PRETTY) == 0;
        if (close(fd)) ok = false;
        if (ok) ok = rename(tmp, path) == 0;
        if (!ok) unlink(tmp);
    }
    free(dir); free(path); free(tmp); json_object_put(root);
    if (!ok) { fputs("ket: could not save ~/.ket/config\n", stderr); return 1; }
    puts("IBM Quantum credentials saved."); return 0;
}
