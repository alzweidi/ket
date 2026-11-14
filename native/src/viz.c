#define _POSIX_C_SOURCE 200809L
#include "ket.h"
#include <spawn.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>
#include <errno.h>

extern char **environ;

bool ket_viz(const char *source, bool print_only) {
    static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const char *base = getenv("KET_PLAYGROUND_URL");
    if (!base || !*base) base = "https://ket-playground.vercel.app/";
    if ((strncmp(base, "http://", 7) && strncmp(base, "https://", 8)) || strpbrk(base, "?#\r\n")) {
        fputs("ket: KET_PLAYGROUND_URL must be an HTTP or HTTPS address without a query or fragment\n", stderr);
        return false;
    }
    size_t n = strlen(source), size = strlen(base) + 4 + (n+2)/3*4;
    char *url = malloc(size);
    if (!url) return false;
    size_t pos = (size_t)snprintf(url, size, "%s?p=", base);
    for (size_t i = 0; i < n; i += 3) {
        uint32_t word = (uint32_t)(unsigned char)source[i] << 16;
        if (i+1 < n) word |= (uint32_t)(unsigned char)source[i+1] << 8;
        if (i+2 < n) word |= (unsigned char)source[i+2];
        url[pos++] = alphabet[word >> 18]; url[pos++] = alphabet[(word >> 12) & 63];
        if (i+1 < n) url[pos++] = alphabet[(word >> 6) & 63];
        if (i+2 < n) url[pos++] = alphabet[word & 63];
    }
    url[pos] = 0;
    bool ok = true;
    if (print_only) puts(url);
    else {
#ifdef __APPLE__
        char opener[] = "open";
#else
        char opener[] = "xdg-open";
#endif
        char *args[] = {opener, url, NULL};
        pid_t child;
        ok = posix_spawnp(&child, opener, NULL, NULL, args, environ) == 0;
        if (ok) {
            int status;
            pid_t done;
            do { done = waitpid(child, &status, 0); } while (done < 0 && errno == EINTR);
            ok = done == child && WIFEXITED(status) && WEXITSTATUS(status) == 0;
        }
        if (!ok) fputs("ket: could not open the playground. Use ket viz FILE --url for the link.\n", stderr);
    }
    free(url); return ok;
}
