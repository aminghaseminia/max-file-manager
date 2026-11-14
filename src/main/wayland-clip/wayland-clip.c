#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <signal.h>
#include <poll.h>
#include <errno.h>
#include <sys/stat.h>
#include <wayland-client.h>

#include "ext-data-control-v1-client-protocol.h"
#include "wlr-data-control-unstable-v1-client-protocol.h"

static struct wl_display *display = NULL;
static struct wl_registry *registry = NULL;
static struct wl_seat *seat = NULL;

static struct ext_data_control_manager_v1 *ext_mgr = NULL;
static struct ext_data_control_device_v1 *ext_dev = NULL;
static struct ext_data_control_source_v1 *ext_src = NULL;

static struct zwlr_data_control_manager_v1 *wlr_mgr = NULL;
static struct zwlr_data_control_device_v1 *wlr_dev = NULL;
static struct zwlr_data_control_source_v1 *wlr_src = NULL;

static char *payload_uri_list = NULL;
static char *payload_gnome = NULL;
static char payload_kde_cut[4] = "0";
static char *payload_text = NULL;

static char single_image_path[4096] = {0};
static char single_image_mime[64] = {0};

static int stdin_closed = 0;

static void free_payloads(void) {
    free(payload_uri_list);
    free(payload_gnome);
    free(payload_text);
    payload_uri_list = NULL;
    payload_gnome = NULL;
    payload_text = NULL;
    strcpy(payload_kde_cut, "0");
    single_image_path[0] = '\0';
    single_image_mime[0] = '\0';
}

static void send_data_to_fd(const char *mime_type, int32_t fd) {
    if (single_image_mime[0] && strcmp(mime_type, single_image_mime) == 0 && single_image_path[0]) {
        int in_fd = open(single_image_path, O_RDONLY);
        if (in_fd >= 0) {
            char buf[65536];
            ssize_t r;
            while ((r = read(in_fd, buf, sizeof(buf))) > 0) {
                ssize_t w = write(fd, buf, (size_t)r);
                if (w <= 0) break;
            }
            close(in_fd);
            close(fd);
            return;
        }
    }

    const char *out = NULL;
    if (strcmp(mime_type, "text/uri-list") == 0) {
        out = payload_uri_list;
    } else if (strcmp(mime_type, "x-special/gnome-copied-files") == 0) {
        out = payload_gnome;
    } else if (strcmp(mime_type, "application/x-kde-cutselection") == 0) {
        out = payload_kde_cut;
    } else if (strstr(mime_type, "text/plain") != NULL) {
        out = payload_text;
    }

    if (out) {
        size_t len = strlen(out);
        size_t sent = 0;
        while (sent < len) {
            ssize_t w = write(fd, out + sent, len - sent);
            if (w <= 0) break;
            sent += (size_t)w;
        }
    }
    close(fd);
}

// ── ext listener ─────────────────────────────────────────────────────────────
static void ext_source_send(void *data, struct ext_data_control_source_v1 *source,
                            const char *mime_type, int32_t fd) {
    (void)data;
    (void)source;
    send_data_to_fd(mime_type, fd);
}

static void ext_source_cancelled(void *data, struct ext_data_control_source_v1 *source) {
    (void)data;
    (void)source;
    if (ext_src) {
        ext_data_control_source_v1_destroy(ext_src);
        ext_src = NULL;
    }
    free_payloads();
    if (stdin_closed) {
        exit(0);
    }
}

static const struct ext_data_control_source_v1_listener ext_src_listener = {
    .send = ext_source_send,
    .cancelled = ext_source_cancelled,
};

// ── wlr listener ─────────────────────────────────────────────────────────────
static void wlr_source_send(void *data, struct zwlr_data_control_source_v1 *source,
                            const char *mime_type, int32_t fd) {
    (void)data;
    (void)source;
    send_data_to_fd(mime_type, fd);
}

static void wlr_source_cancelled(void *data, struct zwlr_data_control_source_v1 *source) {
    (void)data;
    (void)source;
    if (wlr_src) {
        zwlr_data_control_source_v1_destroy(wlr_src);
        wlr_src = NULL;
    }
    free_payloads();
    if (stdin_closed) {
        exit(0);
    }
}

static const struct zwlr_data_control_source_v1_listener wlr_src_listener = {
    .send = wlr_source_send,
    .cancelled = wlr_source_cancelled,
};

