use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_dialog::DialogExt;

mod ble;
mod gdrive;
// SAF folder access — the only working folder path on Android. Compiled on
// every platform (desktop gets error-returning stubs) so the single
// generate_handler! list below stays platform-independent; see
// src/androidfs.rs's header and BRIEF-play-store-readiness.md §2.3/§2.7.
mod androidfs;

// ── Managed state shared across commands ─────────────────────────────────────

pub struct TranscodeState {
    cancel: AtomicBool,
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}

impl Default for TranscodeState {
    fn default() -> Self {
        Self {
            cancel: AtomicBool::new(false),
            child: Mutex::new(None),
        }
    }
}

// ── Filesystem access scope (security review F2) ─────────────────────────────
// read_text_file / write_text_file / remove_file / list_md_files /
// scan_proxy_folder / run_transcode all take a raw path from the webview.
// Without a guard, ANY script running in the webview (e.g. an XSS in imported
// dive data) could read/write/delete anywhere on disk. We confine these
// commands to folders the user has explicitly chosen through a NATIVE picker —
// an XSS can open a picker but cannot confirm a path on the user's behalf. The
// chosen roots are persisted app-side (NOT in localStorage, which the webview
// can forge) so folder sync keeps working across restarts without re-picking.

#[derive(Default)]
pub struct FolderScope {
    roots: Mutex<HashSet<PathBuf>>,
    store: Mutex<Option<PathBuf>>, // file the roots list is persisted to
}

// Canonicalise the nearest existing ancestor (resolving symlinks), then
// re-attach the remaining, traversal-free components. Lets us authorise a
// not-yet-created file (a new dive .md) by its parent, and makes root/target
// comparison symlink-consistent on macOS (/var → /private/var, etc.).
fn resolve_lexical(p: &Path) -> Result<PathBuf, String> {
    let mut existing = p;
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    while !existing.exists() {
        let name = existing.file_name().ok_or("could not resolve path")?;
        tail.push(name.to_os_string());
        existing = existing.parent().ok_or("could not resolve path")?;
    }
    let mut base = std::fs::canonicalize(existing).map_err(|e| e.to_string())?;
    for name in tail.iter().rev() {
        base.push(name);
    }
    Ok(base)
}

// Returns the resolved, authorised path, or an error the JS layer surfaces.
fn authorize(scope: &FolderScope, path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err("Refused: path is not absolute".into());
    }
    // Reject traversal components up front — belt to resolve_lexical's braces.
    if p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Refused: path contains '..'".into());
    }
    let resolved = resolve_lexical(p)?;
    let roots = scope.roots.lock().unwrap();
    // starts_with is component-wise, so /a/b/VaultEvil does NOT match /a/b/Vault.
    if roots.iter().any(|r| resolved.starts_with(r)) {
        Ok(resolved)
    } else {
        Err("Refused: path is outside the authorised dive folders — re-select the folder in Settings.".into())
    }
}

fn persist_scope(scope: &FolderScope) {
    let store = scope.store.lock().unwrap();
    let Some(file) = store.as_ref() else { return };
    let list: Vec<String> = scope
        .roots
        .lock()
        .unwrap()
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    if let Ok(txt) = serde_json::to_string(&list) {
        let _ = std::fs::write(file, txt);
    }
}

// Register a user-picked folder as an authorised root (canonicalised). Only
// ever called from the native-picker commands below.
fn add_root(scope: &FolderScope, dir: &Path) {
    let Ok(canon) = std::fs::canonicalize(dir) else { return };
    let inserted = scope.roots.lock().unwrap().insert(canon);
    if inserted {
        persist_scope(scope);
    }
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
struct TranscodeProgress {
    index: u32,
    total: u32,
    name: String,
    elapsed: String,
    pct: f32,   // 0.0–1.0 progress within the CURRENT file
}

#[derive(Serialize, Deserialize)]
struct TranscodeSummary {
    done: u32,
    skipped: u32,
    errors: u32,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn parse_hms_secs(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.trim().splitn(3, ':').collect();
    if parts.len() != 3 { return None; }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let sec: f64 = parts[2].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec)
}

fn fmt_mmss(secs: f64) -> String {
    let t = secs.max(0.0) as u32;
    format!("{}:{:02}", t / 60, t % 60)
}

// Pull the seconds value following `key` ("time=" or "Duration:") out of an
// ffmpeg -stats / banner line.
fn extract_ts_secs(line: &str, key: &str) -> Option<f64> {
    let pos = line.find(key)?;
    let rest = line[pos + key.len()..].trim_start();
    let ts: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == ':' || *c == '.').collect();
    if ts.len() >= 7 { parse_hms_secs(&ts) } else { None }
}

