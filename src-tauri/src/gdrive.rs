// Google Drive OAuth (v2.983) — real token persistence, replacing the
// throwaway spike this was built from.
//
// The spike (gdrive_spike, removed here) answered one yes/no question before
// anything got built on it: BRIEF-footage-cloud-hosting.md §4.3/DECISIONS.md
// has the full story, including the correction it forced — Google's token
// endpoint requires client_secret even for a Desktop-app client with PKCE,
// contrary to what the docs implied. That's settled; this module is the real
// integration built on the corrected premise.
//
// Three commands, invoked from Settings & data (not yet wired into the UI —
// that's the next piece, not this one):
//   gdrive_connect()    — runs the loopback-listener consent flow, persists
//                         the resulting tokens to the OS keychain, returns
//                         the connected account's email for display.
//   gdrive_status()     — cheap local check, no network call.
//   gdrive_disconnect() — revokes the grant server-side (best-effort) and
//                         clears the local record.
// A fourth function, get_valid_access_token(), is NOT a command — it's what
// every future Drive-calling command (upload, list, etc.) will call
// internally to get a token that's guaranteed fresh, refreshing first if
// needed. Not called anywhere yet since nothing calls Drive for real work
// yet; #[allow(dead_code)] until the upload pipeline lands.
//
// Tokens never reach the webview. They're stored via the `keyring` crate
// against the real macOS Keychain (Entry::new/set_password/get_password/
// delete_credential — verified against the crate's actual 3.6.3 source, not
// assumed from docs, given how many assumptions in this exact feature turned
// out wrong when actually tested), never in localStorage or IndexedDB. That
// matters specifically here: this app's CSP allows 'unsafe-inline', so
// esc()-escaping imported data is the PRIMARY XSS defence, not a backstop —
// anything JS-reachable should be assumed reachable by an XSS in imported
// dive data. A refresh token is a much bigger prize than anything currently
// at risk of that.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
#[cfg(not(target_os = "android"))]
use keyring::Entry;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_shell::ShellExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

// Registered as a Desktop-app OAuth client in Google Cloud Console
// (BRIEF-footage-cloud-hosting.md §4.3).
//
// CLIENT_SECRET is embedded in the compiled BINARY, same as CLIENT_ID — the
// standard, Google-sanctioned pattern for installed/desktop OAuth apps
// (predates PKCE; gcloud and rclone ship the same way), NOT a real secret in
// the sense the Admiralty API key (lib.rs — fetch_tide_events) is. Anyone
// with a copy of the built app can extract it with `strings`; the risk that
// matters is what a stolen (client_id, client_secret) pair can be used for,
// not whether it can be read out. Bounded two ways right now: drive.file
// scope caps any resulting grant to files the victim explicitly picked, and
// — more importantly while this stays true — the OAuth consent screen's
// Testing-mode test-user allowlist is enforced by Google against the
// SIGNING-IN ACCOUNT, not against which software is driving the flow, so a
// stranger with the stolen pair still has no one they can get through
// consent as long as the project stays unpublished.
//
// It is NOT embedded in tracked SOURCE, which is a different exposure this
// app is now avoiding for a different, more imminent reason: an open-source
// release is being considered, and anyone who can read the repo (or a cloud
// tool that operates on it) would otherwise get this for free, no binary
// required. build.rs reads it from a local, gitignored file at build time
// and hands it here via env!() — see build.rs for why there's deliberately
// no fallback. See DECISIONS.md for the full account, including why this
// specific value's presence here was its own separate, explicit decision —
// not one to assume still stands without checking, and why an EARLIER
// commit (before this file existed) still has the literal value in its
// history regardless of what this file now says.
const CLIENT_ID: &str =
    "648899552363-jiiafth440r009msj28d1ojqrhddnt8q.apps.googleusercontent.com";
const CLIENT_SECRET: &str = env!("GDRIVE_CLIENT_SECRET");
const SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT: &str = "https://oauth2.googleapis.com/revoke";
const DRIVE_ABOUT: &str = "https://www.googleapis.com/drive/v3/about";
const DRIVE_FILES: &str = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3/files";

// How long to wait on the loopback listener for the browser to come back.
// Long enough for a human to actually read and click through the Google
// consent screen; short enough that an abandoned run doesn't hang forever.
const CONSENT_TIMEOUT_SECS: u64 = 180;

// The loopback listener accepts repeatedly until a request carrying OUR state
// shows up (see run_consent_flow), so it needs its own bounds: a cap on how
// many connections it will look at, and a per-connection read timeout so one
// that opens and then says nothing can't stall the whole flow. Both are
// generous against a real browser, which makes one or two connections.
const MAX_REDIRECT_ATTEMPTS: usize = 20;
const REDIRECT_READ_TIMEOUT_SECS: u64 = 10;

// Refresh this long before the access token would actually expire, so a
// caller never hands out a token that dies mid-use. 5 minutes is generous
// against an hour-long token lifetime without being so large it refreshes
// needlessly often.
const REFRESH_MARGIN_SECS: u64 = 300;

