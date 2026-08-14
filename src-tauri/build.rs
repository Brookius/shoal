use std::path::Path;

// Google Drive OAuth client secret — read from a local, gitignored file at
// BUILD time and handed to the main crate as a compile-time env var (see
// gdrive.rs's `env!("GDRIVE_CLIENT_SECRET")`). This keeps the literal value
// out of TRACKED source: it never appears in a commit, so it can't be read
// by cloning the repo, by a future public fork, or by anything (e.g. a cloud
// code-review tool) that operates on the repo's contents rather than the
// built binary.
//
// This does NOT reduce the OTHER, separately-accepted exposure — anyone with
// a copy of the built app can still `strings` the binary and find it there,
// since that's true of a compile-time-baked value regardless of where the
// literal originally came from. See DECISIONS.md — that tradeoff is why the
// app treats this as non-confidential-but-embedded in the first place, not
// something this file changes.
//
// Deliberately NO fallback: a missing file fails the build outright, with a
// message saying exactly what to do, rather than silently building against a
// wrong or absent secret — the two ways an env-var-with-fallback pattern
// usually goes wrong.
const SECRET_FILE: &str = "gdrive-client-secret.txt";

fn main() {
    let path = Path::new(SECRET_FILE);
    let secret = std::fs::read_to_string(path).unwrap_or_else(|_| {
        panic!(
            "\n\n  Missing {SECRET_FILE} — the Google Drive OAuth client secret.\n  \
             Create src-tauri/{SECRET_FILE} containing just the secret value\n  \
             (get it from Google Cloud Console → APIs & Services → Credentials).\n  \
             This file is gitignored on purpose — see build.rs.\n\n"
        )
    });
    let secret = secret.trim();
    println!("cargo:rustc-env=GDRIVE_CLIENT_SECRET={secret}");
    // Only re-run this build script if the secret file itself changes —
    // without this, cargo's default (rerun if ANY source file changes) is
    // fine too, but being explicit means a bare `touch` on the secret file
    // is guaranteed to pick up a rotated value on the next build.
    println!("cargo:rerun-if-changed={SECRET_FILE}");

    tauri_build::build()
}
