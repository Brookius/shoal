// Native BLE transport for dive-computer sync (BRIEF-dive-computer-sync.md
// §21). WKWebView has no `navigator.bluetooth`, so the shell cannot run
// js/computer-sync.js's Web Bluetooth path at all — this module is the
// like-for-like native replacement for that transport, and ONLY that.
//
// Transport only, exactly as in the browser: every byte that arrives here
// is handed to the libdivecomputer WASM module on the JS side untouched,
// and the protocol engine stays where it already is. That split is what
// keeps this file small — and it's why the shell needed no native
// libdivecomputer build (the fallback BRIEF §7b had scoped, which would
// also have needed a dedicated OS thread to run blocking C callbacks over
// an async BLE stack). Here the Rust side is purely async byte-pumping and
// the blocking is Asyncify's problem, inside WASM, on the JS side.
//
// CRITICAL FRAMING RULE — the same one stated at the top of
// js/computer-sync.js, and the reason this is a Channel rather than a
// stream of bytes: Shearwater/Suunto responses are packetized, and
// notification boundaries ARE protocol framing. One GATT notification must
// arrive at the WASM read callback as exactly one packet. Never coalesce,
// never split, never reorder. tauri::ipc::Channel is chosen precisely
// because it preserves message boundaries and ordering; app.emit() events
// would have been the more obvious reach and are the wrong tool here.

use std::collections::HashMap;

#[cfg(not(target_os = "android"))]
use btleplug::api::{
    Central, CharPropFlags, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType,
};
#[cfg(not(target_os = "android"))]
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures::StreamExt;
use serde::Serialize;
use tauri::ipc::Channel;
use tokio::sync::Mutex;
use uuid::Uuid;

// ── Types crossing the IPC boundary ──────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct BleDevice {
    /// Opaque handle — the key into `BleState::discovered`. Deliberately not
    /// a MAC address: CoreBluetooth never exposes one (it hands out per-host
    /// UUIDs instead), so anything MAC-shaped here would be a lie on macOS
    /// and iOS both.
    id: String,
    name: String,
    /// Which of the caller's requested service UUIDs this device advertised —
    /// the JS side maps it straight back to a vendor/product pair, so the
    /// service list stays defined in exactly one place (js/computer-sync.js's
    /// BLE_SERVICES) rather than being duplicated here in Rust.
    service: String,
}

#[derive(Serialize, Clone)]
pub struct BleConnection {
    name: String,
    service: String,
}

/// What the notification pump sends to JS. `Closed` is not an error channel —
/// it is the transport's end-of-stream, and the JS packet queue treats it the
/// same way the browser path treats `gattserverdisconnected`: fail pending
/// reads so the C engine takes its own timeout path rather than hanging.
#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BlePacket {
    Data { data: Vec<u8> },
    Closed { reason: String },
}

// ── Managed state ────────────────────────────────────────────────────────────

#[cfg(not(target_os = "android"))]
struct Session {
    peripheral: Peripheral,
    rx: Characteristic,
    tx: Characteristic,
    write_type: WriteType,
}