const KEYRING_SERVICE: &str = "com.brookius.divelog"; // matches tauri.conf.json's identifier
const KEYRING_ACCOUNT: &str = "gdrive_oauth";

// ── Managed state ────────────────────────────────────────────────────────
// Just a lock, not data — guards the read-check-maybe-refresh-write sequence
// in get_valid_access_token so two near-simultaneous callers (e.g. two
// uploads back to back) serialize instead of both refreshing at once and
// racing to write the keychain entry.
#[derive(Default)]
pub struct GDriveState {
    refresh_lock: Mutex<()>,
}

// ── Persisted record ─────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
struct GDriveTokenRecord {
    access_token: String,
    refresh_token: String,
    expires_at: u64, // unix epoch seconds
    scope: String,
}

#[cfg(not(target_os = "android"))]
fn keyring_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
fn load_token_record() -> Result<Option<GDriveTokenRecord>, String> {
    let entry = keyring_entry()?;
    match entry.get_password() {
        Ok(json) => {
            let record = serde_json::from_str(&json)
                .map_err(|e| format!("stored Google Drive token record was not valid JSON: {e}"))?;
            Ok(Some(record))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(target_os = "android"))]
fn save_token_record(record: &GDriveTokenRecord) -> Result<(), String> {
    let entry = keyring_entry()?;
    let json = serde_json::to_string(record).map_err(|e| e.to_string())?;
    entry.set_password(&json).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
fn clear_token_record() -> Result<(), String> {
    let entry = keyring_entry()?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already gone — not an error
        Err(e) => Err(e.to_string()),
    }
}

// ── Android spike stubs (2026-07-30, branch `android-spike`) ───────────────
// keyring's apple-native feature has no Android backend (Cargo.toml gates
// the dependency out entirely for this target) — these match the real
// functions' names/signatures so every caller below needs no changes, and
// each just reports that Drive token persistence isn't available yet. A
// real Android Keystore-backed implementation belongs to plan step 8
// ("Rust platform gating"), not this spike.
#[cfg(target_os = "android")]
fn load_token_record() -> Result<Option<GDriveTokenRecord>, String> {
    Ok(None)
}

#[cfg(target_os = "android")]
fn save_token_record(_record: &GDriveTokenRecord) -> Result<(), String> {
    Err("Google Drive token storage isn't available on Android yet.".to_string())
}

#[cfg(target_os = "android")]
fn clear_token_record() -> Result<(), String> {
    Ok(())
}

fn now_secs() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|e| e.to_string())
}

// Pure so it's unit-testable without a live token or the real keychain.
fn needs_refresh(expires_at: u64, now: u64) -> bool {
    expires_at <= now + REFRESH_MARGIN_SECS
}

// ── PKCE + loopback-listener helpers ─────────────────────────────────────

fn b64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

// 32 random bytes -> 43 base64url chars, within RFC 7636's required
// [A-Za-z0-9-._~] charset (base64url's alphabet is a strict subset) and
// length range (43-128).
fn gen_code_verifier() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    b64url(&bytes)
}

fn code_challenge_s256(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    b64url(&hasher.finalize())
}

fn gen_state() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    b64url(&bytes)
}

// Parses the request line of a raw HTTP request (`GET /?code=...&state=...
// HTTP/1.1`) into query pairs. Routed through url::Url rather than hand-
// rolled percent-decoding, so it isn't a second, worse implementation of
// something the `url` crate already gets right.
fn parse_query(request_line: &str) -> std::collections::HashMap<String, String> {
    let path = request_line.split_whitespace().nth(1).unwrap_or("/");
    let dummy = format!("http://127.0.0.1{path}");
    match url::Url::parse(&dummy) {
        Ok(u) => u.query_pairs().into_owned().collect(),
        Err(_) => Default::default(),
    }
}

const RESPONSE_OK: &str = "<html><body style=\"font-family:sans-serif;padding:40px\">\
    <h2>Shoal</h2><p>Signed in — you can close this tab and return to the app.</p>\
    </body></html>";
const RESPONSE_DENIED: &str = "<html><body style=\"font-family:sans-serif;padding:40px\">\
    <h2>Shoal</h2><p>Sign-in was not completed. You can close this tab.</p>\
    </body></html>";

async fn write_http_response(stream: &mut TcpStream, body: &str) {
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes()).await;
    let _ = stream.flush().await;
}

// Reads until the blank line ending the headers. The redirect is a bare GET
// with no body, so the request line plus headers is always everything.
// Time-bounded: any local process can connect to a 127.0.0.1 listener, and one
// that connects then sends nothing would otherwise hold this open forever.
async fn read_http_request_line(stream: &mut TcpStream) -> Result<String, String> {
    timeout(Duration::from_secs(REDIRECT_READ_TIMEOUT_SECS), async {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 1024];
        loop {
            let n = stream.read(&mut chunk).await.map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
            if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                break;
            }
            if buf.len() > 16 * 1024 {
                break; // sanity cap — a real browser redirect is a few hundred bytes
            }
        }
        let text = String::from_utf8_lossy(&buf);
        Ok(text.lines().next().unwrap_or("").to_string())
    })
    .await
    .map_err(|_| "timed out reading the redirect request".to_string())?
}