// ── registry ─────────────────────────────────────────────────────────────────
static void registry_global(void *data, struct wl_registry *reg, uint32_t name,
                            const char *interface, uint32_t version) {
    (void)data;
    (void)version;
    if (strcmp(interface, ext_data_control_manager_v1_interface.name) == 0 && !ext_mgr) {
        ext_mgr = wl_registry_bind(reg, name, &ext_data_control_manager_v1_interface, 1);
    } else if (strcmp(interface, zwlr_data_control_manager_v1_interface.name) == 0 && !wlr_mgr) {
        wlr_mgr = wl_registry_bind(reg, name, &zwlr_data_control_manager_v1_interface, 1);
    } else if (strcmp(interface, "wl_seat") == 0 && !seat) {
        seat = wl_registry_bind(reg, name, &wl_seat_interface, 1);
    }
}

static void registry_global_remove(void *data, struct wl_registry *reg, uint32_t name) {
    (void)data;
    (void)reg;
    (void)name;
}

static const struct wl_registry_listener reg_listener = {
    .global = registry_global,
    .global_remove = registry_global_remove,
};

// ── url encoding ─────────────────────────────────────────────────────────────
static void append_url_encoded(char **dst, size_t *cap, size_t *len, const char *src) {
    for (const unsigned char *p = (const unsigned char *)src; *p; p++) {
        if ((*p >= 'a' && *p <= 'z') ||
            (*p >= 'A' && *p <= 'Z') ||
            (*p >= '0' && *p <= '9') ||
            *p == '/' || *p == '.' || *p == '_' || *p == '-' || *p == '~') {
            if (*len + 2 >= *cap) {
                *cap = (*cap * 2) + 64;
                *dst = realloc(*dst, *cap);
            }
            (*dst)[(*len)++] = (char)*p;
        } else {
            if (*len + 4 >= *cap) {
                *cap = (*cap * 2) + 64;
                *dst = realloc(*dst, *cap);
            }
            snprintf((*dst) + *len, *cap - *len, "%%%02X", *p);
            *len += 3;
        }
    }
    (*dst)[*len] = '\0';
}

static const char *detect_image_mime(const char *path) {
    const char *dot = strrchr(path, '.');
    if (!dot) return NULL;
    if (strcasecmp(dot, ".png") == 0) return "image/png";
    if (strcasecmp(dot, ".jpg") == 0 || strcasecmp(dot, ".jpeg") == 0) return "image/jpeg";
    if (strcasecmp(dot, ".webp") == 0) return "image/webp";
    if (strcasecmp(dot, ".gif") == 0) return "image/gif";
    if (strcasecmp(dot, ".bmp") == 0) return "image/bmp";
    return NULL;
}