#[cfg(not(target_os = "android"))]
#[derive(Default)]
pub struct BleState {
    /// Populated by `ble_scan`, consumed by `ble_connect`. Holding the live
    /// `Peripheral` objects avoids round-tripping a `PeripheralId` through a
    /// string and back, which btleplug gives no supported way to reverse.
    discovered: Mutex<HashMap<String, (Peripheral, String)>>,
    session: Mutex<Option<Session>>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

#[cfg(not(target_os = "android"))]
async fn adapter() -> Result<Adapter, String> {
    let manager = Manager::new().await.map_err(|e| e.to_string())?;
    let adapters = manager.adapters().await.map_err(|e| e.to_string())?;
    adapters.into_iter().next().ok_or_else(|| {
        "No Bluetooth adapter found. Check Bluetooth is turned on for this Mac.".to_string()
    })
}

// Both platforms need this identically — no btleplug/blec types involved.
fn parse_uuids(services: &[String]) -> Result<Vec<Uuid>, String> {
    services
        .iter()
        .map(|s| Uuid::parse_str(s).map_err(|e| format!("bad service UUID {s}: {e}")))
        .collect()
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Scan for dive computers advertising any of `services`.
///
/// Filtering on advertised service UUIDs mirrors what the browser path's
/// `navigator.bluetooth.requestDevice({ filters: [{ services }] })` already
/// does, so the same hardware is discoverable by the same rule under both
/// transports. Devices that don't advertise their service are invisible to
/// both, equally — not a native-only limitation.
///
/// There is no OS-supplied chooser dialog here the way Web Bluetooth has one,
/// so this returns the list and the JS side decides (auto-pick when exactly
/// one, prompt when several).
#[tauri::command]
#[cfg(not(target_os = "android"))]
pub async fn ble_scan(
    state: tauri::State<'_, BleState>,
    services: Vec<String>,
    timeout_ms: u64,
) -> Result<Vec<BleDevice>, String> {
    let uuids = parse_uuids(&services)?;
    let central = adapter().await?;

    central
        .start_scan(ScanFilter { services: uuids.clone() })
        .await
        .map_err(|e| format!("Could not start Bluetooth scan: {e}"))?;
    tokio::time::sleep(std::time::Duration::from_millis(timeout_ms)).await;
    let found = central.peripherals().await.map_err(|e| e.to_string())?;
    let _ = central.stop_scan().await;

    let mut out = Vec::new();
    let mut discovered = state.discovered.lock().await;
    discovered.clear();

    for p in found {
        let Ok(Some(props)) = p.properties().await else { continue };
        // Re-check the service list ourselves. ScanFilter is a hint the OS
        // may apply loosely (and CoreBluetooth will hand back peripherals it
        // already knows about from other apps' scans), so without this a
        // pair of AirPods can land in a dive-computer picker.
        let Some(matched) = uuids.iter().find(|u| props.services.contains(u)) else { continue };

        let id = p.id().to_string();
        let name = props.local_name.unwrap_or_else(|| "Dive computer".to_string());
        let service = matched.to_string();
        discovered.insert(id.clone(), (p, service.clone()));
        out.push(BleDevice { id, name, service });
    }

    Ok(out)
}

/// Connect to a scanned device, subscribe to its notify characteristic, and
/// start pumping packets into `on_packet`. Returns once the transport is live
/// — the pump itself outlives this call and runs until disconnect.
#[tauri::command]
#[cfg(not(target_os = "android"))]
pub async fn ble_connect(
    state: tauri::State<'_, BleState>,
    id: String,
    on_packet: Channel<BlePacket>,
) -> Result<BleConnection, String> {
    let (peripheral, service) = {
        let discovered = state.discovered.lock().await;
        discovered
            .get(&id)
            .cloned()
            .ok_or("That dive computer is no longer in range — scan again.")?
    };

    peripheral
        .connect()
        .await
        .map_err(|e| format!("Could not connect: {e}"))?;
    peripheral
        .discover_services()
        .await
        .map_err(|e| format!("Could not read the device's services: {e}"))?;

    // Pick RX/TX by GATT property flags, not by hardcoded characteristic
    // UUIDs — same rule (and same reasoning) as _discoverCharacteristics()
    // in js/computer-sync.js: Subsurface's own qt-ble.cpp hardcodes no
    // Shearwater/Suunto characteristic UUIDs either.
    let service_uuid = Uuid::parse_str(&service).map_err(|e| e.to_string())?;
    let chars: Vec<Characteristic> = peripheral
        .characteristics()
        .into_iter()
        .filter(|c| c.service_uuid == service_uuid)
        .collect();

    let rx = chars
        .iter()
        .find(|c| c.properties.contains(CharPropFlags::NOTIFY))
        .cloned()
        .ok_or("This device's service has no notify characteristic")?;
    let tx = chars
        .iter()
        .find(|c| {
            c.properties.contains(CharPropFlags::WRITE)
                || c.properties.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE)
        })
        .cloned()
        .ok_or("This device's service has no write characteristic")?;

    let write_type = if tx.properties.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE) {
        WriteType::WithoutResponse
    } else {
        WriteType::WithResponse
    };

