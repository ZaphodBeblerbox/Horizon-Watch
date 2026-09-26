/**
 * autoUpdate.js — keeping the desktop build current.
 *
 * A DMG that cannot update itself means every fix reaches people only when
 * they happen to download a new one, which in practice is never. So the app
 * checks on launch and offers what it finds.
 *
 * IT ASKS BEFORE INSTALLING. A silent update that relaunches the app is
 * indistinguishable from a crash to whoever was mid-sentence in a briefing.
 * The check is silent; the install is not.
 *
 * Everything here is desktop-only and fails soft: in a browser the plugin
 * imports do not exist, and the whole module must be a no-op rather than an
 * error at startup.
 */

import { isDesktop } from "../apiBase.js"

let checked = false

export async function checkForUpdate({ silent = true } = {}) {
    if (!isDesktop()) return null
    try {
        const { check } = await import("@tauri-apps/plugin-updater")
        const update = await check()
        if (!update?.available) return null
        return update
    } catch (err) {
        // An update server that is down must never stop the app starting.
        if (!silent) console.warn("[update] check failed:", err)
        return null
    }
}

export async function installUpdate(update, onProgress = null) {
    const { relaunch } = await import("@tauri-apps/plugin-process")
    let downloaded = 0
    await update.downloadAndInstall((event) => {
        // The payload shape differs per phase; only Progress carries bytes.
        if (event.event === "Progress") {
            downloaded += event.data?.chunkLength || 0
            onProgress?.(downloaded, event.data?.contentLength || 0)
        }
    })
    await relaunch()
}

/**
 * Called once from the app shell. Returns the update so the caller can
 * show it; does not install anything on its own.
 */
export async function checkOnceOnLaunch() {
    if (checked) return null
    checked = true
    // Deliberately after first paint. Blocking startup on a network call to
    // a release server is how an app becomes slow to open on a bad
    // connection, for a feature nobody asked to wait for.
    await new Promise((r) => setTimeout(r, 4000))
    return checkForUpdate({ silent: true })
}