// POSTs form-encoded to the token endpoint and returns the raw JSON body
// regardless of status — an error response is itself informative (Google
// returns {"error": "...", "error_description": "..."}), and folding it into
// a generic reqwest error would hide exactly the detail worth surfacing.
async fn post_token_form(
    client: &reqwest::Client,
    form: &[(&str, &str)],
) -> Result<(bool, serde_json::Value), String> {
    let resp = client
        .post(TOKEN_ENDPOINT)
        .form(form)
        .send()
        .await
        .map_err(|e| format!("token endpoint request failed: {e}"))?;
    let ok = resp.status().is_success();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("could not parse token endpoint response: {e}"))?;
    Ok((ok, body))
}

// ── Consent flow ─────────────────────────────────────────────────────────

struct AuthResult {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    scope: String,
}

// The full loopback-listener OAuth dance: PKCE setup, bind a listener, open
// the system browser, wait for the redirect, exchange the code for tokens.
// Shared by gdrive_connect — nothing else needs it, since re-authenticating
// an already-connected account goes through the same path as connecting for
// the first time.
async fn run_consent_flow(app: &tauri::AppHandle) -> Result<AuthResult, String> {
    let client = reqwest::Client::new();

    let verifier = gen_code_verifier();
    let challenge = code_challenge_s256(&verifier);
    let state = gen_state();

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("could not bind loopback listener: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    // access_type=offline + prompt=consent: without both, re-connecting an
    // account that already granted access once can come back with NO
    // refresh_token at all (Google only issues one on the consent grant
    // itself) — forced on every run, not just the first, since a stale or
    // revoked grant needs a fresh one exactly as often as a brand new one.
    let mut auth_url = url::Url::parse(AUTH_ENDPOINT).map_err(|e| e.to_string())?;
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");

    // Shell::open is deprecated in favour of tauri-plugin-opener, which this
    // doesn't pull in — not worth a new plugin + capability entry for one
    // call; worth switching if the app ever adopts that plugin for other
    // reasons.
    #[allow(deprecated)]
    app.shell()
        .open(auth_url.as_str(), None)
        .map_err(|e| format!("could not open system browser: {e}"))?;

    // Accept in a LOOP until a request carrying OUR state arrives, rather than
    // trusting whatever connects first. Two reasons, one benign and one not:
    //
    //  - Browsers routinely open speculative or favicon connections, which
    //    under a single accept() would consume the one shot and abort a
    //    perfectly good sign-in.
    //  - Any same-user local process can connect to a 127.0.0.1 listener at
    //    will, so "first connection wins" hands it a free abort of the flow.
    //
    // This does NOT make the redirect authenticated — it can't be. `state` is
    // recoverable by a same-user process (the auth URL is passed as argv to
    // /usr/bin/open, readable via `ps`), so a determined local attacker can
    // still present a well-formed redirect. That threat is answered where it
    // actually can be — by verifying WHICH ACCOUNT the resulting token belongs
    // to, before anything is persisted (see gdrive_connect).
    let code = timeout(Duration::from_secs(CONSENT_TIMEOUT_SECS), async {
        for _ in 0..MAX_REDIRECT_ATTEMPTS {
            let (mut stream, _addr) = listener
                .accept()
                .await
                .map_err(|e| format!("loopback accept failed: {e}"))?;
            // A connection that opens and says nothing coherent shouldn't kill
            // the flow — drop it and keep waiting for the real redirect.
            let Ok(request_line) = read_http_request_line(&mut stream).await else {
                continue;
            };
            let params = parse_query(&request_line);
            if params.get("state").map(String::as_str) != Some(state.as_str()) {
                write_http_response(&mut stream, RESPONSE_DENIED).await;
                continue;
            }
            // Matching state — this is the redirect we're waiting for, whether
            // it granted or denied.
            if let Some(code) = params.get("code").cloned() {
                write_http_response(&mut stream, RESPONSE_OK).await;
                return Ok(code);
            }
            write_http_response(&mut stream, RESPONSE_DENIED).await;
            let err = params
                .get("error")
                .cloned()
                .unwrap_or_else(|| "no code and no error in redirect — unexpected shape".into());
            return Err(format!("Authorization not granted: {err}"));
        }
        Err("Too many connections to the sign-in listener without a valid redirect.".to_string())
    })
    .await
    .map_err(|_| {
        "Timed out waiting for the browser redirect — was consent completed within \
         3 minutes?"
            .to_string()
    })??;

    let (ok, body) = post_token_form(
        &client,
        &[
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("code", &code),
            ("code_verifier", &verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", &redirect_uri),
        ],
    )
    .await?;
    parse_token_response(ok, &body)
}

// Shared by both consent flows — the token endpoint's response shape doesn't
// depend on how the code was obtained, only the redirect mechanism differs.
fn parse_token_response(ok: bool, body: &serde_json::Value) -> Result<AuthResult, String> {
    if !ok {
        return Err(format!("Token exchange rejected: {body}"));
    }
    let access_token = body["access_token"]
        .as_str()
        .ok_or("token response had no access_token")?
        .to_string();
    let refresh_token = body["refresh_token"]
        .as_str()
        .ok_or(
            "Google did not return a refresh_token — access_type=offline + prompt=consent \
             should force one; try connecting again",
        )?
        .to_string();
    let expires_in = body["expires_in"].as_u64().unwrap_or(3600);
    let scope = body["scope"].as_str().unwrap_or(SCOPE).to_string();

    Ok(AuthResult {
        access_token,
        refresh_token,
        expires_in,
        scope,
    })
}

// ── Android consent flow (deep-link redirect, plan step 9 §2.9) ────────────
// The desktop loopback listener above has no Android equivalent — mobile
// OSes don't hand an app a 127.0.0.1 redirect the way a desktop browser
// does. tauri-plugin-deep-link's custom-scheme redirect replaces it; PKCE
// generation and the token-exchange response shape are identical, only "how
// do we get the code back" differs.
//
// NOT verified end-to-end, and can't be yet. Testing needs a real Android-
// TYPE OAuth client — separate from CLIENT_ID above, which is Desktop-type
// and doesn't accept this redirect_uri at all — and per
// BRIEF-footage-cloud-hosting.md, "the Android OAuth client is keyed on
// package name + the Play app signing SHA-1, not the local upload key,"
// which only exists once a Play Console app has received an AAB (plan step
// 3). ANDROID_CLIENT_ID below is a placeholder for exactly that reason.
// What IS independently verified: the deep-link redirect mechanism itself —
// simulating a redirect via `adb shell am start -a android.intent.action.VIEW
// -d "shoal-oauth://callback?code=...&state=..."` correctly reaches this
// listener, proven without needing Google's servers at all (see the brief).
//
// Android/public clients use PKCE instead of a client_secret (there is no
// secret to embed — a public client can't keep one), so the token exchange
// below omits `client_secret` entirely rather than reusing CLIENT_SECRET.
#[cfg(target_os = "android")]
const ANDROID_CLIENT_ID: &str = "REPLACE-ME.apps.googleusercontent.com";
#[cfg(target_os = "android")]
const ANDROID_REDIRECT_URI: &str = "shoal-oauth://callback";

#[cfg(target_os = "android")]
async fn run_consent_flow_android(app: &tauri::AppHandle) -> Result<AuthResult, String> {
    use tauri_plugin_deep_link::DeepLinkExt;

    let client = reqwest::Client::new();
    let verifier = gen_code_verifier();
    let challenge = code_challenge_s256(&verifier);
    let state = gen_state();

    let mut auth_url = url::Url::parse(AUTH_ENDPOINT).map_err(|e| e.to_string())?;
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", ANDROID_CLIENT_ID)
        .append_pair("redirect_uri", ANDROID_REDIRECT_URI)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");

    // on_open_url's callback is Fn, not FnOnce — it fires for every future
    // deep link the OS ever routes here, not just this one wait. The
    // Mutex<Option<Sender>> lets the FIRST matching redirect resolve the
    // wait and every later invocation (a stray relaunch, a second tap) find
    // the slot already empty and safely no-op instead of double-sending.
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let tx = std::sync::Mutex::new(Some(tx));
    let expected_state = state.clone();
    let event_id = app.deep_link().on_open_url(move |event| {
        let Some(url) = event.urls().into_iter().next() else { return };
        let params: std::collections::HashMap<String, String> =
            url.query_pairs().into_owned().collect();
        // Same reasoning as the desktop listener's state check: only OUR
        // redirect should resolve this wait, not an unrelated deep link that
        // happens to reuse this app's scheme.
        if params.get("state").map(String::as_str) != Some(expected_state.as_str()) {
            return;
        }
        let result = params.get("code").cloned().ok_or_else(|| {
            format!(
                "Authorization not granted: {}",
                params
                    .get("error")
                    .cloned()
                    .unwrap_or_else(|| "no code and no error in redirect — unexpected shape".into())
            )
        });
        if let Some(tx) = tx.lock().unwrap().take() {
            let _ = tx.send(result);
        }
    });

    #[allow(deprecated)]
    app.shell()
        .open(auth_url.as_str(), None)
        .map_err(|e| format!("could not open system browser: {e}"))?;

    let code_result = timeout(Duration::from_secs(CONSENT_TIMEOUT_SECS), rx).await;
    {
        use tauri::Listener;
        app.unlisten(event_id);
    }
    let code = code_result
        .map_err(|_| {
            "Timed out waiting for the browser redirect — was consent completed within \
             3 minutes?"
                .to_string()
        })?
        .map_err(|_| "Redirect listener closed unexpectedly".to_string())??;

    let (ok, body) = post_token_form(
        &client,
        &[
            ("client_id", ANDROID_CLIENT_ID),
            ("code", &code),
            ("code_verifier", &verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", ANDROID_REDIRECT_URI),
        ],
    )
    .await?;
    parse_token_response(ok, &body)
}

// Which Google account does this token actually belong to? MANDATORY, not
// best-effort — it is the only real defence against a hijacked redirect (see
// run_consent_flow), so a failure to determine it has to fail the connect
// rather than quietly resolve to "unknown account".
async fn fetch_account_email(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<String, String> {
    let resp = client
        .get(format!("{DRIVE_ABOUT}?fields=user"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("could not confirm which Google account this is: {e}"))?;
    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("could not parse the Drive account response: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "could not confirm which Google account this is: HTTP {status} — {body}"
        ));
    }
    body["user"]["emailAddress"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| {
            "Drive did not report an account email, so the connected account could not be \
             verified — not saving these credentials."
                .to_string()
        })
}

// Best-effort server-side revoke. Used both on explicit disconnect and to
// clean up a grant we've decided not to keep (wrong account, or the user
// declined at the confirmation step) — leaving a live grant behind for
// credentials we're discarding would be worse than the failed connect.
// Drive JSON helpers. Both surface the API's own error body rather than
// collapsing it into a generic failure — Drive's messages are specific
// (SERVICE_DISABLED, insufficient scopes, 404-for-no-access) and that detail
// is exactly what a scope probe is trying to read.
async fn drive_get_json(
    client: &reqwest::Client,
    url: &str,
    access_token: &str,
) -> Result<serde_json::Value, String> {
    let resp = client
        .get(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Drive request to {url} failed: {e}"))?;
    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("could not parse Drive response from {url}: {e}"))?;
    if !status.is_success() {
        return Err(format!("Drive API rejected {url}: HTTP {status} — {body}"));
    }
    Ok(body)
}

async fn drive_post_json(
    client: &reqwest::Client,
    url: &str,
    access_token: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let resp = client
        .post(url)
        .bearer_auth(access_token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Drive request to {url} failed: {e}"))?;
    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("could not parse Drive response from {url}: {e}"))?;
    if !status.is_success() {
        return Err(format!("Drive API rejected {url}: HTTP {status} — {body}"));
    }
    Ok(body)
}

async fn revoke_token(client: &reqwest::Client, token: &str) {
    let _ = client
        .post(REVOKE_ENDPOINT)
        .form(&[("token", token)])
        .send()
        .await;
}

// A NATIVE confirmation dialog — deliberately not a webview one. Same trust
// anchor the filesystem commands already rely on (lib.rs: an XSS can open a
// native picker but cannot confirm it on the user's behalf). Both callers here
// guard something the webview must not be able to do unilaterally: adopting a
// set of Google credentials, and throwing an existing grant away.
async fn confirm_native(
    app: &tauri::AppHandle,
    title: &str,
    message: String,
    ok_label: &str,
) -> Result<bool, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            ok_label.to_string(),
            "Cancel".to_string(),
        ))
        .show(move |answer| {
            let _ = tx.send(answer);
        });
    rx.await.map_err(|e| e.to_string())
}