    let mut notifications = peripheral
        .notifications()
        .await
        .map_err(|e| format!("Could not open the notification stream: {e}"))?;
    peripheral
        .subscribe(&rx)
        .await
        .map_err(|e| format!("Could not subscribe to notifications: {e}"))?;

    let name = peripheral
        .properties()
        .await
        .ok()
        .flatten()
        .and_then(|p| p.local_name)
        .unwrap_or_else(|| "Dive computer".to_string());

    // The pump. One notification in, one Channel message out — never batched.
    let rx_uuid = rx.uuid;
    let pump_peripheral = peripheral.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(n) = notifications.next().await {
            if n.uuid != rx_uuid {
                continue;
            }
            if on_packet.send(BlePacket::Data { data: n.value }).is_err() {
                // The JS end went away (page navigated, sync torn down).
                // Nothing left to deliver to, so stop reading the device.
                break;
            }
        }
        // Stream ended: the device dropped the link, or we disconnected it
        // ourselves from ble_disconnect. Either way the JS queue needs to
        // know, or a pending read waits out its full timeout for nothing.
        let _ = on_packet.send(BlePacket::Closed {
            reason: "notification stream ended".into(),
        });
        let _ = pump_peripheral.disconnect().await;
    });

    *state.session.lock().await = Some(Session { peripheral, rx, tx, write_type });
    Ok(BleConnection { name, service })
}

/// Write one packet to the device's TX characteristic.
///
/// Errors are returned rather than swallowed, but note how the JS caller
/// treats them: a write that fails because a cancel just tore the link down
/// must NOT propagate as a hard sync failure, because that path discards
/// dives already downloaded. See the `write` wrapper in js/computer-sync.js.
#[tauri::command]
#[cfg(not(target_os = "android"))]
pub async fn ble_write(state: tauri::State<'_, BleState>, data: Vec<u8>) -> Result<(), String> {
    let guard = state.session.lock().await;
    let session = guard.as_ref().ok_or("Not connected to a dive computer")?;
    session
        .peripheral
        .write(&session.tx, &data, session.write_type)
        .await
        .map_err(|e| e.to_string())
}

/// Tear the connection down. Safe to call when nothing is connected — Cancel
/// and the normal end-of-sync cleanup both route here, and the browser path's
/// equivalent (`device.gatt.disconnect()`) is likewise a no-op when idle.
#[tauri::command]
#[cfg(not(target_os = "android"))]
pub async fn ble_disconnect(state: tauri::State<'_, BleState>) -> Result<(), String> {
    if let Some(session) = state.session.lock().await.take() {
        // Unsubscribe before disconnecting so the pump's notification stream
        // ends cleanly and sends its Closed marker, rather than the link
        // vanishing underneath it. Both are best-effort: a device that has
        // already walked out of range fails both, and that's still a
        // successful disconnect from the app's point of view.
        let _ = session.peripheral.unsubscribe(&session.rx).await;
        let _ = session.peripheral.disconnect().await;
    }
    Ok(())
}

/// Whether this build can do native BLE at all. The JS capability gate calls
/// it instead of assuming `isShell()` implies Bluetooth — a Mac with
/// Bluetooth switched off, or a build on a platform btleplug doesn't cover,
/// should hide the Sync button rather than offer it and fail on tap.
#[tauri::command]
#[cfg(not(target_os = "android"))]
pub async fn ble_available() -> bool {
    adapter().await.is_ok()
}

// ── Android implementation (plan step 9, BRIEF-play-store-readiness.md §2.8) ──
// Real BLE via tauri-plugin-blec, chosen specifically to avoid btleplug's own
// Android backend (droidplug), which needs a hybrid Rust/Java/JNI build this
// project has no reason to take on when a properly Tauri-wired alternative
// exists — the same call already made for folder access (tauri-plugin-android-fs
// over hand-rolled SAF/JNI). Rust-internal only: js/computer-sync.js keeps
// calling these same five command names and is completely unaware this crate
// exists. `tauri_plugin_blec::get_handler()` returns a `&'static Handler` —
// the plugin manages the single active connection as its own global, not
// something threaded through Tauri's managed state — so `BleState` here only
// needs to remember which characteristic/write-type `ble_write`/
// `ble_disconnect` should use, mirroring the macOS `Session` struct above but
// holding bare UUIDs (the plugin's own API, not full `Characteristic` values).
#[cfg(target_os = "android")]
use tauri_plugin_blec::{
    models::{
        BleDevice as BlecDevice, CharProps, ScanFilter as BlecScanFilter, WriteType as BlecWriteType,
    },
    OnDisconnectHandler,
};

