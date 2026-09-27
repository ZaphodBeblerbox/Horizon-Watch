/**
 * autoUpdate.js — keeping the desktop build current, without asking.
 *
 * A DMG that cannot update itself means every fix reaches people only
 * when they happen to download a new one, which in practice is never. And
 * an update that has to be accepted reaches the people who read dialogs,
 * which is a smaller group than it sounds.
 *
 * SO IT INSTALLS BY ITSELF. Checked on launch, downloaded in the
 * background, written to disk, and applied on the NEXT launch rather than
 * by restarting underneath someone.
 *
 * WHY NOT RELAUNCH IMMEDIATELY. Because this app is a place people write
 * in. Documents autosave, but a relaunch still loses the caret, the
 * scroll, the half-drawn area on the map and whatever was on screen at
 * the time. An update that interrupts is indistinguishable from a crash
 * to the person it interrupts — and it would happen at the least
 * predictable moment, four seconds after launch. Applying at the next
 * launch costs one restart of latency and never costs anyone their place.
 *
 * All of it fails soft: an update server that is down must never be the
 * reason the app does not start.
 */

import { isDesktop } from "../apiBase.js"

let ran = false

/** Resolved once the installer has written the new version to disk. */
export const UPDATE_READY_EVENT = "parallax:update-ready"

export async function checkForUpdate({ silent = true } = {}) {
    if (!isDesktop()) return null
    try {
        const { check } = await import("@tauri-apps/plugin-updater")
        const update = await check()
        return update?.available ? update : null
    } catch (err) {
        if (!silent) console.warn("[update] check failed:", err)
        return null
    }
}

/**
 * Download and install, reporting progress. Does NOT relaunch: the new
 * version is on disk and takes effect the next time the app opens.
 */
export async function installUpdate(update, onProgress = null) {
    let downloaded = 0
    await update.downloadAndInstall((event) => {
        if (event.event === "Progress") {
            downloaded += event.data?.chunkLength || 0
            onProgress?.(downloaded, event.data?.contentLength || 0)
        }
    })
    return update.version
}

/**
 * The whole thing, once per launch: check, install, announce.
 *
 * Deliberately after first paint. Blocking startup on a call to a release
 * server is how an app becomes slow to open on a bad connection, for a
 * feature nobody asked to wait for.
 */
export async function autoUpdateOnLaunch({ onState } = {}) {
    if (ran || !isDesktop()) return null
    ran = true
    await new Promise((r) => setTimeout(r, 4000))

    const update = await checkForUpdate({ silent: true })
    if (!update) return null

    onState?.({ phase: "downloading", version: update.version, pct: 0 })
    try {
        await installUpdate(update, (done, total) => {
            onState?.({
                phase: "downloading", version: update.version,
                pct: total ? Math.round((done / total) * 100) : 0,
            })
        })
        onState?.({ phase: "ready", version: update.version })
        try {
            window.dispatchEvent(new CustomEvent(UPDATE_READY_EVENT, {
                detail: { version: update.version },
            }))
        } catch { /* a webview without CustomEvent still got the update */ }
        return update.version
    } catch (e) {
        // The app is still running the working old version. Say so quietly
        // rather than raising an error about something nobody asked for.
        onState?.({ phase: "failed", version: update.version, error: e?.message || String(e) })
        console.warn("[update] install failed:", e)
        return null
    }
}
