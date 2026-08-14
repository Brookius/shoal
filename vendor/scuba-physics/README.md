# scuba-physics (vendored)

Bühlmann ZHL-16C decompression engine, used for the Plan panel's
surface-interval calculator (recreational, no-stop only).

- **Source:** `projects/scuba-physics` inside [jirkapok/GasPlanner](https://github.com/jirkapok/GasPlanner) (MIT)
- **Commit vendored:** `b3c4814b7af938b3eb0c0758c3700cbf72e6cbf3`
- **License:** MIT — see `LICENSE` in this folder (copied verbatim from source)
- **SHA-256 of `scuba-physics.min.js`:** `d43f95d34e09015a1d4c7805d93a3685c00705da577edca319d008128a5e27d8`

Not published standalone on npm — it's a sub-package of an Angular monorepo,
so this bundle was produced manually:

1. Sparse-checkout `projects/scuba-physics/src` at the commit above (lib only,
   `*.spec.ts` and `test.ts` excluded).
2. `tsc --noEmit` against a plain (non-Angular) tsconfig to confirm the
   algorithm code has zero Angular coupling — only relative imports plus
   `lodash` (also MIT, bundled in).
3. `esbuild src/public-api.ts --bundle --format=iife --global-name=ScubaPhysics --minify`
   → single-file IIFE attaching `window.ScubaPhysics`.
4. Validated against the library's own published NDL test table
   (`BuhlmannAlgorithm.nodeco.spec.ts`) — 24/24 exact matches at GF 100/100
   and GF 40/85, fresh water, air. Surface-interval offgassing checked
   monotonic (longer rest → longer next-dive NDL) before relying on it for
   a binary search.

Loaded lazily (like `vendor/leaflet/`) — see `loadScubaPhysics()` in
`js/planner.js`. Not an npm dependency, so nothing will flag upstream fixes;
re-run the steps above against a newer commit if this ever needs updating.