// ── Commands ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct GDriveConnectResult {
    connected: bool,
    // Not Option any more: a connect that can't name the account it connected
    // is exactly the case that must fail, so by the time this is built the
    // email is known and confirmed.
    account_email: String,
}

#[tauri::command]
pub async fn gdrive_connect(app: tauri::AppHandle) -> Result<GDriveConnectResult, String> {
    // Only the "how do we get an auth code back" step differs by platform —
    // everything below (verify-before-persist, email fetch, revoke-on-
    // failure) is shared and platform-agnostic.
    #[cfg(target_os = "android")]
    let auth = run_consent_flow_android(&app).await?;
    #[cfg(not(target_os = "android"))]
    let auth = run_consent_flow(&app).await?;
    let client = reqwest::Client::new();

    // VERIFY BEFORE PERSISTING. The redirect that produced these tokens cannot
    // be authenticated (run_consent_flow explains why), so the account they
    // belong to is checked here, and the user confirms it natively, before
    // anything reaches the keychain. Without this, a hijacked redirect would
    // silently bind Shoal to someone else's Drive and every later upload would
    // go there — the tokens would be perfectly valid, just not the user's.
    //
    // Anything we decline gets revoked rather than merely dropped: these are
    // live credentials until Google is told otherwise.
    let email = match fetch_account_email(&client, &auth.access_token).await {
        Ok(email) => email,
        Err(e) => {
            revoke_token(&client, &auth.refresh_token).await;
            return Err(e);
        }
    };

    let confirmed = confirm_native(
        &app,
        "Connect Google Drive",
        format!(
            "Connect Shoal to this Google account?\n\n{email}\n\nShoal will only be able to \
             see and manage the files it creates in this Drive — not the rest of your files.\n\n\
             If this isn't the account you signed in with, cancel."
        ),
        "Connect",
    )
    .await?;
    if !confirmed {
        revoke_token(&client, &auth.refresh_token).await;
        return Err(format!("Cancelled — not connected to {email}."));
    }

    let now = now_secs()?;
    let record = GDriveTokenRecord {
        access_token: auth.access_token,
        refresh_token: auth.refresh_token,
        expires_at: now + auth.expires_in,
        scope: auth.scope,
    };
    // Lock only around the write, not the whole flow — the consent dance can
    // sit on a browser tab for minutes, and blocking every token read behind a
    // dialog nobody has clicked yet would be worse than the narrow race this
    // guards (a refresh landing between our check and our write).
    {
        let state = app.state::<GDriveState>();
        let _guard = state.refresh_lock.lock().await;
        save_token_record(&record)?;
    }

    Ok(GDriveConnectResult {
        connected: true,
        account_email: email,
    })
}