// ── Commands ──────────────────────────────────────────────────────────────────

// Generic folder picker — title is shown in the native dialog. Shared by
// three unrelated callers (dive vault, one-off export, video proxy
// folders), and macOS's native panel remembers wherever it was last
// opened with NO per-purpose isolation — so without default_path, picking
// a UDDF file via a plain <input type=file> in Downloads would leave the
// NEXT pick_folder call (e.g. reconnecting the dive vault) defaulting to
// Downloads too, silently repointing sync at the wrong folder if the user
// doesn't notice and just confirms. Callers that already have a folder
// (re-picking to change/reconnect it) should pass it as default_path so
// the dialog opens where the user actually expects to be.
// ANDROID SPIKE (2026-07-30, branch `android-spike`): tauri-plugin-dialog's
// FileDialogBuilder has no pick_folder() on Android at all — E0599 at build
// time, not a runtime gap — because "pick an arbitrary directory" is a
// desktop-shaped concept the plugin doesn't implement for a platform whose
// real equivalent is SAF's ACTION_OPEN_DOCUMENT_TREE intent. This is a real,
// useful finding, not just a compile-error to silence: it means Android
// folder access has to go through the WEB showDirectoryPicker() path (same
// as browser Android Chrome, question (a) of this spike) rather than this
// native command, which stays desktop/iOS-only below.
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle, title: String, default_path: Option<String>) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    let mut builder = app.dialog().file().set_title(&title);
    if let Some(p) = default_path.filter(|p| !p.is_empty()) {
        builder = builder.set_directory(p);
    }
    builder.pick_folder(move |path| {
        let _ = tx.send(path.map(|p| p.to_string()));
    });
    let result = rx.await.map_err(|e| e.to_string())?;
    if let Some(ref p) = result {
        add_root(app.state::<FolderScope>().inner(), Path::new(p));
    }
    Ok(result)
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn pick_folder(_app: tauri::AppHandle, _title: String, _default_path: Option<String>) -> Result<Option<String>, String> {
    Err("Native folder picker isn't available on Android — use the web showDirectoryPicker() path instead.".to_string())
}

// Native "Save As" dialog for a single file — returns the chosen full path,
// or None if cancelled. Needed because the browser's <a download> + blob-URL
// trick (downloadBlob() in app.js) silently no-ops in WKWebView (the native
// webview Tauri uses on macOS) instead of erroring — confirmed 2026-07-09,
// the "Export unvalidated species" button reported success but produced no
// file at all in the Tauri shell. Pair with write_text_file to actually save.
#[tauri::command]
async fn save_file_dialog(app: tauri::AppHandle, title: String, default_name: String) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    app.dialog()
        .file()
        .set_title(&title)
        .set_file_name(&default_name)
        .save_file(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });
    let result = rx.await.map_err(|e| e.to_string())?;
    // The write goes to this file; authorise its parent directory.
    if let Some(ref p) = result {
        if let Some(parent) = Path::new(p).parent() {
            add_root(app.state::<FolderScope>().inner(), parent);
        }
    }
    Ok(result)
}

// Kept for 2.43 transcode path — delegates to pick_folder.
// Same Android gap as pick_folder above — no native folder picker on mobile.
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn pick_video_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    app.dialog()
        .file()
        .set_title("Select video originals folder")
        .pick_folder(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });
    let result = rx.await.map_err(|e| e.to_string())?;
    if let Some(ref p) = result {
        add_root(app.state::<FolderScope>().inner(), Path::new(p));
    }
    Ok(result)
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn pick_video_folder(_app: tauri::AppHandle) -> Result<Option<String>, String> {
    Err("Native folder picker isn't available on Android — use the web showDirectoryPicker() path instead.".to_string())
}

