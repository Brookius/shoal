// Android folder sync via the Storage Access Framework (plan step 9,
// BRIEF-play-store-readiness.md §2.7).
//
// WHY THIS EXISTS: Android has no other working folder-access path. Both
// candidates were tried on real hardware and both are dead ends —
//   · the native `pick_folder` doesn't exist for Android in
//     tauri-plugin-dialog at all (compile error, not a runtime gap;
//     plugins-workspace#933, open since Feb 2024), and
//   · the web `showDirectoryPicker()` you'd fall back to rejects with
//     AbortError, because wry's onShowFileChooser never implements
//     MODE_OPEN_FOLDER (reproduces on any Android version — it's wry, not
//     the OS).
// See §2.3 for how that was established.
//
// SHAPE: these mirror lib.rs's desktop fs commands one-for-one, but take
// `(folder, filename)` instead of a concatenated `path`. That difference is
// forced, not stylistic: a content URI
// (`content://…/tree/primary%3ADocuments`) cannot have `/name.md` appended —
// resolving a child is an API call, not string work. This makes the Android
// backend shaped like the app's BROWSER backend (opaque handle + bare
// filename), not its desktop one. See §2.7.
//
// WIRE TYPE: `folder` crosses the IPC boundary as `serde_json::Value`, not as
// the plugin's own `FsUri`, for two reasons. Practically, `FsUri` only exists
// when the plugin is a dependency — which is Android-only — so a shared
// signature could not name it, and every command here needs a desktop stub so
// that lib.rs keeps ONE `generate_handler!` list (the macro can't cfg-gate
// individual entries; the alternative is duplicating the whole list per
// platform). Semantically it's also the more honest contract: the JS side is
// meant to treat this value as a black box it stores and hands back, and an
// opaque JSON blob says exactly that.
//
// It is deliberately NOT called `treeUri`: every other parameter in this
// codebase's fs surface is a plain word (`path`, `folder`, `filename`), and
// ACTION_OPEN_DOCUMENT_TREE is Android jargon that shouldn't leak into an API
// the JS side is supposed to treat as opaque.
//
// SECURITY: FolderScope/authorize() — the desktop path guard — does not apply
// here, because SAF is self-scoping: the OS refuses any access outside the
// tree the user granted, so there is no path-traversal surface of the desktop
// kind to guard. Re-implementing lexical path resolution over a content URI
// would only create the illusion of a check.
//
// BUT that is true only once you know the URI IS a SAF handle, and the wire
// type cannot tell you that by itself. `FsUri` derives `Deserialize` with
// `pub` fields and its own docs say the URI is "either the `content` or `file`
// scheme"; the plugin's Kotlin dispatcher sends `file` to `RawFileController`,
// which is bare `java.io.File` access with no SAF grant consulted. So a webview
// handing back a forged `{"uri":"file:///…"}` handle — or a forged string to
// `android_write_uri` — would get an unscoped read/write/delete/enumerate
// primitive. `require_content_scheme` (below) is the one check that closes
// that, and it is the SAF analogue of what `authorize()` does on desktop:
// establish that the caller is inside something the user actually granted.
// Every command taking a folder handle goes through `as_uri`, which calls it;
// `android_write_uri` takes a bare string and calls it directly.
// Found by security review, 2026-08-10 — the original version of this note
// asserted the guard "must not be added," which is what let it through.

#[cfg(target_os = "android")]
use tauri_plugin_android_fs::{AndroidFsExt, Entry, FsUri};

#[cfg(not(target_os = "android"))]
const NOT_ANDROID: &str = "SAF folder access is Android-only.";

// ── Android implementations ──────────────────────────────────────────────────

/// Deserialize the opaque handle JS handed back into the plugin's own type,
/// then check it is actually a SAF handle — see `require_content_scheme`.
#[cfg(target_os = "android")]
fn as_uri(folder: serde_json::Value) -> Result<FsUri, String> {
    let uri: FsUri = serde_json::from_value(folder)
        .map_err(|e| format!("that folder handle wasn't valid — re-pick the folder ({e})"))?;
    require_content_scheme(&uri.uri)?;
    Ok(uri)
}

