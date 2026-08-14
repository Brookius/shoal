/*
 * Production download module (step 2 prerequisite, BRIEF-dive-computer-sync
 * §9/§10) — the real vendor/libdivecomputer-wasm/ candidate. Same
 * dc_custom_open/JS-bridge contract as spike.c and replay.c (proven in step
 * 1b/1), promoted from replay.c's proof-of-concept into something
 * js/computer-sync.js can actually call against a live Web Bluetooth
 * transport instead of a transcript replay.
 *
 * Two changes from replay.c: (1) vendor/product come from argv, not a
 * hardcoded Peregrine — js/computer-sync.js will pass whatever
 * navigator.bluetooth device the user actually paired; (2) full waypoint
 * extraction (t/d/temp/ndl) plus deco/safety-stop events, not just summary
 * fields, via a streamed JSON-line protocol (one object per
 * dive_start/waypoint/deco_event/dive_end) so C never needs a growable
 * array. NDL (DC_DECO_NDL) rides on the waypoint tick as an optional `ndl`
 * field (minutes, same unit + one-decimal rounding the UDDF path already
 * uses for <nodecotime>); SAFETYSTOP/DECOSTOP/DEEPSTOP are discrete events,
 * not a per-tick scalar, so each sample emits its own `deco_event` line
 * immediately — one per sample, undeduplicated, exactly mirroring how the
 * UDDF <decostop> parser does it (js/profile.js), since the chart's own
 * grouping-into-pills logic already expects that shape and lives
 * downstream of this, unchanged. DEEPSTOP folds into "decostop": that's
 * the only vocabulary the chart and the UDDF parser's kind="safety"/
 * "mandatory" attribute already know, so no chart-side change is needed.
 * The dive's primary gas mix (DC_FIELD_GASMIX_COUNT/DC_FIELD_GASMIX, index
 * 0 — the back/start gas) rides on the dive_start line as raw o2/he
 * fractions; JS-side classification into Shoal's fixed gas vocabulary
 * (Air/Nitrox NN/Trimix) reuses the existing _gasMixLabel() the UDDF path
 * already has (js/profile.js), not duplicated in C. Scope note: tank
 * size/pressure (DC_FIELD_TANK) is still deferred — the UDDF path covers
 * that fidelity today; a BLE-synced dive with no tank/pressure is still a
 * real dive with a real chart, now including its NDL colour gradient,
 * deco/safety pills, and gas mix.
 *
 * Output shape matches the object js/profile.js already consumes from
 * UDDF parsing (brief §9): { computer, dives: [{ maxDepth, duration,
 * startedAt, gas?, waypoints: [{t,d,temp?,ndl?}], events: [{t,type,depth}] }] }
 * — one JSON line per dive/waypoint/event, assembled by
 * run-download-test.mjs / js/computer-sync.js.
 *
 * Incremental sync (brief §16): argv[3], if present, is a 4-byte
 * fingerprint as an 8-char hex string — the device driver stops
 * enumerating the manifest the instant it hits a dive matching this
 * value (shearwater_petrel.c's own cutoff, not something this file
 * implements). Delivery is newest-first, so the fingerprint of the FIRST
 * dive_cb call in a session is "the newest dive as of now" — captured and
 * emitted once via a newest_fingerprint line for the caller to persist
 * (js/computer-sync.js decides WHEN it's safe to persist — never after an
 * interrupted session, since the cutoff would then skip real gaps).
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

/* ── JS bridge — same contract as spike.c/replay.c, production-scoped name */
EM_ASYNC_JS(int, dc_js_read, (unsigned char *buf, int size), {
  const bytes = await globalThis.dcTransport.read(size);
  if (!bytes || bytes.length === 0) return 0;
  const n = Math.min(bytes.length, size);
  HEAPU8.set(bytes.subarray(0, n), buf);
  return n;
});
EM_ASYNC_JS(int, dc_js_write, (const unsigned char *buf, int size), {
  const bytes = HEAPU8.slice(buf, buf + size);
  await globalThis.dcTransport.write(bytes);
  return size;
});
EM_ASYNC_JS(void, dc_js_sleep, (int ms), {
  await new Promise(function (r) { setTimeout(r, ms); });
});