// Argument shape locked to the proxy encode spec:
// scale=-2:1080, H.264 via Apple VideoToolbox (LGPL-clean — no GPL libx264),
// ~5 Mbps, aac 96k, faststart. allow_sw=1 falls back to software if the HW
// encoder is unavailable; tag avc1 keeps the stream broadly compatible.
// No free-form args from JS — this is the only permitted ffmpeg invocation.
#[tauri::command]
async fn run_transcode(
    app: tauri::AppHandle,
    folder: String,
    state: tauri::State<'_, TranscodeState>,
    scope: tauri::State<'_, FolderScope>,
) -> Result<TranscodeSummary, String> {
    let folder_path = authorize(scope.inner(), &folder)?;
    state.cancel.store(false, Ordering::SeqCst);

    let proxies_dir = folder_path.join("proxies");

    let video_exts = ["mp4", "mov", "m4v", "avi", "mkv"];
    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(folder_path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(|ext| video_exts.contains(&ext.to_lowercase().as_str()))
                .unwrap_or(false)
        })
        .collect();
    files.sort();

    if files.is_empty() {
        return Ok(TranscodeSummary { done: 0, skipped: 0, errors: 0 });
    }

    std::fs::create_dir_all(&proxies_dir).map_err(|e| e.to_string())?;

    let total = files.len() as u32;
    let mut done = 0u32;
    let mut skipped = 0u32;
    let mut errors = 0u32;

    for (i, source) in files.iter().enumerate() {
        if state.cancel.load(Ordering::SeqCst) { break; }

        let name = source.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();
        let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("output");
        let out = proxies_dir.join(format!("{}.mp4", stem));

        if out.exists() {
            skipped += 1;
            let _ = app.emit("transcode:progress", TranscodeProgress {
                index: i as u32 + 1, total, name: name.clone(), elapsed: String::new(), pct: 1.0,
            });
            continue;
        }

        let _ = app.emit("transcode:progress", TranscodeProgress {
            index: i as u32 + 1, total, name: name.clone(), elapsed: "0:00".into(), pct: 0.0,
        });

        let source_str = source.to_str().ok_or("invalid source path")?;
        let out_str = out.to_str().ok_or("invalid output path")?;

        let (mut rx, child) = app.shell()
            .sidecar("ffmpeg")
            .map_err(|e| e.to_string())?
            .args([
                "-nostdin", "-hide_banner", "-loglevel", "warning", "-stats",
                "-i", source_str,
                "-vf", "scale=-2:1080",
                "-c:v", "h264_videotoolbox", "-b:v", "5000k", "-allow_sw", "1", "-tag:v", "avc1",
                "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
                out_str,
            ])
            .spawn()
            .map_err(|e| e.to_string())?;

        {
            let mut lock = state.child.lock().unwrap();
            *lock = Some(child);
        }

        let mut file_dur: f64 = 0.0;   // parsed from ffmpeg's "Duration:" line, once per file
        let mut succeeded = false;
        loop {
            if state.cancel.load(Ordering::SeqCst) {
                let mut lock = state.child.lock().unwrap();
                if let Some(c) = lock.take() { let _ = c.kill(); }
                break;
            }
            match rx.recv().await {
                Some(CommandEvent::Stderr(bytes)) => {
                    let line = String::from_utf8_lossy(&bytes);
                    for segment in line.split(['\r', '\n']) {
                        if file_dur <= 0.0 {
                            if let Some(d) = extract_ts_secs(segment, "Duration:") { file_dur = d; }
                        }
                        if let Some(secs) = extract_ts_secs(segment, "time=") {
                            let pct = if file_dur > 0.0 { (secs / file_dur).min(1.0) as f32 } else { 0.0 };
                            let _ = app.emit("transcode:progress", TranscodeProgress {
                                index: i as u32 + 1, total, name: name.clone(),
                                elapsed: fmt_mmss(secs), pct,
                            });
                        }
                    }
                }
                Some(CommandEvent::Terminated(payload)) => {
                    succeeded = payload.code.map(|c| c == 0).unwrap_or(false);
                    let mut lock = state.child.lock().unwrap();
                    *lock = None;
                    break;
                }
                None => break,
                _ => {}
            }
        }

        if succeeded { done += 1; } else if !state.cancel.load(Ordering::SeqCst) { errors += 1; }
    }

    Ok(TranscodeSummary { done, skipped, errors })
}

#[tauri::command]
fn cancel_transcode(state: tauri::State<'_, TranscodeState>) {
    state.cancel.store(true, Ordering::SeqCst);
    let mut lock = state.child.lock().unwrap();
    if let Some(child) = lock.take() { let _ = child.kill(); }
}

// ── App info / update check (v2.994) ─────────────────────────────────────────
// Tauri has no auto-updater wired up here — release.sh is a manual, unsigned
// DMG build with no update-manifest infrastructure (see README.md → "Dev /
// build"). This pair is the lightweight alternative: js/app.js reads its own
// version via get_app_version, compares it to landing/downloads/latest.json
// (published by release.sh on every real release), and offers open_url as
// the one safe way to act on that — see checkForAppUpdate() in js/app.js.

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