static void apply_selection(char **paths, int count, int cut) {
    free_payloads();

    if (count <= 0) {
        if (ext_dev) ext_data_control_device_v1_set_selection(ext_dev, NULL);
        if (wlr_dev) zwlr_data_control_device_v1_set_selection(wlr_dev, NULL);
        if (ext_src) { ext_data_control_source_v1_destroy(ext_src); ext_src = NULL; }
        if (wlr_src) { zwlr_data_control_source_v1_destroy(wlr_src); wlr_src = NULL; }
        wl_display_flush(display);
        return;
    }

    if (count == 1 && paths[0]) {
        const char *img_mime = detect_image_mime(paths[0]);
        if (img_mime) {
            strncpy(single_image_path, paths[0], sizeof(single_image_path) - 1);
            strncpy(single_image_mime, img_mime, sizeof(single_image_mime) - 1);
        }
    }

    snprintf(payload_kde_cut, sizeof(payload_kde_cut), "%d", cut ? 1 : 0);

    size_t uri_cap = 256, uri_len = 0;
    payload_uri_list = malloc(uri_cap);
    payload_uri_list[0] = '\0';

    size_t gnome_cap = 256, gnome_len = 0;
    payload_gnome = malloc(gnome_cap);
    strcpy(payload_gnome, cut ? "cut\n" : "copy\n");
    gnome_len = strlen(payload_gnome);

    size_t text_cap = 256, text_len = 0;
    payload_text = malloc(text_cap);
    payload_text[0] = '\0';

    for (int i = 0; i < count; i++) {
        const char *p = paths[i];
        if (!p || !p[0]) continue;

        // text/plain
        size_t plen = strlen(p);
        while (text_len + plen + 2 >= text_cap) {
            text_cap = (text_cap * 2) + 64;
            payload_text = realloc(payload_text, text_cap);
        }
        memcpy(payload_text + text_len, p, plen);
        text_len += plen;
        payload_text[text_len++] = '\n';
        payload_text[text_len] = '\0';

        // file:// URL
        const char *prefix = "file://";
        size_t prlen = strlen(prefix);

        while (uri_len + prlen + 4 >= uri_cap) {
            uri_cap = (uri_cap * 2) + 64;
            payload_uri_list = realloc(payload_uri_list, uri_cap);
        }
        memcpy(payload_uri_list + uri_len, prefix, prlen);
        uri_len += prlen;
        payload_uri_list[uri_len] = '\0';
        append_url_encoded(&payload_uri_list, &uri_cap, &uri_len, p);

        if (uri_len + 3 >= uri_cap) {
            uri_cap += 32;
            payload_uri_list = realloc(payload_uri_list, uri_cap);
        }
        payload_uri_list[uri_len++] = '\r';
        payload_uri_list[uri_len++] = '\n';
        payload_uri_list[uri_len] = '\0';

        // gnome
        while (gnome_len + prlen + 4 >= gnome_cap) {
            gnome_cap = (gnome_cap * 2) + 64;
            payload_gnome = realloc(payload_gnome, gnome_cap);
        }
        memcpy(payload_gnome + gnome_len, prefix, prlen);
        gnome_len += prlen;
        payload_gnome[gnome_len] = '\0';
        append_url_encoded(&payload_gnome, &gnome_cap, &gnome_len, p);

        if (gnome_len + 2 >= gnome_cap) {
            gnome_cap += 16;
            payload_gnome = realloc(payload_gnome, gnome_cap);
        }
        payload_gnome[gnome_len++] = '\n';
        payload_gnome[gnome_len] = '\0';
    }

    if (ext_mgr && ext_dev) {
        if (ext_src) ext_data_control_source_v1_destroy(ext_src);
        ext_src = ext_data_control_manager_v1_create_data_source(ext_mgr);
        ext_data_control_source_v1_add_listener(ext_src, &ext_src_listener, NULL);
        ext_data_control_source_v1_offer(ext_src, "text/uri-list");
        ext_data_control_source_v1_offer(ext_src, "x-special/gnome-copied-files");
        ext_data_control_source_v1_offer(ext_src, "application/x-kde-cutselection");
        ext_data_control_source_v1_offer(ext_src, "text/plain;charset=utf-8");
        ext_data_control_source_v1_offer(ext_src, "text/plain");
        if (single_image_mime[0]) {
            ext_data_control_source_v1_offer(ext_src, single_image_mime);
        }
        ext_data_control_device_v1_set_selection(ext_dev, ext_src);
    } else if (wlr_mgr && wlr_dev) {
        if (wlr_src) zwlr_data_control_source_v1_destroy(wlr_src);
        wlr_src = zwlr_data_control_manager_v1_create_data_source(wlr_mgr);
        zwlr_data_control_source_v1_add_listener(wlr_src, &wlr_src_listener, NULL);
        zwlr_data_control_source_v1_offer(wlr_src, "text/uri-list");
        zwlr_data_control_source_v1_offer(wlr_src, "x-special/gnome-copied-files");
        zwlr_data_control_source_v1_offer(wlr_src, "application/x-kde-cutselection");
        zwlr_data_control_source_v1_offer(wlr_src, "text/plain;charset=utf-8");
        zwlr_data_control_source_v1_offer(wlr_src, "text/plain");
        if (single_image_mime[0]) {
            zwlr_data_control_source_v1_offer(wlr_src, single_image_mime);
        }
        zwlr_data_control_device_v1_set_selection(wlr_dev, wlr_src);
    }
    wl_display_flush(display);
}

static void on_alarm(int sig) {
    (void)sig;
    exit(0);
}