#[derive(Serialize)]
pub struct GDriveStatus {
    connected: bool,
}

// Cheap and local — existence check only, no network call. A stored record
// that turns out to be stale (revoked externally) is discovered on next real
// use, via get_valid_access_token, not here.
#[tauri::command]
pub fn gdrive_status() -> Result<GDriveStatus, String> {
    Ok(GDriveStatus {
        connected: load_token_record()?.is_some(),
    })
}

#[tauri::command]
pub async fn gdrive_disconnect(app: tauri::AppHandle) -> Result<(), String> {
    let Some(record) = load_token_record()? else {
        return Ok(()); // already disconnected — nothing to confirm or revoke
    };

    // Native confirm, because this command is callable by ANY script in the
    // webview and the effect is irreversible from the app's side: it revokes
    // the grant server-side, so an XSS in imported dive data could otherwise
    // silently kill cloud sync and force a full re-consent. Same reasoning
    // that put a native picker in front of the filesystem commands.
    let confirmed = confirm_native(
        &app,
        "Disconnect Google Drive",
        "Disconnect Shoal from Google Drive?\n\nUploads will stop, and you'll need to sign in \
         again to reconnect. Files already in your Drive are not deleted."
            .to_string(),
        "Disconnect",
    )
    .await?;
    if !confirmed {
        return Err("Cancelled — still connected to Google Drive.".into());
    }

    let state = app.state::<GDriveState>();
    let _guard = state.refresh_lock.lock().await;
    // Revoke first so the grant actually dies rather than just being forgotten
    // locally — but a failure here must not block clearing the local record,
    // since an unreachable network is no reason to leave a dead entry behind.
    let client = reqwest::Client::new();
    revoke_token(&client, &record.refresh_token).await;
    clear_token_record()
}