// Opens a URL in the user's default browser via the macOS `open` command —
// deliberately NOT the shell plugin (would need a new capabilities grant for
// one call site) and deliberately NOT a shell string (Command::arg passes the
// URL as a single argv entry, never through `sh -c`, so this can't become a
// command-injection primitive regardless of content). The https-only check is
// a second, cheap belt-and-braces restriction: it stops a compromised webview
// from using this as a generic "launch any URI scheme" primitive.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("only https URLs may be opened".into());
    }
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Filesystem commands (vault sync + proxy scan) ────────────────────────────

#[tauri::command]
fn read_text_file(scope: tauri::State<'_, FolderScope>, path: String) -> Result<String, String> {
    let p = authorize(scope.inner(), &path)?;
    std::fs::read_to_string(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(scope: tauri::State<'_, FolderScope>, path: String, content: String) -> Result<(), String> {
    let p = authorize(scope.inner(), &path)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_file(scope: tauri::State<'_, FolderScope>, path: String) -> Result<(), String> {
    let p = authorize(scope.inner(), &path)?;
    std::fs::remove_file(&p).map_err(|e| e.to_string())
}

// Returns [{name, content}] for every .md file directly in `folder`.
#[tauri::command]
fn list_md_files(scope: tauri::State<'_, FolderScope>, folder: String) -> Result<Vec<serde_json::Value>, String> {
    let dir = authorize(scope.inner(), &folder)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path  = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") { continue; }
        let name    = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        out.push(serde_json::json!({ "name": name, "content": content }));
    }
    Ok(out)
}

const VIDEO_EXTS: [&str; 6] = ["mp4", "mov", "m4v", "avi", "mkv", "webm"];
// Guards against a pathological tree; real footage layouts are trip/day/dive.
const SCAN_MAX_DEPTH: usize = 8;

// Recursive half of scan_proxy_folder. `root` is the authorised scan root and
// is only used to compute each file's path relative to it.
//
// SECURITY: uses entry.file_type() (lstat — does NOT follow symlinks) and
// skips symlinks outright, rather than path.is_dir()/is_file() (which stat
// *through* a link). Without that, a symlink inside an authorised root
// pointing anywhere on disk would be descended into and its real target
// emitted — paths that never passed through authorize(). See scope_tests.
fn scan_videos_into(
    dir: &Path,
    root: &Path,
    out: &mut Vec<serde_json::Value>,
    depth: usize,
) -> Result<(), String> {
    if depth > SCAN_MAX_DEPTH {
        return Ok(());
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        // An unreadable subdirectory shouldn't fail the whole scan.
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let path = entry.path();
        if ft.is_dir() {
            scan_videos_into(&path, root, out, depth + 1)?;
            continue;
        }
        if !ft.is_file() {
            continue;
        }
        let ext_ok = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| VIDEO_EXTS.contains(&e.to_lowercase().as_str()))
            .unwrap_or(false);
        if !ext_ok {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let abs_path = path.to_str().unwrap_or("").to_string();
        let rel_path = path
            .strip_prefix(root)
            .ok()
            .and_then(|p| p.to_str())
            .unwrap_or(&name)
            .to_string();
        let meta = entry.metadata().ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        // Milliseconds since the Unix epoch, to match JS File.lastModified.
        let modified = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(serde_json::json!({
            "name": name, "path": abs_path, "relPath": rel_path,
            "size": size, "modified": modified
        }));
    }
    Ok(())
}

// Returns [{name, path, relPath, size, modified}] for every video file under
// `folder`, RECURSIVELY. `path` is absolute (usable with convertFileSrc());
// `relPath` is relative to `folder`.
//
// Recursion (2026-07-25) is what lets one connected trip folder cover footage
// filed into per-dive subfolders, so the folder used for capture-time matching
// and the folder used for playback can be the same one. Subdirectories are
// already inside the authorised root — authorize() matches by path prefix — so
// no extra registration is needed for them.
#[tauri::command]
fn scan_proxy_folder(scope: tauri::State<'_, FolderScope>, folder: String) -> Result<Vec<serde_json::Value>, String> {
    let dir = authorize(scope.inner(), &folder)?;
    let mut out = Vec::new();
    scan_videos_into(&dir, &dir, &mut out, 0)?;
    Ok(out)
}

// Cap on a single read_file_range call. The caller (js/footage-match.js) walks
// a video's box table 16 bytes at a time, so this is a sanity bound against a
// malformed size sending a multi-gigabyte allocation through IPC, not a limit
// anything legitimate approaches.
const MAX_RANGE_LEN: u64 = 1 << 20;

// Read `len` bytes from `path` starting at `offset`. Exists so the shell can
// parse a video's own capture time (ISO-BMFF moov/mvhd) from a file it knows
// only by path — the browser gets the same bytes from a File object, which
// WKWebView has no equivalent of once the folder came from a native picker.
// Reads are tiny and sparse (a box table walk), never the whole file.
#[tauri::command]
fn read_file_range(
    scope: tauri::State<'_, FolderScope>,
    path: String,
    offset: u64,
    len: u64,
) -> Result<Vec<u8>, String> {
    use std::io::{Read, Seek, SeekFrom};
    let p = authorize(scope.inner(), &path)?;
    let capped = len.min(MAX_RANGE_LEN) as usize;
    let mut f = std::fs::File::open(&p).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; capped];
    // Short reads are normal at EOF — truncate rather than erroring, so a
    // box walk that runs past the end just sees fewer bytes and stops.
    let mut filled = 0;
    while filled < capped {
        match f.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(e) => return Err(e.to_string()),
        }
    }
    buf.truncate(filled);
    Ok(buf)
}

