/**
 * ontologyRecord.js — PARALLAX §10.4 / Part 1's rule 3.
 *
 * "Nothing reaches a view without an ontology record. Every rendered object
 * carries {id, origin_class, licence_tier, source_ref, edges[], ingested}.
 * IF IT CAN BE SEEN, IT CAN BE TRACED."
 *
 * The rule is only worth anything if the trace is visible, so §10.4 requires
 * every inspector body to END with this block. This module extracts it from
 * whatever payload an entity already carries — it is a reader, never a
 * generator: where a field is absent it says so, because an ontology record
 * that fabricates its own provenance defeats the entire point of having one.
 *
 * Two columns, never one (§18's Provenance layer): `origin_class` is an
 * EVIDENCE judgement — who observed this and how directly — and
 * `licence_tier` is a LEGAL one, about what may be redistributed. Collapsing
 * them loses the ability to answer either question.
 */

/**
 * What each class actually asserts, so the tag is not just a letter.
 *
 * ⚠ THESE MIRROR backend/provenance.py AND MUST NOT DRIFT FROM IT. That
 * module is the single source of truth for the mapping, and this block is
 * the only place an analyst ever reads the meaning — a definition that
 * disagrees with the backend is worse than no definition, because it is
 * confident and wrong in the one panel whose whole job is traceability.
 * ontologyRecord.test.js pins these against provenance.py's own docstring.
 *
 * An earlier version of this file had C as "analyst-produced" and D as
 * "derived by this system", which inverted the evidence scale: D is the
 * WEAKEST class, and telling someone a class-D row was computed in-house
 * would invite them to trust it more, not less.
 */
export const ORIGIN_CLASS = {
    A: "Primary instrument — sensor output, unmediated",
    B: "Authoritative registry — a real body of record",
    C: "Commercial redistribution — cleaned and resold; provenance survives, the raw data does not",
    D: "Open reporting — press and social; fast, cheap, weak",
}

/**
 * The legal axis, independent of the evidence one. T4 is the whole reason
 * they are two fields: excellent evidence that is ILLEGAL in a paid
 * deliverable. An ADS-B feed can be class-A instrument data and T4 at once,
 * and merging the axes would make it "legal by accident" to ship
 * research-licensed data to a paying client.
 */
export const LICENCE_TIER = {
    T1: "Client-deliverable — may be quoted, charted and shipped verbatim",
    T2: "Internal only — may inform a conclusion, never leaves the building",
    T3: "Derived metrics only — counts, indices and deltas may ship; the records may not",
    T4: "Research / non-commercial — excellent evidence, illegal in a paid deliverable",
}

const firstOf = (data, keys) => {
    for (const k of keys) {
        const v = data?.[k]
        if (v !== null && v !== undefined && v !== "") return v
    }
    return null
}

const asList = (v) => {
    if (!v) return []
    if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined && x !== "")
    if (typeof v === "string") {
        try {
            const p = JSON.parse(v)
            if (Array.isArray(p)) return p
        } catch { /* a plain comma list, not JSON */ }
        return v.split(",").map((s) => s.trim()).filter(Boolean)
    }
    return [v]
}

/**
 * Build the block for an entity. `null` is never returned — an entity with no
 * record at all still renders the block, saying what is missing. A silent
 * omission would let an untraceable object look identical to a traced one,
 * which is precisely the state rule 3 exists to prevent.
 */
export function buildOntologyRecord(entityType, data = {}) {
    const originClass = firstOf(data, ["origin_class", "originClass"])
    const licenceTier = firstOf(data, ["licence_tier", "licenceTier", "license_tier"])
    const instance = firstOf(data, [
        "system_id", "id", "alert_id", "detection_id", "view_id", "mmsi", "icao",
    ])
    const sourceRef = asList(firstOf(data, ["source_ref", "sourceRef", "source_id", "source"]))
    const edges = asList(firstOf(data, ["edges", "edge_types"]))
    const ingested = firstOf(data, ["ingested", "ingested_at", "ingestedAt", "created_at", "createdAt"])

    return {
        instance: instance != null ? String(instance) : null,
        type: entityType || null,
        originClass: originClass || null,
        originMeaning: originClass ? ORIGIN_CLASS[String(originClass).toUpperCase()] || null : null,
        licenceTier: licenceTier || null,
        licenceMeaning: licenceTier ? LICENCE_TIER[String(licenceTier).toUpperCase()] || null : null,
        sourceRef,
        edges,
        ingested: ingested != null ? String(ingested) : null,
        // What the block can honestly claim about itself.
        complete: Boolean(originClass && licenceTier && instance),
    }
}

/**
 * §10.4's "one-line rationale" — why this object is allowed on screen at all,
 * stated from its own record rather than from a lookup table of intentions.
 */
export function traceRationale(rec) {
    if (!rec.originClass && !rec.licenceTier) {
        return "This object reached the view without an ontology record. It cannot be traced to a source, and nothing here should be relied on until it can."
    }
    if (!rec.complete) {
        const missing = [
            !rec.instance && "an instance id",
            !rec.originClass && "an origin class",
            !rec.licenceTier && "a licence tier",
        ].filter(Boolean)
        return `Partially traceable — missing ${missing.join(" and ")}.`
    }
    const src = rec.sourceRef.length
        ? `${rec.sourceRef.length} contributing source${rec.sourceRef.length === 1 ? "" : "s"}`
        : "no cited source"
    return `${rec.originMeaning || `Origin ${rec.originClass}`} · ${src} · ${rec.licenceMeaning || rec.licenceTier}.`
}