#[cfg(target_os = "android")]
struct AndroidSession {
    service: Uuid,
    rx: Uuid,
    tx: Uuid,
    write_type: BlecWriteType,
}

#[cfg(target_os = "android")]
#[derive(Default)]
pub struct BleState {
    session: Mutex<Option<AndroidSession>>,
}

/// Scan for dive computers advertising any of `services`. Mirrors the macOS
/// `ble_scan` above in every way that matters, including the defensive
/// re-filter — `discover`'s own `ScanFilter` is still just a hint the plugin
/// or the OS may apply loosely, same reasoning as the macOS branch.
///
/// Android 12+ (API 31+) requires `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` as
/// runtime-granted "dangerous" permissions, not just manifest declarations —
/// confirmed live: an ungated scan attempt failed with "Missing permissions"
/// on a real device with Bluetooth on. `ask_if_denied: true` shows the
/// system grant dialog on first use, same UX as any other Android runtime
/// permission (camera, location, …) — no custom UI needed on our side.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn ble_scan(
    _state: tauri::State<'_, BleState>,
    services: Vec<String>,
    timeout_ms: u64,
) -> Result<Vec<BleDevice>, String> {
    if !tauri_plugin_blec::check_permissions(true).map_err(|e| e.to_string())? {
        return Err("Bluetooth permission was denied.".to_string());
    }
    let uuids = parse_uuids(&services)?;
    let handler = tauri_plugin_blec::get_handler().map_err(|e| e.to_string())?;

    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<BlecDevice>>(16);
    handler
        .discover(Some(tx), timeout_ms, BlecScanFilter::AnyService(uuids.clone()), false)
        .await
        .map_err(|e| format!("Could not start Bluetooth scan: {e}"))?;

    // discover() runs its own timeout internally and drops its Sender when
    // done, which ends this loop — no separate timer to race against it.
    // Each batch is the FULL discovered-so-far list, not a diff, so dedupe
    // by address rather than assume batches are disjoint.
    let mut out: HashMap<String, BleDevice> = HashMap::new();
    while let Some(batch) = rx.recv().await {
        for d in batch {
            let Some(matched) = uuids.iter().find(|u| d.services.contains(u)) else { continue };
            out.insert(d.address.clone(), BleDevice {
                id: d.address,
                name: d.name,
                service: matched.to_string(),
            });
        }
    }
    Ok(out.into_values().collect())
}