// ── Tide events (Admiralty UK Tidal API, desktop-only — v2.6 phase 2.57) ────
// Native reqwest bypasses the webview's CORS and keeps the user's own key out
// of the public web build. Discovery tier confirmed live (2026-06): GeoJSON
// FeatureCollection from Stations, flat array from {id}/TidalEvents, auth via
// Ocp-Apim-Subscription-Key. No server-side "nearest station" search exists in
// this tier, so the full station list is fetched once and the closest is
// picked client-side (Haversine) — that's normal, not a fallback for a missing
// feature. TidalEvents with no `duration` defaults to today + the next 6 days
// (the whole free-tier window); Premium-only endpoints (arbitrary date range,
// single-point height) are out of scope.

const ADMIRALTY_BASE: &str = "https://admiraltyapi.azure-api.net/uktidalapi/api/V1";

#[derive(Deserialize)]
struct StationsResponse {
    features: Vec<StationFeature>,
}

#[derive(Deserialize)]
struct StationFeature {
    geometry: StationGeometry,
    properties: StationProperties,
}

#[derive(Deserialize)]
struct StationGeometry {
    coordinates: (f64, f64), // GeoJSON order: [longitude, latitude]
}

#[derive(Deserialize)]
struct StationProperties {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "Name")]
    name: String,
}

#[derive(Deserialize)]
struct TidalEventRaw {
    #[serde(rename = "EventType")]
    event_type: String,
    #[serde(rename = "DateTime")]
    date_time: Option<String>,
    #[serde(rename = "Height")]
    height: Option<f64>,
}

#[derive(Serialize)]
struct TideEventOut {
    #[serde(rename = "type")]
    event_type: String, // 'high' | 'low'
    #[serde(rename = "timeISO")]
    time_iso: String,
    #[serde(rename = "heightM")]
    height_m: f64,
}

#[derive(Serialize)]
struct TideEventsOut {
    #[serde(rename = "stationId")]
    station_id: String,
    #[serde(rename = "stationName")]
    station_name: String,
    events: Vec<TideEventOut>,
}

fn haversine_km(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    const EARTH_RADIUS_KM: f64 = 6371.0;
    let d_lat = (lat2 - lat1).to_radians();
    let d_lng = (lng2 - lng1).to_radians();
    let a = (d_lat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lng / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
    EARTH_RADIUS_KM * c
}

async fn admiralty_get(client: &reqwest::Client, url: &str, api_key: &str) -> Result<reqwest::Response, String> {
    let resp = client.get(url)
        .header("Ocp-Apim-Subscription-Key", api_key)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("Admiralty request failed: {e}"))?;

    match resp.status().as_u16() {
        200 => Ok(resp),
        401 => Err("Admiralty API key is missing or invalid — check Settings.".into()),
        403 => Err("Admiralty API quota exceeded for this key (Discovery tier: 10k/month).".into()),
        404 => Err("Admiralty station not found.".into()),
        429 => Err("Too many requests to the Admiralty API — try again shortly.".into()),
        code => Err(format!("Admiralty API returned HTTP {code}")),
    }
}

// Discovery's 607 stations are all UK/Ireland/Channel Islands — a "nearest"
// station hundreds of km away (e.g. a Thailand dive site) isn't useful data,
// it's a wasted call against the 10k/month quota. The JS layer already
// skips the call for obviously-non-UK coordinates (a bounding box, before
// any network round-trip); this distance check is the backstop for
// anything that slips past that — e.g. open water just outside the box.
const MAX_PLAUSIBLE_STATION_KM: f64 = 400.0;