static dc_status_t cb_read (void *ud, void *data, size_t size, size_t *actual) {
  int n = dc_js_read ((unsigned char *) data, (int) size);
  if (actual) *actual = (size_t) (n < 0 ? 0 : n);
  return n > 0 ? DC_STATUS_SUCCESS : DC_STATUS_TIMEOUT;
}
static dc_status_t cb_write (void *ud, const void *data, size_t size, size_t *actual) {
  int n = dc_js_write ((const unsigned char *) data, (int) size);
  if (actual) *actual = (size_t) (n < 0 ? 0 : n);
  return DC_STATUS_SUCCESS;
}
static dc_status_t cb_sleep (void *ud, unsigned int ms) { dc_js_sleep ((int) ms); return DC_STATUS_SUCCESS; }
static dc_status_t cb_set_timeout (void *ud, int timeout) { return DC_STATUS_SUCCESS; }
static dc_status_t cb_flush (void *ud) { return DC_STATUS_SUCCESS; }
static dc_status_t cb_purge (void *ud, dc_direction_t dir) { return DC_STATUS_SUCCESS; }
static dc_status_t cb_get_available (void *ud, size_t *value) { if (value) *value = 0; return DC_STATUS_SUCCESS; }
static dc_status_t cb_close (void *ud) { return DC_STATUS_SUCCESS; }

static const dc_custom_cbs_t callbacks = {
  .set_timeout = cb_set_timeout, .get_available = cb_get_available,
  .read = cb_read, .write = cb_write, .flush = cb_flush, .purge = cb_purge,
  .sleep = cb_sleep, .close = cb_close,
};

/* ── hex helpers — fingerprints cross the JS boundary as plain hex strings,
 * simplest thing that works for a handful of bytes, no binary-JSON
 * complexity. Byte count is NOT hardcoded to Shearwater's 4 — Suunto (or
 * any future family) may use a different fingerprint size, and
 * dc_device_set_fingerprint() itself already validates size against
 * whatever the specific driver expects; this just carries bytes across
 * the boundary faithfully, whatever the count. */
#define MAX_FINGERPRINT_BYTES 16
static void hex_encode (const unsigned char *data, unsigned int size, char *out /* size*2+1 */) {
  static const char digits[] = "0123456789abcdef";
  for (unsigned int i = 0; i < size; i++) {
    out[i * 2]     = digits[(data[i] >> 4) & 0xF];
    out[i * 2 + 1] = digits[data[i] & 0xF];
  }
  out[size * 2] = '\0';
}
/* Decodes hex into out (capped at MAX_FINGERPRINT_BYTES); returns the byte
 * count derived from the string's own length, or 0 on a malformed string. */
static unsigned int hex_decode (const char *hex, unsigned char *out) {
  size_t len = strlen (hex);
  if (len == 0 || len % 2 != 0 || len / 2 > MAX_FINGERPRINT_BYTES) return 0;
  unsigned int size = (unsigned int) (len / 2);
  for (unsigned int i = 0; i < size; i++) {
    unsigned int byte;
    if (sscanf (hex + i * 2, "%2x", &byte) != 1) return 0;
    out[i] = (unsigned char) byte;
  }
  return size;
}

/* ── per-tick waypoint accumulator — no growable array; each tick is
 * flushed (printed) the moment the next DC_SAMPLE_TIME starts a new one,
 * so C never holds more than one waypoint in memory at a time */
typedef struct {
  dc_device_t *device;
  int dive_n;
  int have_pending;
  unsigned int t_ms;
  double depth;
  int have_temp;
  double temp;
  int have_ndl;
  double ndl; /* minutes — converted from libdivecomputer's seconds here,
                 same unit the UDDF <nodecotime> path already emits */
  int fingerprint_captured; /* only the FIRST (newest) dive's matters */
} sample_state_t;

static void flush_pending (sample_state_t *st) {
  if (!st->have_pending) return;
  /* Built incrementally rather than one printf per have_temp×have_ndl
   * combination — both fields are independently optional (not every
   * computer/sample reports temperature or NDL), and a fixed format
   * string per combination doesn't scale past two optional fields.
   * Single-threaded stdout means these calls still land as one line. */
  printf ("{\"type\":\"waypoint\",\"t\":%u,\"d\":%.2f", st->t_ms / 1000, st->depth);
  if (st->have_temp) printf (",\"temp\":%.1f", st->temp);
  if (st->have_ndl)  printf (",\"ndl\":%.1f", st->ndl);
  printf ("}\n");
  st->have_pending = 0;
  st->have_temp = 0;
  st->have_ndl = 0;
}