// Not a command — the thing every Drive-calling command calls internally to
// get a token guaranteed fresh for the next few minutes at least, refreshing
// first if needed. First real caller is gdrive_scope_probe below, which is
// also therefore the first live exercise of the refresh path.
async fn get_valid_access_token(app: &tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<GDriveState>();
    let _guard = state.refresh_lock.lock().await;

    let Some(record) = load_token_record()? else {
        return Err("Google Drive is not connected — connect it in Settings first.".into());
    };

    let now = now_secs()?;
    if !needs_refresh(record.expires_at, now) {
        return Ok(record.access_token);
    }

    let client = reqwest::Client::new();
    let (ok, body) = post_token_form(
        &client,
        &[
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("refresh_token", &record.refresh_token),
            ("grant_type", "refresh_token"),
        ],
    )
    .await?;

    if !ok {
        // A dead refresh token (revoked externally, or Google's own
        // 6-months-unused invalidation) isn't retry-able — clear it so the
        // caller can offer "reconnect" instead of a generic, unactionable
        // error. Same shape as folder sync's permission-lapse -> Reconnect
        // pattern (js/app.js, _isFolderPermissionError/_folderNeedsReconnect)
        // — a lost grant gets a path back, not a dead end.
        let _ = clear_token_record();
        return Err(format!("Google Drive access needs to be reconnected: {body}"));
    }

    let access_token = body["access_token"]
        .as_str()
        .ok_or("refresh response had no access_token")?
        .to_string();
    let expires_in = body["expires_in"].as_u64().unwrap_or(3600);
    // Google doesn't always rotate the refresh token on a refresh call —
    // keep the existing one unless a new one is actually issued.
    let refresh_token = body["refresh_token"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| record.refresh_token.clone());

    let new_record = GDriveTokenRecord {
        access_token: access_token.clone(),
        refresh_token,
        expires_at: now + expires_in,
        scope: record.scope.clone(),
    };
    save_token_record(&new_record)?;

    Ok(access_token)
}

// ── Scope spike (temporary — delete once the question below is answered) ──
//
// THE QUESTION: `drive.file` grants access to files the app CREATED, plus
// files/folders the user explicitly picked via the Google Picker. Shoal's
// actual footage is neither — it was uploaded to Drive independently, long
// before the app existed. So: when access to a FOLDER is granted, does that
// cascade to the files INSIDE it, or is it strictly per-resource?
//
// Google's own docs are silent on exactly this (checked the scope guide, the
// Picker guide, and community threads — all ambiguous on folder-vs-contents),
// which is the same shape as the client_secret finding: undocumented, load-
// bearing, and cheap to answer empirically. The answer decides the whole
// architecture:
//
//   CASCADES  → one Picker selection per trip folder. Design proceeds as
//               planned, drive.file stays, no review tier change.
//   DOESN'T   → the alternatives are all bad: per-file picking (hundreds of
//               videos by hand), or drive.readonly — a RESTRICTED scope
//               needing a paid CASA audit AND granting the app the user's
//               entire Drive, which is exactly what drive.file was chosen
//               to avoid (BRIEF-footage-cloud-hosting.md §4.2).
//
// WHY THIS TEST DOESN'T NEED THE PICKER: the Picker is a JS widget and would
// need real CSP relaxation (script-src/frame-src for apis.google.com) just to
// try. Instead this probes the same underlying semantics using a folder the
// app CREATED — also an access-granted folder — and asks whether a file the
// app did NOT create, dropped into it by hand, becomes visible. If access
// doesn't cascade for an app-created folder, there's little reason to expect
// Picker-granted folder access to behave more generously, and that negative
// is decisive enough to act on without touching CSP. A positive is strongly
// suggestive but would warrant confirming through the real Picker before
// committing to it.