/// The one guard the SAF backend needs, and the reason the header note above
/// is narrower than it used to be: SAF is self-scoping only for a `content://`
/// URI. `FsUri` is `#[derive(Deserialize)]` with `pub` fields (its own docs say
/// the URI is "either the `content` or `file` scheme"), so a forged handle like
/// `{"uri":"file:///data/data/<pkg>","documentTopTreeUri":null}` deserializes
/// perfectly happily — and the plugin's Kotlin dispatcher (`getFileController`,
/// AndroidFsPlugin.kt) routes `file` to `RawFileController`, which operates on
/// a bare `java.io.File` with the app's own uid and consults no SAF grant at
/// all. That is a full read/write/delete/enumerate primitive over everything
/// the process can reach, from a webview that is only supposed to hold an
/// opaque token.
///
/// The picker only ever returns `content://` tree URIs, so rejecting anything
/// else costs no legitimate behaviour. Note the plugin DOES already reject
/// `..`/`.`/root in the *filename* (`validate_relative_path`) — the escape this
/// closes is via the BASE, which nothing else validates.
#[cfg(target_os = "android")]
fn require_content_scheme(uri: &str) -> Result<(), String> {
    if uri.starts_with("content://") {
        Ok(())
    } else {
        Err("Refused: not a Storage Access Framework handle — re-pick the folder in Settings.".into())
    }
}

/// The folder created and offered during first-time setup. Also the name
/// checked against the user's actual pick when deciding whether the offered
/// folder went unused — see the cleanup at the end of `android_pick_folder`.
#[cfg(target_os = "android")]
const DEFAULT_DIR_NAME: &str = "Shoal";

/// Open the system folder picker and persist access to whatever is chosen.
///
/// Returns the folder as opaque JSON, or `None` if cancelled — matching
/// `pick_folder`'s desktop contract, where callers must treat a cancel as
/// "not connected" rather than an error.
///
/// `persist_uri_permission` is what makes the grant survive an app restart.
/// Without it the URI is valid only until the process dies, which would look
/// like folder sync silently forgetting its folder on every launch.
///
/// `offer_default` should be true ONLY for first-time setup (no folder
/// connected yet). See the comment on the creation itself below.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_pick_folder(
    app: tauri::AppHandle,
    offer_default: bool,
) -> Result<Option<serde_json::Value>, String> {
    let api = app.android_fs();

    // First-time setup only: create `Documents/Shoal` and open the picker
    // standing inside it, so the common case collapses to a single "Use this
    // folder" tap on a sensibly named folder the user didn't have to invent.
    // Android has no way to grant an app a folder without a pick (that IS
    // scoped storage), so removing the decision is as close to "the app just
    // made one" as the platform allows.
    //
    // Gated on `offer_default` because the cleanup below CANNOT run when the
    // user picks a cloud folder: removing `Documents/Shoal` needs a write grant
    // on local Documents, which we only hold if they picked at or above it. So
    // anyone who goes to Drive instead leaves an empty `Shoal` folder behind
    // in phone storage — observed on hardware 2026-08-01. Confining the offer
    // to first-time setup means a re-pick ("Change folder", already synced
    // somewhere) never creates one, which is where it's pure litter and no
    // help: the folder decision was already made.
    //
    // Best-effort throughout: `create_dir_all` errors are swallowed by the
    // plugin itself, and a location that fails to resolve just means the system
    // picks its own default. Never treat this as a precondition for the pick.
    let offered = if offer_default {
        api.picker()
            .resolve_public_storage_initial_location(
                None,
                tauri_plugin_android_fs::PublicGeneralPurposeDir::Documents,
                DEFAULT_DIR_NAME,
                true,
            )
            .ok()
    } else {
        None
    };

    // `local_only: false` — a Drive/cloud folder is the single most useful
    // target on Android (CLAUDE.md: SAF is what makes Drive backup work with
    // no OAuth at all). Restricting to local storage would remove the main
    // reason folder sync is worth having on a phone.
    let picked = api
        .picker()
        .pick_dir(offered.as_ref(), false)
        .map_err(|e| e.to_string())?;

    match picked {
        None => Ok(None),
        Some(uri) => {
            api.picker()
                .persist_uri_permission(&uri)
                .map_err(|e| e.to_string())?;

            // If they navigated elsewhere (most likely into Drive), don't leave
            // the folder we made littering Documents. Guarded on the display
            // NAME rather than URI equality: the initial-location URI and the
            // tree URI for the same directory are different values, so
            // comparing them would "detect a mismatch" every time and try to
            // delete the folder the user just picked.
            //
            // Safe in every direction. `remove_dir` refuses a non-empty
            // directory by contract, and we hold no write grant on local
            // Documents unless the user picked at or above it — so the worst
            // case is that this silently does nothing and one empty folder
            // stays behind. Never data loss, hence the swallowed errors.
            if let Some(offered) = offered {
                let picked_name = api.get_name(&uri).unwrap_or_default();
                if picked_name != DEFAULT_DIR_NAME {
                    let _ = api.remove_dir(&offered);
                }
            }

            serde_json::to_value(&uri)
                .map(Some)
                .map_err(|e| e.to_string())
        }
    }
}