// No server-side geo filter in the Discovery tier, so the full station list
// is searched client-side. Split out from fetch_tide_events so it's unit
// testable without a live key. Returns the distance too, so the caller can
// reject a too-far match before spending a second API call on it.
fn select_nearest_station(features: &[StationFeature], lat: f64, lng: f64) -> Option<(&StationFeature, f64)> {
    features.iter()
        .map(|f| {
            let (flng, flat) = f.geometry.coordinates;
            (f, haversine_km(lat, lng, flat, flng))
        })
        .min_by(|(_, da), (_, db)| da.partial_cmp(db).unwrap_or(std::cmp::Ordering::Equal))
}

// DateTime/Height "may be missing if invalid" per the API spec — drop those
// events rather than surface a null time/height to the UI.
fn normalize_events(raw: Vec<TidalEventRaw>) -> Vec<TideEventOut> {
    raw.into_iter()
        .filter_map(|e| {
            let event_type = match e.event_type.as_str() {
                "HighWater" => "high",
                "LowWater" => "low",
                _ => return None,
            };
            Some(TideEventOut {
                event_type: event_type.to_string(),
                time_iso: e.date_time?,
                height_m: e.height?,
            })
        })
        .collect()
}

#[tauri::command]
async fn fetch_tide_events(lat: f64, lng: f64, api_key: String) -> Result<TideEventsOut, String> {
    if api_key.trim().is_empty() {
        return Err("No Admiralty API key configured.".into());
    }
    let client = reqwest::Client::new();

    let stations: StationsResponse = admiralty_get(&client, &format!("{ADMIRALTY_BASE}/Stations"), &api_key)
        .await?
        .json()
        .await
        .map_err(|e| format!("Could not parse Admiralty stations response: {e}"))?;

    let (nearest, distance_km) = select_nearest_station(&stations.features, lat, lng)
        .ok_or("Admiralty returned no tidal stations.")?;

    if distance_km > MAX_PLAUSIBLE_STATION_KM {
        return Err(format!(
            "No Admiralty station within range ({} is {:.0} km away) — Discovery only covers UK and Ireland waters.",
            nearest.properties.name, distance_km
        ));
    }

    let raw_events: Vec<TidalEventRaw> = admiralty_get(
        &client,
        &format!("{ADMIRALTY_BASE}/Stations/{}/TidalEvents", nearest.properties.id),
        &api_key,
    )
        .await?
        .json()
        .await
        .map_err(|e| format!("Could not parse Admiralty tidal events response: {e}"))?;

    Ok(TideEventsOut {
        station_id: nearest.properties.id.clone(),
        station_name: nearest.properties.name.clone(),
        events: normalize_events(raw_events),
    })
}

#[cfg(test)]
mod tide_tests {
    use super::*;

