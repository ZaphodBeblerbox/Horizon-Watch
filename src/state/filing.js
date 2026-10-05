/**
 * filing.js — ONE place a saved thing goes.
 *
 * THE PROBLEM THIS SOLVES. Saving was spread across four stores that did
 * not know about each other:
 *
 *   briefingBasket.js    an in-memory Map of id → label, for a count
 *   savedForBriefing.js  a 120-item array in settings, read by the writer's
 *                        aside and by the Notes page
 *   case files           CaseNode rows on the server — durable, shareable,
 *                        and the only one of the four that survives a
 *                        different browser
 *   notes                the same settings array with kind: "note"
 *
 * So the same gesture landed in a different place depending on which screen
 * you were on, and nothing you saved on the map was in the case you were
 * working. The case tree is the only store that is durable, shared and
 * already a filing system, so it is the truth; the settings array stays as
 * a local cache so a save shows up instantly and still works offline.
 *
 * WHERE IT LANDS. In the case for the theater you are standing in, under
 * `<Theater> / Signals / <Sector>` — created on first use, so saving never
 * asks a question. Sector comes from the signal's own domain, urgency from
 * its severity, and both are kept on the node so the generator and the
 * editor can offer "critical maritime" without re-deriving anything.
 */
import { fileSavedItem, caseForTheater, listNodes, createNode } from "../lib/casesApi.js"
import { getFilingCase, setFilingCase } from "./filingCase.js"
import { saveForBriefing } from "./savedForBriefing.js"

/** The theater the app is currently standing in. */
let _theater = null
export function setActiveTheater(name) { _theater = name || null }
export function getActiveTheater() { return _theater }

/* Sector, from whatever the record calls its domain. Capability names, the
   same vocabulary the map's layers and the case tree already use. */
const SECTOR = {
    ais: "Vessels", vessel: "Vessels", vessels: "Vessels", maritime: "Vessels",
    adsb: "Aircraft", aircraft: "Aircraft", air: "Aircraft",
    geoconfirmed: "Verified Events", confirmed: "Verified Events",
    gdelt: "Wire Reports", news: "Wire Reports",
    fusion: "Surge & Fusion", surge: "Surge & Fusion",
    sentinel: "Imagery", imagery: "Imagery", detection: "Imagery", sar: "Imagery",
    firms: "Thermal", fire: "Thermal",
    zone: "Zones", aoi: "Zones",
}

export function sectorOf(item) {
    // A note is not a signal with a missing domain — it is a different
    // kind of thing, and filing it under Signals / Other is how an
    // observation you dictated becomes impossible to find again.
    const kind = String(item?.kind || "").toLowerCase()
    if (kind === "note") return "Notes"
    if (kind === "capture" || kind === "screenshot") return "Screenshots"
    const probe = [item?.sector, item?.domain, item?.source, item?.type]
        .filter(Boolean).map((x) => String(x).toLowerCase())
    for (const p of probe) if (SECTOR[p]) return SECTOR[p]
    return "Other"
}

export const URGENCY = ["critical", "significant", "high", "elevated", "routine"]
export function urgencyOf(item) {
    const s = String(item?.severity || item?.severity_tier || item?.sev || "").toLowerCase()
    return URGENCY.includes(s) ? s : "routine"
}

/**
 * Save one thing, everywhere it needs to be.
 *
 * @param item   the record, however the calling screen holds it
 * @param opts.theater  override the active theater
 * @param opts.caseId   override the case (File to case uses this)
 * @returns {Promise<{ caseId: string|null, path: string[]|null, local: boolean }>}
 */