/// Read one file from the picked folder. Mirrors `read_text_file`.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_read_file(
    app: tauri::AppHandle,
    folder: serde_json::Value,
    filename: String,
) -> Result<String, String> {
    let api = app.android_fs();
    let dir = as_uri(folder)?;
    let file = api
        .resolve_file_uri(&dir, &filename)
        .map_err(|e| e.to_string())?;
    api.read_to_string(&file).map_err(|e| e.to_string())
}

/// Write one file into the picked folder, creating it if absent.
/// Mirrors `write_text_file`.
///
/// `resolve_file_uri` errors when the file doesn't exist yet, so a failed
/// resolve is the create path — not an error to propagate. Every dive's FIRST
/// save takes this branch, so getting it wrong would mean folder sync
/// appearing to work only for dives that already existed.
///
/// The MIME type is `None`, NOT hardcoded — `create_new_file`'s own docs say
/// a hardcoded MIME is used to *enforce* a matching extension (Android's
/// `DocumentsContract.createDocument()` will append one), not just fill in a
/// missing one. This was hardcoded `Some("text/markdown")` here once, which
/// silently corrupted every sidecar's filename on first write: a name ending
/// `.footage.json` came back `.footage.json.md` (found live on a real device
/// — the `.md` dive file itself never showed the bug, since its own
/// extension already matched). `None` lets the plugin infer per-file instead.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_write_file(
    app: tauri::AppHandle,
    folder: serde_json::Value,
    filename: String,
    content: String,
) -> Result<(), String> {
    let api = app.android_fs();
    let dir = as_uri(folder)?;
    let file = match api.resolve_file_uri(&dir, &filename) {
        Ok(uri) => uri,
        Err(_) => api
            .create_new_file(&dir, &filename, None)
            .map_err(|e| e.to_string())?,
    };
    api.write(&file, content.as_bytes())
        .map_err(|e| e.to_string())
}

/// Delete one file from the picked folder. Mirrors `remove_file`.
///
/// A missing file is success, not failure — `_cleanupOldDiveFiles` and
/// `deleteDive` both call this best-effort on files that may already be gone,
/// exactly as the desktop and browser backends already tolerate.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_delete_file(
    app: tauri::AppHandle,
    folder: serde_json::Value,
    filename: String,
) -> Result<(), String> {
    let api = app.android_fs();
    let dir = as_uri(folder)?;
    match api.resolve_file_uri(&dir, &filename) {
        Ok(file) => api.remove_file(&file).map_err(|e| e.to_string()),
        Err(_) => Ok(()),
    }
}