/// Connect to a scanned device, subscribe to its notify characteristic, and
/// start pumping packets into `on_packet`. Same property-based rx/tx
/// selection as the macOS branch — no hardcoded Shearwater/Suunto
/// characteristic UUIDs here either, since Subsurface's own qt-ble.cpp
/// hardcodes none.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn ble_connect(
    state: tauri::State<'_, BleState>,
    id: String,
    on_packet: Channel<BlePacket>,
) -> Result<BleConnection, String> {
    // Cheap/idempotent when already granted (see ble_scan's comment) — but
    // don't assume a scan always precedes a connect, or that a grant from
    // one never lapses (Android can auto-revoke permissions from unused
    // apps), so this checks again rather than trusting ble_scan's check.
    if !tauri_plugin_blec::check_permissions(true).map_err(|e| e.to_string())? {
        return Err("Bluetooth permission was denied.".to_string());
    }
    let handler = tauri_plugin_blec::get_handler().map_err(|e| e.to_string())?;

    // The stream ending is this transport's only disconnect signal on
    // Android (there is no separate notification-stream-ends event the way
    // the macOS pump task gets one) — so this IS the Closed marker, not an
    // optional extra. Same job as the `let _ = on_packet.send(BlePacket::Closed
    // {...})` line after the macOS pump's loop exits.
    let disconnect_packet = on_packet.clone();
    handler
        .connect(
            &id,
            OnDisconnectHandler::from_async(move || {
                let on_packet = disconnect_packet.clone();
                async move {
                    let _ = on_packet.send(BlePacket::Closed {
                        reason: "device disconnected".into(),
                    });
                }
            }),
            false,
        )
        .await
        .map_err(|e| format!("Could not connect: {e}"))?;

    let services = handler
        .discover_services(&id)
        .await
        .map_err(|e| format!("Could not read the device's services: {e}"))?;

    let mut found: Option<(Uuid, Uuid, Uuid, BlecWriteType)> = None;
    for s in &services {
        let rx = s.characteristics.iter().find(|c| c.properties.contains(CharProps::Notify));
        let tx = s.characteristics.iter().find(|c| {
            c.properties.contains(CharProps::Write) || c.properties.contains(CharProps::WriteWithoutResponse)
        });
        if let (Some(rx), Some(tx)) = (rx, tx) {
            let write_type = if tx.properties.contains(CharProps::WriteWithoutResponse) {
                BlecWriteType::WithoutResponse
            } else {
                BlecWriteType::WithResponse
            };
            found = Some((s.uuid, rx.uuid, tx.uuid, write_type));
            break;
        }
    }
    let (service, rx_uuid, tx_uuid, write_type) = found
        .ok_or("This device has no service with both a notify and a write characteristic")?;

    // One notification in, one Channel message out — never batched. Same
    // guarantee as the macOS pump, verified against tauri-plugin-blec's own
    // source (BRIEF-play-store-readiness.md §2.8), not assumed.
    let notify_packet = on_packet.clone();
    handler
        .subscribe(rx_uuid, Some(service), move |data: Vec<u8>| {
            let _ = notify_packet.send(BlePacket::Data { data });
        })
        .await
        .map_err(|e| format!("Could not subscribe to notifications: {e}"))?;

    let name = handler
        .connected_device()
        .await
        .ok()
        .map(|d| d.name)
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Dive computer".to_string());

    *state.session.lock().await = Some(AndroidSession { service, rx: rx_uuid, tx: tx_uuid, write_type });
    Ok(BleConnection { name, service: service.to_string() })
}

/// Write one packet to the device's TX characteristic. Same error-propagation
/// note as the macOS branch: the JS caller treats a write failure from a
/// cancel-triggered disconnect as non-fatal, not a hard sync failure.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn ble_write(state: tauri::State<'_, BleState>, data: Vec<u8>) -> Result<(), String> {
    let handler = tauri_plugin_blec::get_handler().map_err(|e| e.to_string())?;
    let guard = state.session.lock().await;
    let session = guard.as_ref().ok_or("Not connected to a dive computer")?;
    handler
        .send_data(session.tx, Some(session.service), &data, session.write_type)
        .await
        .map_err(|e| e.to_string())
}

/// Tear the connection down. Safe to call when nothing is connected, same
/// contract as the macOS branch.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn ble_disconnect(state: tauri::State<'_, BleState>) -> Result<(), String> {
    let handler = tauri_plugin_blec::get_handler().map_err(|e| e.to_string())?;
    // Unsubscribe before disconnecting for the same reason as the macOS
    // branch: a clean stream end sends Closed itself; the OnDisconnectHandler
    // wired at connect time is the belt-and-braces path for a link that
    // vanishes instead of being torn down in this order.
    if let Some(session) = state.session.lock().await.take() {
        let _ = handler.unsubscribe(session.rx).await;
    }
    let _ = handler.disconnect().await;
    Ok(())
}

/// Whether this build can do native BLE at all — mirrors the macOS branch's
/// "adapter present" check, but Android additionally distinguishes present-
/// but-off, which macOS's `adapter().await.is_ok()` doesn't (CoreBluetooth
/// exposes an adapter object even when Bluetooth is switched off).
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn ble_available() -> bool {
    match tauri_plugin_blec::get_handler() {
        Ok(handler) => matches!(
            handler.get_adapter_state().await,
            tauri_plugin_blec::models::AdapterState::On
        ),
        Err(_) => false,
    }
}
