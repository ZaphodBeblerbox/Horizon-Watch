/**
 * printSurface.jsx — the one place a PDF comes from.
 *
 * WHY THIS EXISTS. Export used to be a denylist: PrintLayout.jsx named the
 * chrome it wanted gone (`.topbar,.tabstrip,.statusbar,#toasts,.scrim,…`)
 * and hoped that list stayed complete. It never can. Every panel added
 * since — the layer rail, the map chrome, the dock, the inspector — was
 * not in the list, so it printed. That is the "screenshot of the whole UI"
 * bug, and it is structural: a denylist fails open, and it fails silently,
 * because nobody re-reads a print stylesheet when adding a sidebar.
 *
 * So the rule is inverted. The document is portalled to a node that is a
 * direct child of <body>, and print hides every sibling of that node:
 *
 *     body > *:not(#print-root) { display: none !important }
 *
 * That fails CLOSED. A new panel mounts inside #app, #app is not
 * #print-root, and it does not print — with no stylesheet to update. The
 * only thing on the sheet is the white page.
 */

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"

export const PRINT_ROOT_ID = "print-root"

/* Injected once, globally — not per-component. Two components mounting
   their own copies of an @page rule is how you get one of them silently
   winning. */
const GLOBAL_PRINT_CSS = `
#print-root{display:none}

@media print{
  /* Letter portrait, no browser margin: the .docpage box IS the sheet, so
     a UA margin on top of its own .8in padding would reflow every page. */
  @page{margin:0;size:letter}

  html,body{
    background:#fff!important; overflow:visible!important;
    height:auto!important; margin:0!important; padding:0!important;
  }

  /* THE ALLOWLIST. Everything that is not the document is not on the page. */
  body > *:not(#print-root){display:none!important}
  #print-root{display:block!important;position:static!important}

  /* COLOUR HAS TO BE ASKED FOR. Browsers drop background colours when
     printing unless told otherwise, which is what turned every severity
     bar and shaded cell white. */
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}

  /* NOTHING SPLITS MID-THOUGHT. A table row broken over a page boundary
     loses its header and reads as corrupted. */
  table,figure,blockquote,tr,li{break-inside:avoid}
  thead{display:table-header-group}
  tfoot{display:table-footer-group}
  h1,h2,h3,h4{break-after:avoid;break-inside:avoid}
  img,svg,canvas{max-width:100%;height:auto}
  a{color:inherit;text-decoration:none}
}
`

let injected = false
function injectGlobalPrintCss() {
    if (injected || typeof document === "undefined") return
    injected = true
    const s = document.createElement("style")
    s.id = "parallax-print-css"
    s.textContent = GLOBAL_PRINT_CSS
    document.head.appendChild(s)
}

/**
 * Portals its children to a <body>-level node so the allowlist above can
 * see them. Off-print the node is display:none — the caller keeps whatever
 * on-screen preview it already had; this tree exists for the sheet.
 */
export function PrintSurface({ children }) {
    const [el] = useState(() => {
        if (typeof document === "undefined") return null
        const d = document.createElement("div")
        d.id = PRINT_ROOT_ID
        return d
    })

    useEffect(() => {
        if (!el) return
        injectGlobalPrintCss()
        /* An earlier surface that did not unmount cleanly (a crash mid-print,
           a hot reload) would leave a second #print-root and print twice. */
        document.getElementById(PRINT_ROOT_ID)?.remove()
        document.body.appendChild(el)
        return () => { el.remove() }
    }, [el])

    if (!el) return null
    return createPortal(children, el)
}

/**
 * The single export entry point. Waits two frames so the portalled tree has
 * actually laid out before the dialog snapshots it — printing during the
 * same frame as a state change yields a half-rendered first page.
 */
export function exportPdf() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            window.print()
            resolve()
        }))
    })
}
