/*
 * Step 1 replay harness (BRIEF-dive-computer-sync.md §8) — drive the FULL
 * libdivecomputer download pipeline under WASM/JSPI against a recorded BLE
 * transcript instead of a live dive computer. The JS side (run-replay.mjs)
 * plays the Peregrine: every request frame the protocol engine writes is
 * matched against the capture, and the recorded responses are served back
 * through the same dc_custom_open callbacks the real Web Bluetooth
 * transport will use. Each downloaded dive is parsed and emitted as one
 * JSON line on stdout for the JS side to diff against ground truth
 * (Subsurface's UDDF export of the same computer).
 *
 * Same JS bridge contract as spike.c (globalThis.spike.read/write).
 */
#include <stdio.h>
#include <string.h>
#include <emscripten.h>

#include <libdivecomputer/version.h>
#include <libdivecomputer/context.h>
#include <libdivecomputer/custom.h>
#include <libdivecomputer/iostream.h>
#include <libdivecomputer/descriptor.h>
#include <libdivecomputer/device.h>
#include <libdivecomputer/parser.h>
#include <libdivecomputer/iterator.h>
#include <libdivecomputer/datetime.h>

/* ── JS bridges — identical contract to spike.c ────────────────────────── */
EM_ASYNC_JS(int, js_read, (unsigned char *buf, int size), {
  const bytes = await globalThis.spike.read(size);
  if (!bytes || bytes.length === 0) return 0;
  const n = Math.min(bytes.length, size);
  HEAPU8.set(bytes.subarray(0, n), buf);
  return n;
});

EM_ASYNC_JS(int, js_write, (const unsigned char *buf, int size), {
  const bytes = HEAPU8.slice(buf, buf + size);
  await globalThis.spike.write(bytes);
  return size;
});

EM_ASYNC_JS(void, js_sleep, (int ms), {
  await new Promise(function (r) { setTimeout(r, ms); });
});

static dc_status_t cb_read (void *ud, void *data, size_t size, size_t *actual) {
  int n = js_read ((unsigned char *) data, (int) size);
  if (actual) *actual = (size_t) (n < 0 ? 0 : n);
  return n > 0 ? DC_STATUS_SUCCESS : DC_STATUS_TIMEOUT;
}
static dc_status_t cb_write (void *ud, const void *data, size_t size, size_t *actual) {
  int n = js_write ((const unsigned char *) data, (int) size);
  if (actual) *actual = (size_t) (n < 0 ? 0 : n);
  return DC_STATUS_SUCCESS;
}
static dc_status_t cb_sleep (void *ud, unsigned int ms) { js_sleep ((int) ms); return DC_STATUS_SUCCESS; }
static dc_status_t cb_set_timeout (void *ud, int timeout) { return DC_STATUS_SUCCESS; }
static dc_status_t cb_flush (void *ud) { return DC_STATUS_SUCCESS; }
static dc_status_t cb_purge (void *ud, dc_direction_t dir) { return DC_STATUS_SUCCESS; }
static dc_status_t cb_get_available (void *ud, size_t *value) {
  if (value) *value = 0;
  return DC_STATUS_SUCCESS;
}
static dc_status_t cb_close (void *ud) { return DC_STATUS_SUCCESS; }

static const dc_custom_cbs_t callbacks = {
  .set_timeout   = cb_set_timeout,
  .get_available = cb_get_available,
  .read          = cb_read,
  .write         = cb_write,
  .flush         = cb_flush,
  .purge         = cb_purge,
  .sleep         = cb_sleep,
  .close         = cb_close,
};

/* ── per-dive parse + JSON emit ────────────────────────────────────────── */
typedef struct {
  dc_device_t *device;
  int count;
} foreach_state_t;

static void sample_counter (dc_sample_type_t type, const dc_sample_value_t *value, void *userdata) {
  if (type == DC_SAMPLE_DEPTH) (*(int *) userdata)++;
}