export async function fileSignal(item, { theater, caseId } = {}) {
    // The local cache first, so the UI updates on the next frame whatever
    // the network does.
    const local = saveForBriefing({
        ...item,
        sector: sectorOf(item),
        severity: urgencyOf(item),
    })

    const th = theater ?? _theater
    let target = caseId || null
    try {
        if (!target) {
            // The theater's own case, created on first use. Falling back to
            // whatever was last filed to keeps a save working when there is
            // no theater (an unscoped workspace).
            target = th ? (await caseForTheater(th))?.case_id : getFilingCase()
        }
        if (!target) return { caseId: null, path: null, local }

        setFilingCase(target)
        const sector = sectorOf(item)
        await fileSavedItem(target, {
            kind: item?.kind === "capture" ? "screenshot"
                : item?.kind === "note" ? "note" : "signal",
            category: (item?.source || item?.domain || item?.kind || "other"),
            theater: th || undefined,
            name: item?.headline || item?.label || item?.title || item?.id,
            image: typeof item?.imageUrl === "string" && item.imageUrl.startsWith("data:")
                ? item.imageUrl : undefined,
            payload: {
                ref: item?.id, headline: item?.headline || item?.label || null,
                region: item?.region || item?.place || null,
                source: item?.source || null,
                sector, urgency: urgencyOf(item),
                when: item?.when || null,
                lat: item?.lat ?? null, lon: item?.lon ?? null,
                context: item?.context || null, url: item?.url || null,
            },
        })
        const root = item?.kind === "note" ? "Notes" : "Signals"
        return { caseId: target, path: [th, root, sector].filter(Boolean), local }
    } catch {
        // A failed file is not a lost signal — the local cache has it, and
        // the writer's aside reads that.
        return { caseId: null, path: null, local }
    }
}


/* ── Folders, by the name someone said out loud ───────────────────────
 *
 * Voice filing needs to turn "the vessels folder" into a node id. The
 * match is deliberately forgiving — dictation gives you "vessel's",
 * "Vessels" and "vessels folder" for the same place, and a miss creates a
 * SECOND folder beside the one you meant, which is the failure that makes
 * a filing system useless. Exact first, then case-insensitive, then a
 * contains either way round.
 */
function norm(x) {
    return String(x || "").toLowerCase().replace(/['’]s\b/g, "").replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ").trim()
}

/** The case everything is currently going to. */
export async function activeCaseId() {
    const existing = getFilingCase()
    if (existing) return existing
    if (!_theater) return null
    const c = await caseForTheater(_theater)
    if (c?.case_id) setFilingCase(c.case_id)
    return c?.case_id || null
}

/** Find a folder in the active case by spoken name, or null. */
export async function findFolder(spoken, caseId) {
    const cid = caseId || (await activeCaseId())
    if (!cid) return null
    const raw = await listNodes(cid).catch(() => null)
    const nodes = (Array.isArray(raw) ? raw : raw?.nodes || []).filter((n) => n.kind === "folder")
    const want = norm(spoken)
    if (!want) return null
    return nodes.find((n) => n.name === spoken)
        || nodes.find((n) => norm(n.name) === want)
        || nodes.find((n) => norm(n.name).includes(want) || want.includes(norm(n.name)))
        || null
}

/**
 * Create a folder, under the theater's own folder when there is one.
 *
 * A folder made by voice while watching the Red Sea belongs inside "Red
 * Sea watch", not loose at the case root beside it — otherwise the tree
 * grows two parallel structures and neither is the real one.
 */
export async function createFolder(name, { caseId } = {}) {
    const cid = caseId || (await activeCaseId())
    if (!cid) return { ok: false, why: "No case to put it in." }
    const existing = await findFolder(name, cid)
    if (existing) return { ok: true, node: existing, created: false, caseId: cid }
    let parentId = null
    if (_theater) {
        const th = await findFolder(_theater, cid)
        if (th) parentId = th.id
    }
    try {
        const node = await createNode(cid, { kind: "folder", name, parent_id: parentId })
        return { ok: true, node, created: true, caseId: cid }
    } catch (e) {
        return { ok: false, why: String(e.message || e) }
    }
}

/** Move a saved thing into a named folder, creating nothing. */
export async function fileIntoFolder(item, spokenFolder) {
    const cid = await activeCaseId()
    if (!cid) return { ok: false, why: "No case is open to file into." }
    const folder = await findFolder(spokenFolder, cid)
    if (!folder) return { ok: false, why: `There is no folder called \u201c${spokenFolder}\u201d yet.` }
    try {
        await fileSavedItem(cid, {
            kind: item?.kind === "capture" ? "screenshot" : "signal",
            category: sectorOf(item),
            theater: _theater || undefined,
            name: item?.headline || item?.label || item?.title || item?.id,
            parent_id: folder.id,
            payload: {
                ref: item?.id, headline: item?.headline || item?.label || null,
                sector: sectorOf(item), urgency: urgencyOf(item),
                lat: item?.lat ?? null, lon: item?.lon ?? null,
            },
        })
        return { ok: true, folder: folder.name, caseId: cid }
    } catch (e) {
        return { ok: false, why: String(e.message || e) }
    }
}