#[derive(Serialize)]
pub struct ScopeSetupResult {
    folder_id: String,
    folder_link: Option<String>,
    next_step: String,
}

// Step 1: create a folder the app owns, and put one app-created file in it,
// so the "can we see our own stuff" baseline is established in the same place
// the manual-add test will happen.
#[tauri::command]
pub async fn gdrive_scope_setup(app: tauri::AppHandle) -> Result<ScopeSetupResult, String> {
    let token = get_valid_access_token(&app).await?;
    let client = reqwest::Client::new();

    let folder = drive_post_json(
        &client,
        &format!("{DRIVE_FILES}?fields=id,webViewLink"),
        &token,
        serde_json::json!({
            "name": "Shoal scope test",
            "mimeType": "application/vnd.google-apps.folder",
        }),
    )
    .await?;
    let folder_id = folder["id"]
        .as_str()
        .ok_or("folder response had no id")?
        .to_string();
    let folder_link = folder["webViewLink"].as_str().map(str::to_string);

    // An app-created file inside it — the control. If this ISN'T visible in
    // the probe, something more basic is broken than the question being asked.
    let metadata = serde_json::json!({
        "name": "app-created-control.txt",
        "parents": [folder_id.clone()],
    });
    let boundary = "shoal-scope-boundary";
    let body = format!(
        "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n\
         --{boundary}\r\nContent-Type: text/plain\r\n\r\nCreated by Shoal via the API — the control file.\r\n\
         --{boundary}--"
    );
    let resp = client
        .post(format!("{DRIVE_UPLOAD}?uploadType=multipart&fields=id"))
        .bearer_auth(&token)
        .header(
            "Content-Type",
            format!("multipart/related; boundary={boundary}"),
        )
        .body(body)
        .send()
        .await
        .map_err(|e| format!("control-file upload failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("control-file upload rejected: HTTP {status} — {text}"));
    }

    Ok(ScopeSetupResult {
        folder_id: folder_id.clone(),
        folder_link,
        next_step: format!(
            "Open the folder link in Drive and drag ANY file into it by hand (a photo, \
             a text file — anything Shoal did not create). Then run: \
             await window.__TAURI__.core.invoke('gdrive_scope_probe', {{ folderId: '{folder_id}' }})"
        ),
    })
}

#[derive(Serialize)]
pub struct ScopeProbeResult {
    /// Everything the app can see across the whole Drive, under drive.file.
    visible_everywhere: Vec<String>,
    /// Children of the probed folder that the app can actually see.
    folder_children: Vec<String>,
    folder_accessible: bool,
    /// The finding, stated in plain language rather than left to inference.
    verdict: String,
    notes: Vec<String>,
}

// Step 2: after a file has been added to that folder by hand, ask Drive what
// the app can actually see.
#[tauri::command]
pub async fn gdrive_scope_probe(
    app: tauri::AppHandle,
    folder_id: String,
) -> Result<ScopeProbeResult, String> {
    let token = get_valid_access_token(&app).await?;
    let client = reqwest::Client::new();
    let mut notes = Vec::new();

    // Baseline: what does drive.file expose across the entire account? Under
    // per-file semantics this should be ONLY app-created/app-picked items —
    // never the user's wider Drive.
    let all = drive_get_json(
        &client,
        &format!("{DRIVE_FILES}?fields=files(id,name,mimeType)&pageSize=100"),
        &token,
    )
    .await?;
    let visible_everywhere: Vec<String> = all["files"]
        .as_array()
        .map(|files| {
            files
                .iter()
                .map(|f| {
                    format!(
                        "{} [{}]",
                        f["name"].as_str().unwrap_or("?"),
                        f["mimeType"].as_str().unwrap_or("?")
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    notes.push(format!(
        "drive.file can see {} item(s) across the whole account.",
        visible_everywhere.len()
    ));

    // Is the folder itself still reachable?
    let folder_accessible = drive_get_json(
        &client,
        &format!("{DRIVE_FILES}/{folder_id}?fields=id,name"),
        &token,
    )
    .await
    .is_ok();
    if !folder_accessible {
        notes.push(
            "The probed folder itself is NOT accessible — check the folder id, or re-run \
             gdrive_scope_setup."
                .into(),
        );
    }

    // The actual question: children of that folder, as Drive reports them TO
    // THIS APP. Anything the app can't see simply won't come back.
    let children = drive_get_json(
        &client,
        &format!(
            "{DRIVE_FILES}?q='{folder_id}'+in+parents+and+trashed%3Dfalse\
             &fields=files(id,name,mimeType)&pageSize=100"
        ),
        &token,
    )
    .await?;
    let folder_children: Vec<String> = children["files"]
        .as_array()
        .map(|files| {
            files
                .iter()
                .map(|f| {
                    format!(
                        "{} [{}]",
                        f["name"].as_str().unwrap_or("?"),
                        f["mimeType"].as_str().unwrap_or("?")
                    )
                })
                .collect()
        })
        .unwrap_or_default();

    // Interpret it here rather than leaving the reader to infer — the control
    // file is what distinguishes "cascades" from "the call simply failed".
    let saw_control = folder_children
        .iter()
        .any(|c| c.starts_with("app-created-control.txt"));
    let non_control: Vec<&String> = folder_children
        .iter()
        .filter(|c| !c.starts_with("app-created-control.txt"))
        .collect();

    let verdict = if !saw_control {
        "INCONCLUSIVE — the app-created control file wasn't visible either, so this isn't \
         measuring folder-access semantics. Re-run gdrive_scope_setup and probe the folder \
         id it returns."
            .to_string()
    } else if non_control.is_empty() {
        "ACCESS DOES NOT CASCADE (or no manual file was added yet). The app-created control \
         file is visible but nothing else in the folder is. If a file WAS added by hand, this \
         is the bad outcome: drive.file is strictly per-resource, so granting a folder does \
         not grant its existing contents — Picker-per-folder will not reach pre-existing \
         footage, and drive.readonly (Restricted scope, CASA audit, whole-Drive access) \
         becomes the only route."
            .to_string()
    } else {
        format!(
            "ACCESS CASCADES. {} non-app-created file(s) inside the folder are visible to the \
             app, so folder-level access does reach contents the app did not create. This is \
             the good outcome — one Picker selection per trip folder should be enough, and \
             drive.file can stay. Worth confirming through the real Picker before committing, \
             since this tested an app-created folder rather than a Picker-granted one.",
            non_control.len()
        )
    };

    Ok(ScopeProbeResult {
        visible_everywhere,
        folder_children,
        folder_accessible,
        verdict,
        notes,
    })
}

#[cfg(test)]
mod pkce_tests {
    use super::*;

    // RFC 7636 Appendix B's own worked example — a fixed verifier with a
    // known-correct S256 challenge. This is what actually proves
    // code_challenge_s256 is RFC-correct, independent of any live network call.
    #[test]
    fn code_challenge_matches_rfc7636_appendix_b_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = code_challenge_s256(verifier);
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn generated_verifier_is_43_chars_in_the_pkce_charset() {
        let v = gen_code_verifier();
        assert_eq!(v.len(), 43, "32 random bytes should base64url-encode to 43 chars");
        assert!(
            v.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
            "verifier must stay within RFC 7636's allowed charset, got {v}"
        );
    }

    #[test]
    fn two_verifiers_are_not_the_same() {
        // Not a real randomness test, just a guard against an accidentally
        // deterministic RNG call.
        assert_ne!(gen_code_verifier(), gen_code_verifier());
    }

    #[test]
    fn parses_code_and_state_from_a_real_redirect_request_line() {
        // Google's auth codes contain '/', which the browser percent-encodes
        // (%2F) when building the redirect query string — the case worth
        // checking is that decoding, not just splitting on '&', is correct.
        let line = "GET /?state=abc123&code=4%2F0AVGzR1-XYZ HTTP/1.1";
        let params = parse_query(line);
        assert_eq!(params.get("state").map(String::as_str), Some("abc123"));
        assert_eq!(
            params.get("code").map(String::as_str),
            Some("4/0AVGzR1-XYZ")
        );
    }

    #[test]
    fn parses_a_denied_redirect() {
        let line = "GET /?error=access_denied&state=abc123 HTTP/1.1";
        let params = parse_query(line);
        assert_eq!(params.get("error").map(String::as_str), Some("access_denied"));
        assert!(params.get("code").is_none());
    }
}

#[cfg(test)]
mod token_tests {
    use super::*;

    // Deliberately not testing load/save/clear_token_record here — those
    // hit the REAL macOS Keychain, and a test suite writing real entries
    // into a developer's actual keychain on every `cargo test` run is worse
    // than not testing it; that's exercised through the app itself instead.

    #[test]
    fn plenty_of_time_left_does_not_need_refresh() {
        let now = 1_000_000;
        assert!(!needs_refresh(now + 3600, now)); // an hour left
    }

    #[test]
    fn inside_the_safety_margin_needs_refresh() {
        let now = 1_000_000;
        assert!(needs_refresh(now + 60, now)); // 1 minute left, margin is 5
    }

    #[test]
    fn already_expired_needs_refresh() {
        let now = 1_000_000;
        assert!(needs_refresh(now - 10, now));
    }

    #[test]
    fn exactly_at_the_margin_boundary_needs_refresh() {
        let now = 1_000_000;
        assert!(needs_refresh(now + REFRESH_MARGIN_SECS, now));
    }
}
