/*
 * Step 1b spike (BRIEF-dive-computer-sync.md §13) — can libdivecomputer's
 * blocking dc_custom_open() callbacks suspend on JavaScript promises under
 * WASM/JSPI? Confirmed 2026-07-13. Kept as a regression check: run this
 * after any emscripten/libdivecomputer version bump to re-confirm the
 * suspension mechanics before touching real hardware.
 *
 * Stage A: dc_custom_open + dc_iostream_write/read round-trip where every
 *          callback awaits a JS promise (the exact Web Bluetooth shape).
 * Stage B: full dc_device_open() against a JS mock, for each descriptor in
 *          STAGE_B_TARGETS below — one per vendor protocol family we care
 *          about (Shearwater's Petrel-family engine, Suunto's EON Steel
 *          family). Each is expected to FAIL cleanly (the mock speaks no
 *          real protocol), but that proves the real protocol engine runs,
 *          writes its handshake, reads responses, and errors out sanely
 *          under suspension — no deadlock, no trap. Add a row here before
 *          extending real support to a new vendor family.
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
#include <libdivecomputer/iterator.h>

/* ── JS bridges — each `await` here is a JSPI suspension point ─────────── */
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

/* ── dc_custom_cbs_t implementations ───────────────────────────────────── */
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
static dc_status_t cb_sleep (void *ud, unsigned int ms) {
  js_sleep ((int) ms);
  return DC_STATUS_SUCCESS;
}
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
  /* everything else NULL — custom.c treats missing callbacks as unsupported */
};

static dc_descriptor_t * find_descriptor (const char *vendor, const char *product) {
  dc_iterator_t *iterator = NULL;
  dc_descriptor_t *descriptor = NULL, *found = NULL;
  if (dc_descriptor_iterator_new (&iterator, NULL) != DC_STATUS_SUCCESS)
    return NULL;
  while (dc_iterator_next (iterator, &descriptor) == DC_STATUS_SUCCESS) {
    if (strcmp (dc_descriptor_get_vendor (descriptor), vendor) == 0 &&
        strcmp (dc_descriptor_get_product (descriptor), product) == 0) {
      found = descriptor;
      break;
    }
    dc_descriptor_free (descriptor);
  }
  dc_iterator_free (iterator);
  return found;
}

/* One row per protocol engine worth confirming under WASM/JSPI. Both are
 * BLE-only per descriptor.c (see brief §13) — the point is exercising two
 * independently-implemented vendor drivers, not exhaustive model coverage. */
static const struct { const char *vendor, *product; } STAGE_B_TARGETS[] = {
  { "Shearwater", "Peregrine" },
  { "Suunto",     "EON Steel" },
};

int main (void) {
  printf ("libdivecomputer %s under WASM\n", dc_version (NULL));

  dc_context_t *ctx = NULL;
  dc_status_t rc = dc_context_new (&ctx);
  printf ("context_new: %d\n", rc);

  int stageA = 0;
  int stageBFailures = 0;

  for (size_t i = 0; i < sizeof (STAGE_B_TARGETS) / sizeof (STAGE_B_TARGETS[0]); i++) {
    const char *vendor = STAGE_B_TARGETS[i].vendor;
    const char *product = STAGE_B_TARGETS[i].product;

    dc_iostream_t *io = NULL;
    rc = dc_custom_open (&io, ctx, DC_TRANSPORT_BLE, &callbacks, NULL);
    printf ("\n=== %s %s ===\ncustom_open: %d\n", vendor, product, rc);
    if (rc != DC_STATUS_SUCCESS) { stageBFailures++; continue; }

    if (i == 0) {
      /* Stage A only needs to run once — it's protocol-independent. */
      printf ("--- Stage A: iostream round-trip through async JS ---\n");
      unsigned char out[] = { 0xCA, 0xFE, 0xBA, 0xBE };
      size_t actual = 0;
      rc = dc_iostream_write (io, out, sizeof (out), &actual);
      printf ("A write: rc=%d actual=%u\n", rc, (unsigned) actual);

      unsigned char in[16] = { 0 };
      actual = 0;
      rc = dc_iostream_read (io, in, sizeof (in), &actual);
      printf ("A read:  rc=%d actual=%u bytes=%02x%02x%02x%02x\n",
              rc, (unsigned) actual, in[0], in[1], in[2], in[3]);

      stageA = (actual == 4 &&
                in[0] == 0xCA && in[1] == 0xFE && in[2] == 0xBA && in[3] == 0xBE);
      printf ("STAGE_A: %s\n", stageA ? "PASS" : "FAIL");
      dc_iostream_close (io);

      /* Stage A drained/closed that iostream — open a fresh one for Stage B. */
      rc = dc_custom_open (&io, ctx, DC_TRANSPORT_BLE, &callbacks, NULL);
      if (rc != DC_STATUS_SUCCESS) { stageBFailures++; continue; }
    }

    printf ("--- Stage B: real %s protocol engine vs dumb mock ---\n", vendor);
    dc_descriptor_t *descriptor = find_descriptor (vendor, product);
    printf ("descriptor: %s\n", descriptor ? "found" : "NOT FOUND");
    if (descriptor) {
      dc_device_t *device = NULL;
      rc = dc_device_open (&device, ctx, descriptor, io);
      /* Expected: a protocol/IO error (mock isn't the real device). The pass
       * criterion is completing WITHOUT hang or trap. */
      printf ("device_open rc=%d (nonzero expected — mock speaks no real protocol)\n", rc);
      if (device) dc_device_close (device);
      dc_descriptor_free (descriptor);
      printf ("STAGE_B[%s %s]: PASS (returned cleanly under suspension)\n", vendor, product);
    } else {
      stageBFailures++;
    }

    dc_iostream_close (io);
  }

  dc_context_free (ctx);
  printf ("\nSPIKE_DONE\n");
  return (stageA && !stageBFailures) ? 0 : 1;
}
