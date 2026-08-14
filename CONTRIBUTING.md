# Contributing to Shoal

Thanks for taking a look. Shoal is a small, personal project that's grown into
something other divers might find useful — contributions are genuinely
welcome, but a few things about how it's built are unusual, so please read
this before opening a PR.

---

## Read this first

- **[README.md](README.md)** — what Shoal is, how to run it locally.
- **[CLAUDE.md](CLAUDE.md)** — architecture, data model, conventions. This is
  the single source of truth for how the app is put together.
- **[DECISIONS.md](DECISIONS.md)** — every deliberate design choice and the
  rejected alternatives. **Skim the headings before changing anything that
  "looks wrong" — it usually isn't.** A lot of this codebase's shape comes
  from a real bug or a real piece of user feedback, not convention for its
  own sake. If you're about to "fix" something and DECISIONS.md already
  explains why it's that way, that's a strong signal to ask first rather than
  send the PR.

If you only read one thing, make it `DECISIONS.md`'s table of contents.

---

## There's no build step — on purpose

This is the single most surprising thing about this codebase if you're used to
modern JS tooling:

- **No npm, no bundler, no framework, no build step.** Classic `<script src>`
  tags, loaded in a specific order, sharing one global scope. Functions are
  global; inline `onclick=` handlers are normal here.
- **No ES modules.** Don't introduce `import`/`export`.
- **No automated test suite.** Verification is (1) a syntax check with the
  macOS-bundled JavaScriptCore `jsc` binary — catches unbalanced braces/
  template literals — and (2) manual testing in a real browser, including a
  real phone for anything mobile/PWA-related. See `README.md` → "How to
  verify a change" for the exact commands.

This is a deliberate constraint, not a gap waiting to be filled — please don't
open a PR that adds a bundler, a framework, a test runner, or converts files to
ES modules. If you think the project has genuinely outgrown this, open an
issue to discuss it first; it's a bigger conversation than one PR.

## Running it locally

```bash
git clone https://github.com/Brookius/shoal.git
cd shoal
python3 scripts/dev-server.py 8080
# open http://localhost:8080
```

Use `scripts/dev-server.py`, not a bare `python3 -m http.server` — it sends
`Cache-Control` headers that prevent the browser from heuristically caching
stale JS/CSS across restarts (a real, previously-hit gotcha; see the script's
own header comment). `file://` won't work either way; the service worker
needs an `http(s)` origin.

## Load order matters

Each file in `js/` can only call globals defined in files loaded **before**
it, at parse time — but can call anything defined **anywhere** at call time
(i.e. inside a function body, once everything's loaded). If you add a new
file, check `README.md`'s code map for where it needs to sit in `index.html`'s
script tags, and add it to `sw.js`'s `SHELL_CRITICAL` array (with a cache
version bump) so it's cached for offline use.

---

## Making a change

- **Keep PRs small and focused** — one thing at a time, matching the
  project's own commit discipline (see `git log`).
- **Follow existing patterns** rather than introducing new ones. If two
  approaches would both work, prefer whichever the surrounding code already
  does.
- **Colour:** never write a raw hex value or introduce a new colour. Read
  `CLAUDE colour UI.md` first — there's a strict three-class model (neutral /
  reserved-semantic / categorical) and reusing an existing token is almost
  always the right move.
- **Species database changes:** see `data/species-db.js`'s conventions in
  `CLAUDE.md` (dedup on `scientificName`, the fixed 15-group list, photo
  licensing rules — only `inaturalist-open-data.s3.amazonaws.com` URLs are
  safe to use, never `static.inaturalist.org`).
- **Security-sensitive areas** (anything touching `innerHTML`, imported
  frontmatter, or the service worker's cache/fetch logic) — these have a real
  history of subtle bugs recorded in `DECISIONS.md`. Extra care and a clear
  explanation of *why* in the PR description goes a long way.
- **Adding or updating a dependency?** Re-run
  `python3 scripts/gen-third-party-notices.py` from the repo root and commit
  the regenerated `THIRD-PARTY-NOTICES.txt` with your change. That file is
  what satisfies the attribution obligations of every bundled licence when a
  build is distributed — it's generated from the resolved dependency graph,
  so never edit it by hand. The same applies to anything added under
  `vendor/` or `fonts/` (which also need their own `LICENSE` file alongside).
- **New JS file?** Add it to `sw.js`'s `SHELL_CRITICAL` array *and* bump the
  cache version, or it won't be cached and offline use will break.

## Bug reports

Open an issue with: what you expected, what happened, and your browser/OS
(mobile PWA bugs especially depend on this). If it's a data problem (a wrong
species entry, a bad AphiaID), say which species and what's wrong — these are
usually quick fixes.

## Feature requests

Worth checking `ROADMAP.md` first — there's a good chance it's already
planned, deliberately parked, or was tried and reverted (in which case
`DECISIONS.md` will say why).

---

## Sign-off (DCO)

Contributions are accepted under a **Developer Certificate of Origin**: add
`Signed-off-by: Your Name <email>` to your commit message (`git commit -s`
does this automatically), certifying the contribution is your own work and
you're licensing it under the project's AGPL-3.0 licence. No separate
agreement to sign, no copyright assignment — just that one line.

## Licence

Shoal is licensed under **AGPL-3.0** (see `LICENSE.md`). By contributing, you
agree your changes are licensed under the same terms.

## Be kind

This is a small project maintained by one person in their spare time. Be
patient, be respectful, and assume good faith — the same goes both ways.