static void sample_cb (dc_sample_type_t type, const dc_sample_value_t *value, void *userdata) {
  sample_state_t *st = (sample_state_t *) userdata;
  switch (type) {
    case DC_SAMPLE_TIME:
      flush_pending (st); /* previous tick, if it ever got a depth, is done */
      st->t_ms = value->time;
      st->have_pending = 1;
      break;
    case DC_SAMPLE_DEPTH:
      st->depth = value->depth;
      break;
    case DC_SAMPLE_TEMPERATURE:
      st->temp = value->temperature;
      st->have_temp = 1;
      break;
    case DC_SAMPLE_DECO:
      if (value->deco.type == DC_DECO_NDL) {
        /* Per-tick scalar, same as depth/temp — attaches to whichever
         * waypoint is currently pending and rides out on its flush. */
        st->ndl = value->deco.time / 60.0;
        st->have_ndl = 1;
      } else {
        /* SAFETYSTOP / DECOSTOP / DEEPSTOP — a discrete event, not a
         * per-tick scalar, so it's emitted immediately rather than
         * folded into the waypoint. See file header for why this is
         * one-line-per-sample (undeduplicated) and why DEEPSTOP folds
         * into "decostop". */
        const char *kind = (value->deco.type == DC_DECO_SAFETYSTOP) ? "safetystop" : "decostop";
        printf ("{\"type\":\"deco_event\",\"t\":%u,\"kind\":\"%s\",\"depth\":%.2f}\n",
                st->t_ms / 1000, kind, value->deco.depth);
      }
      break;
    default:
      break; /* PRESSURE/EVENT/GASMIX/etc — deferred, see file header */
  }
}

/* Byte-accurate download progress, straight from libdivecomputer's own
 * accounting (DC_EVENT_PROGRESS fires throughout device_foreach — the
 * manifest reads and every dive transfer), plus device identity
 * (DC_EVENT_DEVINFO, brief §16 — fires early, before manifest scanning,
 * which is what lets the caller key a fingerprint store by serial even on
 * a session that gets interrupted before any dive completes). Emitted as
 * JSON lines like everything else; consumers that don't care
 * (run-download-test) ignore unknown types. Progress is throttled to
 * whole-percent changes — at BLE pace these fire far more often than a UI
 * can usefully repaint; devinfo fires once, no throttling needed. */
static void event_cb (dc_device_t *device, dc_event_type_t event, const void *data, void *userdata) {
  if (event == DC_EVENT_DEVINFO) {
    const dc_event_devinfo_t *info = (const dc_event_devinfo_t *) data;
    if (!info) return;
    printf ("{\"type\":\"devinfo\",\"model\":%u,\"firmware\":%u,\"serial\":%u}\n",
            info->model, info->firmware, info->serial);
    return;
  }
  if (event != DC_EVENT_PROGRESS) return;
  const dc_event_progress_t *progress = (const dc_event_progress_t *) data;
  /* 0xFFFFFFFF = "maximum not known yet" (pre-manifest); 0 = degenerate.
   * Both would make a percentage meaningless — skip rather than mislead. */
  if (!progress || !progress->maximum || progress->maximum == 0xFFFFFFFF) return;
  static unsigned int last_pct = ~0u;
  unsigned int pct = (unsigned int) ((100.0 * progress->current) / progress->maximum);
  if (pct == last_pct) return;
  last_pct = pct;
  printf ("{\"type\":\"progress\",\"current\":%u,\"maximum\":%u}\n",
          progress->current, progress->maximum);
}

static int dive_cb (const unsigned char *data, unsigned int size,
                    const unsigned char *fingerprint, unsigned int fsize,
                    void *userdata) {
  sample_state_t *st = (sample_state_t *) userdata;
  st->dive_n++;

  /* Delivery is newest-first (confirmed repeatedly against real Peregrine
   * transcripts) — the FIRST dive_cb call in a session is therefore always
   * the newest dive, and its fingerprint is what a caller should persist
   * as "known up to here" for next time. Only ever captured/emitted once
   * per session, regardless of how many dives follow. */
  if (!st->fingerprint_captured && fingerprint && fsize > 0 && fsize <= MAX_FINGERPRINT_BYTES) {
    char hex[MAX_FINGERPRINT_BYTES * 2 + 1];
    hex_encode (fingerprint, fsize, hex);
    printf ("{\"type\":\"newest_fingerprint\",\"hex\":\"%s\"}\n", hex);
    st->fingerprint_captured = 1;
  }

  dc_parser_t *parser = NULL;
  if (dc_parser_new (&parser, st->device, data, size) != DC_STATUS_SUCCESS) {
    printf ("{\"type\":\"dive_error\",\"n\":%d}\n", st->dive_n);
    return 1;
  }

  dc_datetime_t dt = { 0 };
  int have_dt = dc_parser_get_datetime (parser, &dt) == DC_STATUS_SUCCESS;
  unsigned int divetime = 0;
  double maxdepth = 0.0;
  dc_parser_get_field (parser, DC_FIELD_DIVETIME, 0, &divetime);
  dc_parser_get_field (parser, DC_FIELD_MAXDEPTH, 0, &maxdepth);

  /* Primary/back gas — index 0 is whichever mix the device's own gas-mix
   * table lists first, which is the back/start gas for the overwhelming
   * common case (no gas switch ever occurs in real recreational diving —
   * confirmed true for 100% of a real 96-dive test history) and a
   * reasonable, honestly-approximate choice otherwise, mirroring the same
   * "first tank, absent explicit switch info" fallback js/profile.js's
   * UDDF parser already uses. A multi-gas dive gets whichever mix the
   * device listed first, not strictly "active at t=0" — approximation,
   * not a bug; classification (Air/Nitrox NN/Trimix) happens JS-side via
   * the existing _gasMixLabel(), not duplicated here. */
  unsigned int ngases = 0;
  dc_gasmix_t gasmix = { 0 };
  int have_gas = dc_parser_get_field (parser, DC_FIELD_GASMIX_COUNT, 0, &ngases) == DC_STATUS_SUCCESS &&
                 ngases > 0 &&
                 dc_parser_get_field (parser, DC_FIELD_GASMIX, 0, &gasmix) == DC_STATUS_SUCCESS;

  printf ("{\"type\":\"dive_start\",\"n\":%d,\"datetime\":", st->dive_n);
  if (have_dt)
    printf ("\"%04d-%02d-%02dT%02d:%02d:%02d\"", dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second);
  else
    printf ("null");
  printf (",\"divetime\":%u,\"maxdepth\":%.2f", divetime, maxdepth);
  if (have_gas) printf (",\"o2\":%.4f,\"he\":%.4f", gasmix.oxygen, gasmix.helium);
  printf ("}\n");

  st->have_pending = 0;
  st->have_temp = 0;
  st->have_ndl = 0;
  dc_parser_samples_foreach (parser, sample_cb, st);
  flush_pending (st); /* final tick has no "next TIME" to trigger on */

  printf ("{\"type\":\"dive_end\"}\n");
  dc_parser_destroy (parser);
  return 1; /* keep going */
}