int main(int argc, char **argv) {
    (void)argc;
    (void)argv;

    signal(SIGALRM, on_alarm);

    display = wl_display_connect(NULL);
    if (!display) {
        return 1;
    }

    registry = wl_display_get_registry(display);
    wl_registry_add_listener(registry, &reg_listener, NULL);
    wl_display_roundtrip(display);

    if (!seat || (!ext_mgr && !wlr_mgr)) {
        wl_display_disconnect(display);
        return 2;
    }

    if (ext_mgr) {
        ext_dev = ext_data_control_manager_v1_get_data_device(ext_mgr, seat);
    } else if (wlr_mgr) {
        wlr_dev = zwlr_data_control_manager_v1_get_data_device(wlr_mgr, seat);
    }

    wl_display_roundtrip(display);

    printf("ready\n");
    fflush(stdout);

    int wl_fd = wl_display_get_fd(display);
    char in_buf[65536];
    size_t in_len = 0;

    int flags = fcntl(STDIN_FILENO, F_GETFL, 0);
    fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK);

    for (;;) {
        while (wl_display_prepare_read(display) != 0) {
            wl_display_dispatch_pending(display);
        }
        wl_display_flush(display);

        struct pollfd pfd[2];
        pfd[0].fd = wl_fd;
        pfd[0].events = POLLIN;
        pfd[0].revents = 0;

        pfd[1].fd = stdin_closed ? -1 : STDIN_FILENO;
        pfd[1].events = POLLIN;
        pfd[1].revents = 0;

        int ret = poll(pfd, stdin_closed ? 1 : 2, -1);
        if (ret < 0 && errno == EINTR) {
            wl_display_cancel_read(display);
            continue;
        }

        if (pfd[0].revents & POLLIN) {
            wl_display_read_events(display);
            wl_display_dispatch_pending(display);
        } else {
            wl_display_cancel_read(display);
        }

        if (!stdin_closed && (pfd[1].revents & (POLLIN | POLLHUP | POLLERR))) {
            for (;;) {
                ssize_t r = read(STDIN_FILENO, in_buf + in_len, sizeof(in_buf) - in_len - 1);
                if (r > 0) {
                    in_len += (size_t)r;
                    in_buf[in_len] = '\0';
                } else if (r == 0) {
                    stdin_closed = 1;
                    // max-file-manager exited; keep serving for 10 minutes
                    alarm(600);
                    break;
                } else {
                    if (errno == EAGAIN || errno == EWOULDBLOCK) break;
                    stdin_closed = 1;
                    alarm(600);
                    break;
                }
            }

            // Process lines in in_buf
            for (;;) {
                char *nl = strchr(in_buf, '\n');
                if (!nl) break;
                *nl = '\0';
                size_t line_len = (size_t)(nl - in_buf);

                if (strstr(in_buf, "\"clear\":true") != NULL || strstr(in_buf, "\"clear\": true") != NULL) {
                    apply_selection(NULL, 0, 0);
                    printf("ok\n");
                    fflush(stdout);
                } else {
                    int cut = (strstr(in_buf, "\"cut\":true") != NULL || strstr(in_buf, "\"cut\": true") != NULL);
                    char *paths_key = strstr(in_buf, "\"paths\"");
                    if (paths_key) {
                        char *bracket = strchr(paths_key, '[');
                        char *paths[512];
                        int pcount = 0;
                        if (bracket) {
                            char *p = bracket + 1;
                            while (*p && *p != ']' && pcount < 512) {
                                while (*p == ' ' || *p == ',' || *p == '\t') p++;
                                if (*p == '"') {
                                    p++;
                                    char *dest = p;
                                    paths[pcount++] = dest;
                                    while (*p && *p != '"') {
                                        if (*p == '\\' && *(p + 1)) {
                                            p++;
                                            if (*p == 'n') *dest++ = '\n';
                                            else if (*p == 'r') *dest++ = '\r';
                                            else if (*p == 't') *dest++ = '\t';
                                            else *dest++ = *p;
                                        } else {
                                            *dest++ = *p;
                                        }
                                        p++;
                                    }
                                    *dest = '\0';
                                    if (*p == '"') p++;
                                } else {
                                    p++;
                                }
                            }
                        }
                        apply_selection(paths, pcount, cut);
                        printf("ok\n");
                        fflush(stdout);
                    }
                }

                size_t rem = in_len - line_len - 1;
                memmove(in_buf, nl + 1, rem);
                in_len = rem;
                in_buf[in_len] = '\0';
            }
        }
    }

    return 0;
}
