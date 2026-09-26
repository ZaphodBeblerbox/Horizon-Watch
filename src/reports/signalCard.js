/**
 * signalCard.js — a saved signal as it belongs on a page.
 *
 * WHAT WAS WRONG. Inserting a signal produced a blockquote with a headline
 * and a coordinate pair. That is a citation, not the thing itself: the
 * reader of the finished document cannot see where it happened without
 * going and looking it up, which is the one thing a briefing exists to
 * save them.
 *
 * So the block is the same object the Inbox and the notification card
 * show — severity, source, time, headline, location — plus the two maps
 * that answer "where": a world view for the region, and a local view for
 * the place.
 *
 * EVERYTHING IS INLINE SVG AND INLINE STYLE. This HTML is stored as a
 * document body and later exported through the print surface. A canvas
 * renders blank in a PDF, a live globe renders nothing at all, and a class
 * name refers to a stylesheet the exported page does not carry. Geometry
 * and literal styles survive all three hops: editor, saved body_html, PDF.
 */

import { WORLD_PATH, WORLD_VIEWBOX } from "./worldOutline.js"

const esc = (t) => String(t ?? "").replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))

const SEV = {
    critical:    "#c4453c",
    significant: "#b8863b",
    elevated:    "#3f7fa6",
    routine:     "#6a6f77",
}

/** x is lon+180, y is 90-lat — the same arithmetic worldOutline is authored in. */
const px = (lon) => (Number(lon) + 180)
const py = (lat) => (90 - Number(lat))

/* THE OUTLINE IS 23KB, SO IT IS WRITTEN ONCE PER CARD AND REFERENCED
   TWICE. Inlining it in both maps doubled every saved signal to ~52KB of
   document body for no visible gain. A counter keeps the element ids
   unique, because a document holding several cards would otherwise have
   several elements claiming the same id and every <use> would resolve to
   the first one. */
let cardSeq = 0

/** The whole world, with the point marked. */
function worldSvg(lat, lon, accent, id) {
    const x = px(lon), y = py(lat)
    return `<svg viewBox="${WORLD_VIEWBOX}" width="100%" height="118" preserveAspectRatio="xMidYMid meet" style="display:block;background:#f4f2ee;border:1px solid #d8d3ca">
<defs><path id="${id}" d="${WORLD_PATH}"/></defs>
<use href="#${id}" fill="#ddd8cf" stroke="#c3bdb2" stroke-width="0.4"/>
<line x1="0" y1="${y.toFixed(1)}" x2="360" y2="${y.toFixed(1)}" stroke="${accent}" stroke-width="0.5" opacity="0.5"/>
<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="180" stroke="${accent}" stroke-width="0.5" opacity="0.5"/>
<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="none" stroke="${accent}" stroke-width="1.8"/>
<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" fill="${accent}"/>
</svg>`
}

/** A regional window around the point.
 *
 * 40 degrees, not 12. The outline is simplified to 1.8 degrees, so at a
 * 12-degree span it has no real detail left — it drew coarse polygon
 * edges that READ as coastline and were not, which is a map that lies.
 * At this span the same data is honest: recognisable country shapes, and
 * the marker placed against them. */
function localSvg(lat, lon, accent, id) {
    const span = 40
    const x = px(lon), y = py(lat)
    const vb = `${(x - span / 2).toFixed(1)} ${(y - span / 2).toFixed(1)} ${span} ${span}`
    const grid = []
    for (let g = Math.floor(x - span); g <= Math.ceil(x + span); g += 5) {
        grid.push(`<line x1="${g}" y1="${y - span}" x2="${g}" y2="${y + span}" stroke="#cfc9be" stroke-width="0.25"/>`)
    }
    for (let g = Math.floor(y - span); g <= Math.ceil(y + span); g += 5) {
        grid.push(`<line x1="${x - span}" y1="${g}" x2="${x + span}" y2="${g}" stroke="#cfc9be" stroke-width="0.25"/>`)
    }
    return `<svg viewBox="${vb}" width="100%" height="118" preserveAspectRatio="xMidYMid slice" style="display:block;background:#eef1f3;border:1px solid #d8d3ca">
<use href="#${id}" fill="#ddd8cf" stroke="#b9b3a8" stroke-width="0.25"/>
${grid.join("")}
<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.6" fill="none" stroke="${accent}" stroke-width="0.7"/>
<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="0.8" fill="${accent}"/>
</svg>`
}

function coordLine(lat, lon) {
    if (lat == null || lon == null) return ""
    const ns = lat >= 0 ? "N" : "S", ew = lon >= 0 ? "E" : "W"
    return `${Math.abs(lat).toFixed(4)}°${ns}  ${Math.abs(lon).toFixed(4)}°${ew}`
}

/**
 * The block that goes into the document.
 * `item` is a savedForBriefing record.
 */
export function signalCardHtml(item, { headline, meta }) {
    const accent = SEV[String(item.severity || "").toLowerCase()] || SEV.routine
    const hasGeo = item.lat != null && item.lon != null
    const when = item.when ? String(item.when).slice(0, 16).replace("T", " ") + "Z" : null

    const head = [
        item.source ? esc(String(item.source).toUpperCase()) : null,
        item.severity ? esc(String(item.severity).toUpperCase()) : null,
        when ? esc(when) : null,
    ].filter(Boolean).join("  ·  ")

    const landId = `wl${++cardSeq}-${Math.random().toString(36).slice(2, 7)}`
    const maps = hasGeo
        ? `<table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:9px 0 4px"><tr>
<td style="width:50%;vertical-align:top">${worldSvg(item.lat, item.lon, accent, landId)}
<div style="font:8pt Georgia,serif;color:#6a6f77;margin-top:3px;text-align:center">World</div></td>
<td style="width:50%;vertical-align:top">${localSvg(item.lat, item.lon, accent, landId)}
<div style="font:8pt Georgia,serif;color:#6a6f77;margin-top:3px;text-align:center">${esc(coordLine(item.lat, item.lon))}</div></td>
</tr></table>`
        : ""

    const crop = item.imageUrl
        ? `<div style="margin:9px 0 2px"><img src="${esc(item.imageUrl)}" alt="${esc(headline)}" style="max-width:100%;height:auto;border:1px solid #d8d3ca"/></div>`
        : ""

    return `<div class="signal-card" style="border:1px solid #cdc8bf;border-left:3px solid ${accent};background:#fbfaf8;padding:10px 12px;margin:14px 0">
<div style="font:7.5pt Georgia,serif;letter-spacing:.09em;color:#6a6f77;margin-bottom:4px">${head}</div>
<div style="font:bold 11.5pt Georgia,serif;color:#1b1f24;line-height:1.35">${esc(headline)}</div>
${item.region ? `<div style="font:9.5pt Georgia,serif;color:#4a4f57;margin-top:2px">${esc(item.region)}</div>` : ""}
${item.context ? `<div style="font:10pt Georgia,serif;color:#33383f;margin-top:6px;line-height:1.5">${esc(item.context)}</div>` : ""}
${crop}${maps}
<div style="font:8pt Georgia,serif;color:#7d7870;border-top:1px solid #e2ddd4;padding-top:4px;margin-top:6px">${esc(meta)}</div>
</div><p><br/></p>`
}
