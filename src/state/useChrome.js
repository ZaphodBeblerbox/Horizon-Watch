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

    /* NO SIDE EFFECT INSIDE THE UPDATER. updateSetting() used to be called
       from within setOpenLocal's updater function, and React runs updaters
       during the RENDER phase — so toggling a panel notified every settings
       subscriber mid-render and React warned "Cannot update a component
       (Situation) while rendering a different component (App)". With enough
       subscribers that is not just a warning; it is a render that reads
       state written halfway through itself.

       The next value comes from the store rather than from `prev`, which is
       both side-effect free and more correct: the store is what the other
       subscribers are about to be told, so it is what this should negate. */
    const toggle = useCallback(() => {
        const next = !readChrome()[key]
        setOpenLocal(next)
        updateSetting(`chrome.${key}`, next)
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
    // clean: false is written explicitly: settings PATCHes deep-merge, so a
    // first login's {clean: true} would otherwise survive the save and the
    // launch would still open on a bare map.
    return updateSetting("startupLayers", { ...layers, clean: false })
}

export function clearStartupLayers() {
    return updateSetting("startupLayers", null)
}
