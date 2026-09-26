/**
 * useChrome.js — which chrome is open, and what the app looks like at
 * launch. Both are per-user settings, so both live in settingsStore.js
 * (User.settings on the server) rather than in localStorage: a preference
 * that does not follow the account is not a preference, it is a quirk of
 * the machine you last used.
 *
 * Collapse state is written through the same updateSetting() path as every
 * other setting — applied locally at once, PATCHed after. A panel that
 * waited for a round trip before closing would feel broken on a slow link.
 */

import { useCallback, useEffect, useState } from "react"
import { getSettings, subscribeSettings, updateSetting, DEFAULTS } from "./settingsStore.js"

function readChrome() {
    return { ...DEFAULTS.chrome, ...(getSettings()?.chrome || {}) }
}

/** `useChrome("leftPanel")` → [open, toggle, setOpen] */
export function useChrome(key) {
    const [open, setOpenLocal] = useState(() => readChrome()[key])

    useEffect(() => subscribeSettings((s) => {
        const v = { ...DEFAULTS.chrome, ...(s?.chrome || {}) }[key]
        setOpenLocal(v)
    }), [key])

    const setOpen = useCallback((next) => {
        setOpenLocal(next)
        updateSetting(`chrome.${key}`, next)
    }, [key])

    const toggle = useCallback(() => {
        setOpenLocal((prev) => { updateSetting(`chrome.${key}`, !prev); return !prev })
    }, [key])

    return [open, toggle, setOpen]
}

/**
 * The layer set the app opens with. null means the user has never saved
 * one, and the caller's built-in default applies — which is deliberately
 * distinct from a saved empty object, where the user really did turn
 * everything off and expects it to stay off.
 */
export function getStartupLayers() {
    const v = getSettings()?.startupLayers
    return v && typeof v === "object" ? v : null
}

export function saveStartupLayers(layers) {
    // Returns updateSetting's {ok, error} so the caller can say whether it
    // actually persisted rather than assuming.
    return updateSetting("startupLayers", { ...layers })
}

export function clearStartupLayers() {
    return updateSetting("startupLayers", null)
}