    // Sample shapes match the confirmed real API (GeoJSON.Net FeatureCollection
    // for Stations; flat array for TidalEvents) — checked directly against the
    // ADMIRALTY swagger spec and a live unauthenticated probe, June 2026.
    const SAMPLE_STATIONS_JSON: &str = r#"{
        "type": "FeatureCollection",
        "features": [
            { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-5.0527, 50.1184] },
              "properties": { "Id": "0102", "Name": "Falmouth" } },
            { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-1.4044, 50.9097] },
              "properties": { "Id": "0091", "Name": "Portsmouth" } },
            { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-3.5275, 50.3656] },
              "properties": { "Id": "0095", "Name": "Dartmouth" } }
        ]
    }"#;

    const SAMPLE_EVENTS_JSON: &str = r#"[
        { "EventType": "HighWater", "DateTime": "2026-06-16T03:12:00", "Height": 4.8, "IsApproximateTime": false, "IsApproximateHeight": false, "Filtered": false },
        { "EventType": "LowWater",  "DateTime": "2026-06-16T09:24:00", "Height": 0.6, "IsApproximateTime": false, "IsApproximateHeight": false, "Filtered": false },
        { "EventType": "HighWater", "DateTime": null, "Height": null, "IsApproximateTime": true, "IsApproximateHeight": true, "Filtered": true }
    ]"#;

    #[test]
    fn deserializes_real_stations_shape() {
        let parsed: StationsResponse = serde_json::from_str(SAMPLE_STATIONS_JSON).unwrap();
        assert_eq!(parsed.features.len(), 3);
        assert_eq!(parsed.features[0].properties.id, "0102");
        assert_eq!(parsed.features[0].properties.name, "Falmouth");
        assert_eq!(parsed.features[0].geometry.coordinates, (-5.0527, 50.1184));
    }

    #[test]
    fn picks_genuinely_nearest_station() {
        let parsed: StationsResponse = serde_json::from_str(SAMPLE_STATIONS_JSON).unwrap();
        // Porthkerris, near Falmouth — should win over Portsmouth and Dartmouth.
        let (nearest, distance_km) = select_nearest_station(&parsed.features, 50.05, -5.08).unwrap();
        assert_eq!(nearest.properties.id, "0102");
        assert!(distance_km < 10.0, "expected Porthkerris-Falmouth to be a few km, got {distance_km}");

        // A point near Portsmouth should instead pick Portsmouth.
        let (nearest2, _) = select_nearest_station(&parsed.features, 50.80, -1.10).unwrap();
        assert_eq!(nearest2.properties.id, "0091");
    }

    #[test]
    fn empty_station_list_returns_none() {
        let empty: Vec<StationFeature> = vec![];
        assert!(select_nearest_station(&empty, 50.0, -5.0).is_none());
    }

    #[test]
    fn rejects_a_station_thats_implausibly_far_away() {
        // Same 3 UK stations, but queried from Phuket, Thailand — nothing in
        // the Discovery tier is remotely useful here, so the distance check
        // (not just "found *a* station") is what should catch this case.
        let parsed: StationsResponse = serde_json::from_str(SAMPLE_STATIONS_JSON).unwrap();
        let (_, distance_km) = select_nearest_station(&parsed.features, 7.8804, 98.3923).unwrap();
        assert!(distance_km > MAX_PLAUSIBLE_STATION_KM,
            "expected Thailand to be far past the {MAX_PLAUSIBLE_STATION_KM}km cutoff, got {distance_km}km");
    }

    #[test]
    fn normalizes_event_types_and_drops_invalid() {
        let raw: Vec<TidalEventRaw> = serde_json::from_str(SAMPLE_EVENTS_JSON).unwrap();
        let events = normalize_events(raw);
        // The third event (null DateTime/Height) must be dropped, not panic.
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event_type, "high");
        assert_eq!(events[0].time_iso, "2026-06-16T03:12:00");
        assert_eq!(events[0].height_m, 4.8);
        assert_eq!(events[1].event_type, "low");
        assert_eq!(events[1].height_m, 0.6);
    }

    #[test]
    fn haversine_known_distance_sanity() {
        // London to Paris is ~344 km — sanity-check the formula isn't wildly off.
        let d = haversine_km(51.5074, -0.1278, 48.8566, 2.3522);
        assert!((300.0..400.0).contains(&d), "expected ~344km, got {d}");
    }
}

// Locks in the filesystem-scope guard (security review F2): every fs command
// must reject a path the user never authorised, even one that shares a string
// prefix with an authorised folder or uses `..`.
#[cfg(test)]
mod scope_tests {
    use super::*;

    fn scope_rooted_at(dir: &Path) -> FolderScope {
        let scope = FolderScope::default();
        scope
            .roots
            .lock()
            .unwrap()
            .insert(std::fs::canonicalize(dir).unwrap());
        scope
    }