/// Return `{ maxModified, files: [{name, content}] }` — `files` holding every
/// `.md` directly in the folder that's CHANGED since `since_ms`, or all of
/// them when `since_ms` is `None` (first sync for this folder).
///
/// This is the fix `android_list_filenames`'s listing-first change (above)
/// couldn't reach: that one cut the sidecar probes, but this command still
/// read all 94 `.md` files' CONTENT sequentially on every sync, including the
/// one fired at every boot — measured 62.5 s of the 119.5 s baseline after
/// the sidecar fix landed. `read_dir` already hands back `last_modified` per
/// entry in the same round trip that lists names, so skipping the
/// `read_to_string` call for anything not newer than the caller's cursor
/// turns a routine "nothing changed" sync into zero content reads.
///
/// `maxModified` is the newest `last_modified` THIS call observed across
/// every `.md` file, changed or not — never the device clock. That's what
/// makes the cursor immune to clock skew between the phone and whatever
/// clock the SAF provider stamps files with: the caller only ever compares a
/// value this function measured against a value this function returned
/// earlier, never against `Date.now()`. Defaults to `since_ms` (or 0) when
/// the folder has no `.md` files, so an empty folder can't corrupt a cursor
/// that already existed.
///
/// The JS side keys its stored cursor on the folder's own URI (see
/// `_androidFolderSyncCursor`, `js/app.js`), not a bare timestamp — this
/// command has no way to know if `since_ms` came from a DIFFERENT folder, so
/// staying correct across a folder change is entirely the caller's job.
///
/// Byte-identical `files` shape to desktop `list_md_files`'s bare array,
/// deliberately: the JS side parses one structure regardless of backend, so
/// `syncFromFolder` needs no per-platform parsing beyond unwrapping this one
/// extra layer.
///
/// Subdirectories are skipped (matching desktop's non-recursive `read_dir`),
/// and an unreadable file is skipped rather than failing the whole sync — one
/// bad file in a vault of hundreds shouldn't lose the other hundreds.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_list_md_files(
    app: tauri::AppHandle,
    folder: serde_json::Value,
    since_ms: Option<i64>,
) -> Result<serde_json::Value, String> {
    let api = app.android_fs();
    let dir = as_uri(folder)?;
    let entries = api.read_dir(&dir).map_err(|e| e.to_string())?;

    let mut max_modified = since_ms.unwrap_or(0);
    let mut files = Vec::new();
    for entry in entries {
        if let Entry::File { uri, name, last_modified, .. } = entry {
            if !name.to_lowercase().ends_with(".md") {
                continue;
            }
            let modified_ms = last_modified
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            if modified_ms > max_modified {
                max_modified = modified_ms;
            }
            let changed = match since_ms {
                Some(since) => modified_ms > since,
                None => true,
            };
            if changed {
                if let Ok(content) = api.read_to_string(&uri) {
                    files.push(serde_json::json!({ "name": name, "content": content }));
                }
            }
        }
    }
    Ok(serde_json::json!({ "maxModified": max_modified, "files": files }))
}

/// Return the bare filename of every file directly in the folder — names only,
/// never content.
///
/// Exists for the two sidecar loaders (`loadAllSidecars` in `js/video.js`,
/// `loadAllProfileSidecars` in `js/profile.js`), which otherwise probe
/// `<basename>.footage.json` / `.profile.json` once per dive. A **miss costs
/// exactly as much as a hit** there, and most dives have neither sidecar, so
/// the overwhelming majority of that work is round-trips that find nothing.
///
/// On a local folder that waste is invisible. On a **Drive-backed** SAF folder
/// every one of those probes is a network request through Google's
/// DocumentsProvider — measured on hardware 2026-08-01, a 94-dive vault in
/// Google Drive spent minutes almost entirely on ~190 mostly-failing sidecar
/// probes. Listing once and reading only what exists turns that into 2 calls
/// plus one read per sidecar that's genuinely there.
///
/// This is the same shape the Obsidian branch of both loaders has always used;
/// it needed this command to be portable to the SAF backend. Deliberately
/// unfiltered (no suffix argument) so one command serves both loaders and any
/// future caller — filtering a list already in memory is free, a second round
/// trip is not.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_list_filenames(
    app: tauri::AppHandle,
    folder: serde_json::Value,
) -> Result<Vec<String>, String> {
    let api = app.android_fs();
    let dir = as_uri(folder)?;
    let entries = api.read_dir(&dir).map_err(|e| e.to_string())?;
    Ok(entries
        .into_iter()
        .filter_map(|entry| match entry {
            Entry::File { name, .. } => Some(name),
            _ => None,
        })
        .collect())
}

/// The folder's human-readable display name, straight from the provider.
///
/// The JS side used to derive this by splitting the content URI and taking the
/// last path segment. That happens to work for local storage
/// (`…/tree/primary%3ADocuments` → `Documents`) and is meaningless for anything
/// else: a Google Drive folder's URI ends in an opaque document id, so Settings
/// showed users `acc=8;doc=encoded=eVbk4Q-zrXF85H-…` as the name of their
/// synced folder (seen on hardware 2026-08-01). Only the provider knows the
/// real name, and this is how you ask it.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_folder_name(
    app: tauri::AppHandle,
    folder: serde_json::Value,
) -> Result<String, String> {
    let api = app.android_fs();
    let dir = as_uri(folder)?;
    api.get_name(&dir).map_err(|e| e.to_string())
}