int main (int argc, char **argv) {
  const char *vendor      = argc > 1 ? argv[1] : "Shearwater";
  const char *product     = argc > 2 ? argv[2] : "Peregrine";
  const char *fp_hex_in   = argc > 3 ? argv[3] : NULL; /* brief §16 */
  fprintf (stderr, "download: libdivecomputer %s under WASM, target=%s %s%s\n",
           dc_version (NULL), vendor, product, fp_hex_in ? ", incremental" : "");

  dc_context_t *ctx = NULL;
  dc_context_new (&ctx);

  dc_iostream_t *io = NULL;
  if (dc_custom_open (&io, ctx, DC_TRANSPORT_BLE, &callbacks, NULL) != DC_STATUS_SUCCESS) {
    fprintf (stderr, "custom_open failed\n");
    return 1;
  }

  dc_iterator_t *iterator = NULL;
  dc_descriptor_t *descriptor = NULL, *found = NULL;
  dc_descriptor_iterator_new (&iterator, NULL);
  while (dc_iterator_next (iterator, &descriptor) == DC_STATUS_SUCCESS) {
    if (strcmp (dc_descriptor_get_vendor (descriptor), vendor) == 0 &&
        strcmp (dc_descriptor_get_product (descriptor), product) == 0) { found = descriptor; break; }
    dc_descriptor_free (descriptor);
  }
  dc_iterator_free (iterator);
  if (!found) { fprintf (stderr, "descriptor not found: %s %s\n", vendor, product); return 1; }

  dc_device_t *device = NULL;
  dc_status_t rc = dc_device_open (&device, ctx, found, io);
  if (rc != DC_STATUS_SUCCESS) { fprintf (stderr, "device_open failed: %d\n", rc); return 1; }

  if (fp_hex_in) {
    unsigned char fp_bytes[MAX_FINGERPRINT_BYTES];
    unsigned int fp_size = hex_decode (fp_hex_in, fp_bytes);
    if (fp_size) {
      rc = dc_device_set_fingerprint (device, fp_bytes, fp_size);
      fprintf (stderr, "set_fingerprint(%s, %u bytes) rc=%d\n", fp_hex_in, fp_size, rc);
      /* Not fatal on mismatch (DC_STATUS_INVALIDARGS if the driver's own
       * fingerprint size differs, e.g. a stale value from a different
       * device family) — worst case the cutoff just doesn't engage and
       * this behaves like a full sync, never a wrong/lossy one. */
    } else {
      fprintf (stderr, "malformed incoming fingerprint hex, ignoring: %s\n", fp_hex_in);
    }
  }

  dc_device_set_events (device, DC_EVENT_PROGRESS | DC_EVENT_DEVINFO, event_cb, NULL);

  sample_state_t st = { device, 0, 0, 0, 0.0, 0, 0.0, 0, 0.0, 0 };
  rc = dc_device_foreach (device, dive_cb, &st);
  fprintf (stderr, "foreach rc=%d dives=%d\n", rc, st.dive_n);

  dc_device_close (device);
  dc_descriptor_free (found);
  dc_iostream_close (io);
  dc_context_free (ctx);
  return rc == DC_STATUS_SUCCESS ? 0 : 1;
}