static int dive_cb (const unsigned char *data, unsigned int size,
                    const unsigned char *fingerprint, unsigned int fsize,
                    void *userdata) {
  foreach_state_t *st = (foreach_state_t *) userdata;
  st->count++;

  dc_parser_t *parser = NULL;
  if (dc_parser_new (&parser, st->device, data, size) != DC_STATUS_SUCCESS) {
    printf ("{\"n\":%d,\"error\":\"parser_new failed\"}\n", st->count);
    return 1; /* keep going */
  }

  dc_datetime_t dt = { 0 };
  int have_dt = dc_parser_get_datetime (parser, &dt) == DC_STATUS_SUCCESS;

  unsigned int divetime = 0;
  double maxdepth = 0.0;
  dc_parser_get_field (parser, DC_FIELD_DIVETIME, 0, &divetime);
  dc_parser_get_field (parser, DC_FIELD_MAXDEPTH, 0, &maxdepth);

  int samples = 0;
  dc_parser_samples_foreach (parser, sample_counter, &samples);

  if (have_dt)
    printf ("{\"n\":%d,\"datetime\":\"%04d-%02d-%02dT%02d:%02d:%02d\",\"divetime\":%u,\"maxdepth\":%.2f,\"samples\":%d}\n",
            st->count, dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second,
            divetime, maxdepth, samples);
  else
    printf ("{\"n\":%d,\"datetime\":null,\"divetime\":%u,\"maxdepth\":%.2f,\"samples\":%d}\n",
            st->count, divetime, maxdepth, samples);
  dc_parser_destroy (parser);
  return 1;
}

/* Mirror the transcript's own format — makes our engine's wire traffic
 * directly diffable against the Subsurface capture. */
static void logfunc (dc_context_t *context, dc_loglevel_t loglevel,
                     const char *file, unsigned int line,
                     const char *function, const char *message, void *userdata) {
  fprintf (stderr, "[dc] %s\n", message);
}

int main (void) {
  fprintf (stderr, "replay: libdivecomputer %s under WASM\n", dc_version (NULL));

  dc_context_t *ctx = NULL;
  dc_context_new (&ctx);
  dc_context_set_loglevel (ctx, DC_LOGLEVEL_ALL);
  dc_context_set_logfunc (ctx, logfunc, NULL);

  dc_iostream_t *io = NULL;
  dc_status_t rc = dc_custom_open (&io, ctx, DC_TRANSPORT_BLE, &callbacks, NULL);
  if (rc != DC_STATUS_SUCCESS) { fprintf (stderr, "custom_open failed: %d\n", rc); return 1; }

  dc_iterator_t *iterator = NULL;
  dc_descriptor_t *descriptor = NULL, *found = NULL;
  dc_descriptor_iterator_new (&iterator, NULL);
  while (dc_iterator_next (iterator, &descriptor) == DC_STATUS_SUCCESS) {
    if (strcmp (dc_descriptor_get_vendor (descriptor), "Shearwater") == 0 &&
        strcmp (dc_descriptor_get_product (descriptor), "Peregrine") == 0) { found = descriptor; break; }
    dc_descriptor_free (descriptor);
  }
  dc_iterator_free (iterator);
  if (!found) { fprintf (stderr, "descriptor not found\n"); return 1; }

  dc_device_t *device = NULL;
  rc = dc_device_open (&device, ctx, found, io);
  if (rc != DC_STATUS_SUCCESS) { fprintf (stderr, "device_open failed: %d\n", rc); return 1; }

  foreach_state_t st = { device, 0 };
  rc = dc_device_foreach (device, dive_cb, &st);
  fprintf (stderr, "foreach rc=%d dives=%d\n", rc, st.count);

  dc_device_close (device);
  dc_descriptor_free (found);
  dc_iostream_close (io);
  dc_context_free (ctx);
  return rc == DC_STATUS_SUCCESS ? 0 : 1;
}
