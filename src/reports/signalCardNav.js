/**
 * signalCardNav.js — reading a document and going to the place.
 *
 * A signal card in a document carries the coordinate it describes. Clicking
 * it flies the map there, which is what turns a briefing from a record into
 * something you can interrogate.
 *
 * ONE DELEGATED LISTENER, not a handler per card. Cards arrive as pasted
 * HTML inside contenteditable and as stored body_html rendered later;
 * neither path runs React for the card itself, so there is nothing to
 * attach a handler to. Delegation on the document catches all of them,
 * including ones inserted after this ran.
 *
 * IT DOES NOT FIRE WHILE WRITING. Inside an editable surface a click is
 * placing the caret, and navigating the map out from under someone
 * mid-sentence is the opposite of useful. Editing uses the toolbar's
 * "show on map" instead, which is deliberate rather than incidental.
 */

let installed = false

export function installSignalCardNav(win = typeof window !== "undefined" ? window : undefined) {
    if (!win || installed) return () => {}
    installed = true

    const onClick = (e) => {
        const card = e.target?.closest?.(".signal-card[data-signal-lat]")
        if (!card) return

        // A click inside an editable region is a caret placement.
        if (card.closest('[contenteditable="true"]')) return

        const lat = Number(card.dataset.signalLat)
        const lon = Number(card.dataset.signalLon)
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return

        e.preventDefault()
        win.dispatchEvent(new CustomEvent("akili:fly-to", {
            detail: { lat, lon, altitude: 250000 },
        }))
        // Switching to the map is the point of the click; staying on the
        // document would fly a globe nobody can see.
        win.dispatchEvent(new CustomEvent("akili:navigate", {
            detail: { destination: "situation" },
        }))
    }

    win.document.addEventListener("click", onClick)
    return () => { win.document.removeEventListener("click", onClick); installed = false }
}