    // A recursive scan must not follow a symlink out of the authorised root.
    // authorize() only vets the path handed IN; every path the walk produces
    // is emitted without re-checking, so if the walk descended through links
    // it would hand the webview absolute paths to files anywhere on disk —
    // and read_file_range would then happily authorise those same paths only
    // if they resolved back inside a root, but convertFileSrc()/playback
    // would already have leaked their location. Cheaper to never walk them.
    #[test]
    fn recursive_scan_does_not_follow_symlinks_out_of_the_root() {
        let base = std::env::temp_dir().join(format!("shoal-symlink-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("trip");
        let outside = base.join("elsewhere");
        std::fs::create_dir_all(root.join("dive-1")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        // A real video inside the root (nested, to prove recursion works)…
        std::fs::write(root.join("dive-1").join("GX010001.MP4"), b"x").unwrap();
        // …and one only reachable by following a symlink out of it.
        std::fs::write(outside.join("SECRET.MP4"), b"x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();

        let canon = std::fs::canonicalize(&root).unwrap();
        let mut out = Vec::new();
        scan_videos_into(&canon, &canon, &mut out, 0).unwrap();

        let names: Vec<String> = out
            .iter()
            .map(|v| v["name"].as_str().unwrap_or("").to_string())
            .collect();
        assert!(names.contains(&"GX010001.MP4".to_string()), "recursion should find nested files, got {names:?}");
        assert!(!names.contains(&"SECRET.MP4".to_string()), "must not follow a symlink out of the root, got {names:?}");

        // relPath is relative to the scan root, not absolute.
        let rel = out[0]["relPath"].as_str().unwrap();
        assert_eq!(rel, "dive-1/GX010001.MP4", "relPath should be root-relative");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn confines_fs_access_to_authorised_roots() {
        let base = std::env::temp_dir().join(format!("shoal-scope-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let vault = base.join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        let scope = scope_rooted_at(&vault);

        let ok = |p: PathBuf| authorize(&scope, p.to_str().unwrap());

        // The vault itself, and a not-yet-created file inside it, are allowed.
        assert!(ok(vault.clone()).is_ok());
        assert!(ok(vault.join("dive-001-site.md")).is_ok());

        // A sibling folder sharing a string prefix must NOT match (component-wise).
        let evil = base.join("vaultEvil");
        std::fs::create_dir_all(&evil).unwrap();
        assert!(ok(evil.join("x.md")).is_err());

        // Traversal, an unrelated absolute path, and a relative path are refused.
        assert!(ok(vault.join("../secret.txt")).is_err());
        assert!(authorize(&scope, "/etc/hosts").is_err());
        assert!(authorize(&scope, "vault/x.md").is_err());

        let _ = std::fs::remove_dir_all(&base);
    }
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TranscodeState::default())
        .manage(ble::BleState::default())
        .manage(FolderScope::default())
        .manage(gdrive::GDriveState::default())
        .setup(|app| {
            // SAF folder access (Android only). Registered here rather than in
            // the builder chain to match how tauri_plugin_log is already added
            // below — a cfg-gated `.plugin()` mid-chain would mean breaking the
            // chain apart for one platform.
            #[cfg(target_os = "android")]
            app.handle().plugin(tauri_plugin_android_fs::init())?;
            // BLE dive-computer sync transport (Android only) — see ble.rs's
            // Android section and BRIEF-play-store-readiness.md §2.8. No
            // `.manage()` call needed: get_handler() is the plugin's own
            // process-wide singleton, not app-managed state.
            #[cfg(target_os = "android")]
            app.handle().plugin(tauri_plugin_blec::init())?;
            // Google Drive OAuth redirect (Android only) — see gdrive.rs's
            // Android consent flow and BRIEF-play-store-readiness.md §2.9.
            // The custom scheme itself is declared in tauri.conf.json's
            // plugins.deep-link.mobile, which is what generates the
            // Android manifest's intent-filter at build time.
            #[cfg(target_os = "android")]
            app.handle().plugin(tauri_plugin_deep_link::init())?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Load the persisted folder-access allowlist (security review F2).
            // Roots picked in a previous session are re-authorised here so
            // boot-time folder sync works without a fresh pick. Entries that no
            // longer exist are silently dropped.
            let scope = app.state::<FolderScope>();
            if let Ok(dir) = app.path().app_config_dir() {
                let _ = std::fs::create_dir_all(&dir);
                let file = dir.join("allowed-folders.json");
                if let Ok(txt) = std::fs::read_to_string(&file) {
                    if let Ok(list) = serde_json::from_str::<Vec<String>>(&txt) {
                        let mut roots = scope.roots.lock().unwrap();
                        for s in &list {
                            if let Ok(canon) = std::fs::canonicalize(s) {
                                roots.insert(canon);
                            }
                        }
                    }
                }
                *scope.store.lock().unwrap() = Some(file);
            }
            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            open_url,
            pick_folder,
            pick_video_folder,
            save_file_dialog,
            run_transcode,
            cancel_transcode,
            read_text_file,
            write_text_file,
            remove_file,
            list_md_files,
            scan_proxy_folder,
            read_file_range,
            fetch_tide_events,
            gdrive::gdrive_connect,
            gdrive::gdrive_status,
            gdrive::gdrive_disconnect,
            gdrive::gdrive_scope_setup,
            gdrive::gdrive_scope_probe,
            ble::ble_available,
            ble::ble_scan,
            ble::ble_connect,
            ble::ble_write,
            ble::ble_disconnect,
            androidfs::android_pick_folder,
            androidfs::android_read_file,
            androidfs::android_write_file,
            androidfs::android_delete_file,
            androidfs::android_list_md_files,
            androidfs::android_list_filenames,
            androidfs::android_folder_name,
            androidfs::android_write_uri,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