/// Write to a single file URI already in hand — as opposed to every other
/// write command in this file, which resolves a filename against a folder
/// grant. This is what `save_file_dialog`'s Android branch (`lib.rs`) needs:
/// its `ACTION_CREATE_DOCUMENT` result IS the write target, not a folder to
/// resolve one inside.
///
/// Found via the `isShell()` audit (BRIEF-play-store-readiness.md §2.10):
/// `save_file_dialog` already returns the right STRING on Android — a
/// `content://…` URI is exactly what `tauri_plugin_dialog::FilePath::Url`
/// stringifies to — but every caller piped it into `write_text_file`, which
/// is plain `std::fs::write` and has no concept of a content URI at all. The
/// native save dialog opened correctly; the write behind it was always going
/// to fail. `FsUri::from_uri` accepts that exact string directly — the two
/// plugins' URI representations interoperate by construction
/// (`tauri-plugin-android-fs` ships `impl From<FilePath> for FsUri` for
/// precisely this), so no bridging logic is needed beyond calling it.
///
/// No `persist_uri_permission` call: `ACTION_CREATE_DOCUMENT` grants the
/// returned URI a temporary read/write permission for the launching app,
/// which is exactly enough for the one write this does immediately after —
/// this is a one-shot export, not a folder being connected for future
/// sessions.
///
/// SECURITY: the scheme check is load-bearing here for the same reason it is
/// in `as_uri` — `FsUri::from_uri` wraps ANY string without validating it, so
/// without this a `file:///…` argument would reach `RawFileController` and
/// write anywhere the process can reach, unscoped by SAF. The desktop twin of
/// this command (`write_text_file`, lib.rs) is guarded by `authorize()`; this
/// is the SAF equivalent of that guard. The one real caller (js/species.js —
/// the unvalidated-species CSV export) always passes a URI that
/// `save_file_dialog` just returned, which is always `content://`.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_write_uri(
    app: tauri::AppHandle,
    uri: String,
    content: String,
) -> Result<(), String> {
    require_content_scheme(&uri)?;
    let api = app.android_fs();
    let target = FsUri::from_uri(uri);
    api.write(&target, content.as_bytes()).map_err(|e| e.to_string())
}

// ── Desktop stubs ────────────────────────────────────────────────────────────
// Same names and signatures so lib.rs's single generate_handler! list compiles
// everywhere. Never reachable in practice: the JS side only routes here when
// the platform discriminator says Android.

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_pick_folder(
    _app: tauri::AppHandle,
    _offer_default: bool,
) -> Result<Option<serde_json::Value>, String> {
    Err(NOT_ANDROID.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_read_file(
    _app: tauri::AppHandle,
    _folder: serde_json::Value,
    _filename: String,
) -> Result<String, String> {
    Err(NOT_ANDROID.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_write_file(
    _app: tauri::AppHandle,
    _folder: serde_json::Value,
    _filename: String,
    _content: String,
) -> Result<(), String> {
    Err(NOT_ANDROID.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_delete_file(
    _app: tauri::AppHandle,
    _folder: serde_json::Value,
    _filename: String,
) -> Result<(), String> {
    Err(NOT_ANDROID.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_list_md_files(
    _app: tauri::AppHandle,
    _folder: serde_json::Value,
    _since_ms: Option<i64>,
) -> Result<serde_json::Value, String> {
    Err(NOT_ANDROID.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_list_filenames(
    _app: tauri::AppHandle,
    _folder: serde_json::Value,
) -> Result<Vec<String>, String> {
    Err(NOT_ANDROID.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_folder_name(
    _app: tauri::AppHandle,
    _folder: serde_json::Value,
) -> Result<String, String> {
    Err(NOT_ANDROID.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_write_uri(
    _app: tauri::AppHandle,
    _uri: String,
    _content: String,
) -> Result<(), String> {
    Err(NOT_ANDROID.to_string())
}
