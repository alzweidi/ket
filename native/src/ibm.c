#define _POSIX_C_SOURCE 200809L
#include "ibm.h"
#include <ctype.h>
#include <curl/curl.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <time.h>
#include <unistd.h>

#define RESPONSE_LIMIT (256u * 1024u * 1024u)
#define API_VERSION "2026-04-15"

#ifdef KET_IBM_TEST
#define TEST_URL(name, fallback) (getenv(name) ? getenv(name) : (fallback))
#else
#define TEST_URL(name, fallback) (fallback)
#endif

typedef struct { char *data; size_t length, capacity; } Buffer;
typedef struct {
    CURL *curl;
    const char *base;
    struct curl_slist *headers;
    KetDiagnostic *error;
} Client;

static size_t receive(char *chunk, size_t size, size_t count, void *user) {
    Buffer *b = user;
    if (size && count > (RESPONSE_LIMIT - b->length) / size) return 0;
    size_t n = size*count, need = b->length+n+1;
    if (need > b->capacity) {
        size_t capacity = b->capacity ? b->capacity*2 : 4096;
        if (capacity < need) capacity = need;
        char *next = realloc(b->data, capacity);
        if (!next) return 0;
        b->data = next; b->capacity = capacity;
    }
    memcpy(b->data+b->length, chunk, n);
    b->length += n; b->data[b->length] = 0;
    return n;
}
static const char *field(json_object *obj, const char *key) {
    if (!json_object_is_type(obj, json_type_object)) return NULL;
    json_object *v = json_object_object_get(obj, key);
    return json_object_is_type(v, json_type_string) ? json_object_get_string(v) : NULL;
}
static json_object *request(Client *c, const char *url, const char *body,
                            struct curl_slist *headers) {
    for (unsigned attempt = 0;; attempt++) {
        Buffer b = {0};
        curl_easy_reset(c->curl);
        curl_easy_setopt(c->curl, CURLOPT_URL, url);
#ifdef KET_IBM_TEST
        curl_easy_setopt(c->curl, CURLOPT_NOPROXY, "*");
#endif
        curl_easy_setopt(c->curl, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(c->curl, CURLOPT_WRITEFUNCTION, receive);
        curl_easy_setopt(c->curl, CURLOPT_WRITEDATA, &b);
        curl_easy_setopt(c->curl, CURLOPT_CONNECTTIMEOUT, 10L);
        curl_easy_setopt(c->curl, CURLOPT_TIMEOUT, 60L);
        curl_easy_setopt(c->curl, CURLOPT_NOSIGNAL, 1L);
        curl_easy_setopt(c->curl, CURLOPT_ACCEPT_ENCODING, "");
        curl_easy_setopt(c->curl, CURLOPT_USERAGENT, "ket/" KET_VERSION);
        if (body) curl_easy_setopt(c->curl, CURLOPT_POSTFIELDS, body);
        CURLcode rc = curl_easy_perform(c->curl);
        long status = 0;
        curl_easy_getinfo(c->curl, CURLINFO_RESPONSE_CODE, &status);
        if (rc != CURLE_OK) {
            snprintf(c->error->message, sizeof(c->error->message), "IBM request failed: %s", curl_easy_strerror(rc));
            free(b.data); return NULL;
        }
        if (status == 429 && attempt < 2) {
            curl_off_t after = 0;
            curl_easy_getinfo(c->curl, CURLINFO_RETRY_AFTER, &after);
            if (after <= 60) {
                free(b.data); sleep(after > 0 ? (unsigned)after : 1u << attempt); continue;
            }
        }
        json_object *json = b.data ? json_tokener_parse(b.data) : NULL;
        free(b.data);
        if (status < 200 || status >= 300) {
            const char *message = field(json, "message");
            if (!message) message = field(json, "errorMessage");
            json_object *errors = json_object_object_get(json, "errors");
            if (!message && json_object_is_type(errors, json_type_array) && json_object_array_length(errors))
                message = field(json_object_array_get_idx(errors, 0), "message");
            snprintf(c->error->message, sizeof(c->error->message), "IBM returned HTTP %ld%s%.180s",
                     status, message ? ": " : "", message ? message : "");
            json_object_put(json); return NULL;
        }
        if (!json_object_is_type(json, json_type_object)) {
            strcpy(c->error->message, "invalid JSON response from IBM"); json_object_put(json); return NULL;
        }
        return json;
    }
}
static bool header(Client *c, const char *name, const char *value) {
    if (strpbrk(value, "\r\n")) { strcpy(c->error->message, "invalid IBM header value"); return false; }
    size_t n = strlen(name)+strlen(value)+1;
    char *line = malloc(n);
    if (line) {
        snprintf(line,n,"%s%s",name,value);
        struct curl_slist *added = curl_slist_append(c->headers, line);
        free(line);
        if (added) { c->headers = added; return true; }
    }
    strcpy(c->error->message, "out of memory preparing IBM headers"); return false;
}
static bool authenticate(Client *c, const IBMConfig *cfg) {
    char *escaped = curl_easy_escape(c->curl, cfg->token, 0);
    const char prefix[] = "grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=";
    char *form = escaped ? malloc(strlen(escaped)+sizeof(prefix)) : NULL;
    if (!form) { curl_free(escaped); strcpy(c->error->message, "out of memory preparing IBM authentication"); return false; }
    strcpy(form, prefix); strcat(form, escaped); curl_free(escaped);
    const char *iam = TEST_URL("KET_TEST_IAM", "https://iam.cloud.ibm.com/identity/token");
    json_object *reply = request(c, iam, form, NULL);
    free(form);
    if (!reply) return false;
    const char *token = field(reply, "access_token");
    bool ok = token && *token;
    if (!ok) strcpy(c->error->message, "IBM IAM returned no access token");
    if (ok) ok = header(c, "Authorization: Bearer ", token) && header(c, "Service-CRN: ", cfg->instance) &&
                 header(c, "IBM-API-Version: ", API_VERSION) && header(c, "Content-Type: ", "application/json") &&
                 header(c, "Accept: ", "application/json");
    json_object_put(reply); return ok;
}
static json_object *api(Client *c, const char *path, json_object *body) {
    char url[1024];
    int len = snprintf(url, sizeof(url), "%s/%s", c->base, path);
    if (len < 0 || (size_t)len >= sizeof(url)) { strcpy(c->error->message, "IBM request path too long"); return NULL; }
    return request(c, url, body ? json_object_to_json_string_ext(body, JSON_C_TO_STRING_PLAIN) : NULL, c->headers);
}
static json_object *job_body(const IBMConfig *cfg, const char *assembly, unsigned shots) {
    json_object *body = json_object_new_object(), *params = json_object_new_object();
    json_object *pubs = json_object_new_array(), *pub = json_object_new_array();
    json_object_array_add(pub, json_object_new_string(assembly));
    json_object_array_add(pub, NULL);
    json_object_array_add(pub, json_object_new_int64(shots));
    json_object_array_add(pubs, pub);
    json_object_object_add(params, "pubs", pubs);
    json_object_object_add(params, "version", json_object_new_int(2));
    json_object_object_add(body, "program_id", json_object_new_string("sampler"));
    json_object_object_add(body, "backend", json_object_new_string(cfg->backend));
    json_object_object_add(body, "params", params); return body;
}
static bool results(const KetProgram *p, unsigned shots, json_object *reply, KetResult *r, KetDiagnostic *e) {
    json_object *entries = json_object_object_get(reply, "results");
    json_object *data = NULL, *samples[KET_MAX_QUBITS];
    if (json_object_is_type(entries, json_type_array) && json_object_array_length(entries) == 1)
        data = json_object_object_get(json_object_array_get_idx(entries, 0), "data");
    for (unsigned i = 0; i < p->nclassical; i++) {
        char name[16]; snprintf(name,sizeof(name),"m%u",i);
        samples[i] = json_object_object_get(json_object_object_get(data, name), "samples");
        if (!json_object_is_type(samples[i], json_type_array) || json_object_array_length(samples[i]) != shots) {
            strcpy(e->message, "IBM returned missing samples or an unexpected shot count"); return false;
        }
    }
    r->bits = p->bits; r->shots = shots;
    r->counts = calloc((size_t)1 << p->bits, sizeof(*r->counts));
    if (!r->counts) { strcpy(e->message, "out of memory decoding IBM samples"); return false; }
    for (unsigned j = 0; j < shots; j++) {
        uint32_t packed = 0;
        for (unsigned i = 0; i < p->nclassical; i++) {
            json_object *item = json_object_array_get_idx(samples[i], j);
            const char *s = json_object_is_type(item, json_type_string) ? json_object_get_string(item) : NULL;
            unsigned width = p->classical[i].width;
            uint32_t v = 0;
            if (!s || strncasecmp(s,"0x",2) || !s[2]) goto bad_sample;
            for (s+=2; *s; s++) {
                if (!isxdigit((unsigned char)*s)) goto bad_sample;
                unsigned digit = *s <= '9' ? (unsigned)(*s-'0') : (unsigned)(tolower((unsigned char)*s)-'a'+10);
                v = v*16+digit;
                if (v >= (1u << width)) goto bad_sample;
            }
            packed = (packed << width) | v;
        }
        r->counts[packed]++;
    }
    return true;
bad_sample:
    ket_result_free(r); strcpy(e->message, "invalid hexadecimal sample returned by IBM"); return false;
}
static bool poll_job(Client *c, const char *id, const KetProgram *p, unsigned shots, KetResult *r) {
    char path[256];
    snprintf(path, sizeof(path), "jobs/%s?exclude_params=true", id);
    unsigned delay = 2;
    struct timespec start, now;
    clock_gettime(CLOCK_MONOTONIC, &start);
    for (;;) {
        json_object *reply = api(c, path, NULL);
        if (!reply) return false;
        json_object *state = json_object_object_get(reply, "state");
        const char *status = field(state, "status");
        if (!status) status = field(reply, "status");
        bool done = status && (!strcasecmp(status, "completed") || !strcasecmp(status, "done"));
        bool active = status && (!strcasecmp(status, "queued") || !strcasecmp(status, "running") ||
                                 !strcasecmp(status, "pending") || !strcasecmp(status, "validating"));
        if (!done && !active) {
            const char *reason = field(state, "reason");
            snprintf(c->error->message, sizeof(c->error->message), "IBM job %.80s: %.40s%s%.80s",
                     id, status ? status : "missing status", reason ? " - " : "", reason ? reason : "");
        }
        json_object_put(reply);
        if (done) break;
        if (!active) return false;
        clock_gettime(CLOCK_MONOTONIC, &now);
        if (now.tv_sec - start.tv_sec >= 300) {
            snprintf(c->error->message, sizeof(c->error->message), "IBM job %s is still queued or running; check it in IBM Quantum", id);
            return false;
        }
        sleep(delay); if (delay < 8) delay *= 2;
    }
    snprintf(path, sizeof(path), "jobs/%s/results", id);
    json_object *reply = api(c, path, NULL);
    bool ok = reply && results(p, shots, reply, r, c->error);
    json_object_put(reply); return ok;
}

bool ibm_run(const KetProgram *p, unsigned shots, KetResult *r, KetDiagnostic *e) {
    *r = (KetResult){0};
    if (!ket_validate(p, e)) return false;
    IBMConfig cfg;
    if (!ibm_config(&cfg, e)) return false;
    const char *base = strstr(cfg.instance, ":quantum-computing:eu-de:") ?
        "https://eu-de.quantum.cloud.ibm.com/api/v1" : "https://quantum.cloud.ibm.com/api/v1";
    Client client = {.base=TEST_URL("KET_TEST_RUNTIME", base), .error=e};
    client.curl = curl_easy_init();
    if (!client.curl) { strcpy(e->message, "cannot initialise the IBM HTTP client"); return false; }
    bool ok = false;
    if (authenticate(&client, &cfg)) {
        char path[192]; snprintf(path,sizeof(path),"backends/%s/configuration",cfg.backend);
        json_object *device = api(&client, path, NULL);
        char *assembly = device ? ibm_assembly(p, device, e) : NULL;
        json_object_put(device);
        if (assembly) {
            json_object *body = job_body(&cfg, assembly, shots);
            free(assembly);
            json_object *reply = api(&client, "jobs", body);
            json_object_put(body);
            if (reply) {
                const char *id = field(reply, "id");
                if (!id || !*id || strlen(id) > 120 || strspn(id,"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") != strlen(id))
                    strcpy(e->message, "IBM returned an invalid job ID");
                else {
                    fprintf(stderr, "IBM job %s on %s\n", id, cfg.backend);
                    ok = poll_job(&client, id, p, shots, r);
                }
                json_object_put(reply);
            }
        }
    }
    curl_slist_free_all(client.headers); curl_easy_cleanup(client.curl); return ok;
}
