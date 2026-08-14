#!/usr/bin/env python3
"""Local dev server that refuses to let anything be cached.

Replaces a bare `python3 -m http.server 8080`, which sends no Cache-Control at
all. Browsers (and WKWebView especially) then apply *heuristic* caching: they
guess a freshness lifetime from Last-Modified and serve from cache without
revalidating. That disk cache survives quitting and relaunching the app, so
"restart tauri dev" does not clear it.

The failure mode this exists to prevent is nasty because it's silent and
partial: on 2026-07-25 a footage-modal CSS change didn't reach the webview
while the JS change did, producing a layout that looked like a real bug (the
new markup rendered against the old grid) and cost a round of misdiagnosis.
The same class of problem burned two dive-computer hardware sessions in July
via the service-worker cache — see sw.js's header comment.

Usage (this is what tauri.conf.json's beforeDevCommand runs):
    python3 scripts/dev-server.py [port]

Serves the repo root, so run it from there. Production is unaffected: this is
dev-only, and Cloudflare Pages sets its own caching headers.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    # Conditional-request headers are stripped BEFORE the base handler sees
    # them. This is the only correct place to defeat 304s.
    #
    # The tempting alternative — letting send_head() take its 304 path and
    # rewriting the status code to 200 on the way out — is broken, and broke
    # this app: send_head() answers a conditional request by sending 304 and
    # returning None, i.e. *no file object*, so do_GET has nothing to copy.
    # Rewriting the code yields "200 OK" with a zero-byte body. Every asset
    # the webview had cached (which is all of them) came back empty, and the
    # app booted to a blank white screen. Removing the headers up front means
    # send_head never learns the client had a cached copy, so it always
    # serves a full response.
    def _strip_conditionals(self):
        for h in ('If-Modified-Since', 'If-None-Match', 'If-Range'):
            while h in self.headers:
                del self.headers[h]

    def do_GET(self):
        self._strip_conditionals()
        super().do_GET()

    def do_HEAD(self):
        self._strip_conditionals()
        super().do_HEAD()

    def end_headers(self):
        # no-store: don't write it to cache at all.
        # no-cache + must-revalidate: and if something already has it, check
        # with us before reusing it — this is what un-sticks a webview that
        # cached an asset back when the server was still sending nothing.
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        # One line per request, minus the timestamp noise, so a missing asset
        # is actually visible while developing.
        sys.stderr.write("  dev-server: %s\n" % (fmt % args))


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    try:
        # '' binds every interface, matching `python3 -m http.server`'s default.
        # Binding 127.0.0.1 only is a trap on macOS, where `localhost` can
        # resolve to ::1 first and the webview then fails to connect at all.
        srv = ThreadingHTTPServer(('', port), NoCacheHandler)
    except OSError as e:
        # Fail LOUDLY. Tauri's beforeDevCommand output is easy to miss, and a
        # dev server that dies silently looks exactly like an app bug — the
        # window just comes up blank with nothing to load.
        print(f"\n  dev-server: FAILED to bind port {port} — {e}", file=sys.stderr)
        print(f"  Something else is probably already using it. Find it with:"
              f"\n      lsof -ti:{port}\n", file=sys.stderr, flush=True)
        sys.exit(1)
    print(f"dev-server on http://localhost:{port} (caching disabled)", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        # Normal shutdown path: `cargo tauri dev` restarting sends SIGINT to
        # this process. Without this, Python prints a full traceback on the
        # way out even though nothing failed — looks like a crash, isn't one.
        pass
