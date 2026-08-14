// Shared "wait for the program to actually finish" helper for the
// emscripten modules built by build.sh. Used by every harness in this
// folder; js/computer-sync.js does the same thing inline (it's a classic
// script, not an ES module, so it can't import this).
//
// Why this exists at all: under the old -sJSPI build the factory promise
// itself resolved when main() returned, so callers could just
// `await factory(...)` and read their results. Under -sASYNCIFY it
// resolves the moment main() first SUSPENDS — the engine goes on running
// in the background — so a caller awaiting only the factory inspects its
// results while the download hasn't even started, and sees nothing. That
// failure is silent and looks exactly like a parsing regression (0 dives,
// no error), which is precisely why it's worth one shared helper rather
// than four chances to forget.
//
// -sEXIT_RUNTIME=1 makes emscripten invoke Module.onExit(code) when main()
// genuinely returns. onAbort covers a WASM trap, which the JSPI build used
// to surface as a factory rejection — without it a trap would hang here
// forever instead of failing.
export async function runModule(factory, opts = {}) {
  let settle, fail;
  const finished = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
  const mod = await factory({
    ...opts,
    onExit: (code) => settle(code),
    onAbort: (err) => fail(new Error(`wasm aborted: ${err}`)),
  });
  return { mod, code: await finished };
}
