/**
 * InfraDetail.jsx — everything about one piece of infrastructure, in the
 * inspector (GlobeInfraLayer → infra_feature).
 *
 * The object turning slowly in the register's style (the same 3D models as
 * the assets), the facts that matter for its kind (voltage and circuits for
 * a line, fuel and capacity for a plant, pressure and diameter for a
 * pipeline), what Wikidata says about it — with a photo when there is one —
 * what is happening near it, ranked as an asset's signals are, and all of
 * its OpenStreetMap tags. It can be registered as one of our assets from
 * here, which puts it in the register and in everything that watches it.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import AssetModel from "../assets/AssetModel.jsx"
import SectionLabel from "./SectionLabel.jsx"
import { agoLabel } from "../utils/formatTime.js"
import { toast } from "../ui/toast.js"

const EXPO = { high: "#E5484D", elevated: "#F5A524", low: "#8FB4E8", quiet: "#4CAF7A", unknown: "#9AA9BC" }
const SEV = { critical: "#E5484D", high: "#F5A524", significant: "#F5A524", elevated: "#8FB4E8" }
const ROW = { display: "grid", gridTemplateColumns: "minmax(110px, max-content) minmax(0, 1fr)", gap: "6px 14px", fontSize: "var(--text-sm)" }
const BTN = { height: 30, padding: "0 12px", border: "1px solid var(--gline2)", background: "transparent", color: "var(--txt)", font: "inherit", fontSize: 12.5, cursor: "pointer", borderRadius: 6 }
const flyTo = (lat, lon, altitude = 20_000) => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat, lon, altitude } }))

export default function InfraDetail({ feature }) {
    const [d, setD] = useState(null)
    const [sig, setSig] = useState(null)
    const [allTags, setAllTags] = useState(false)
    const [adding, setAdding] = useState(false)
    const f = feature || {}

    useEffect(() => {
        if (!f.id) return undefined
        let live = true
        setD(null); setSig(null); setAllTags(false)
        fetch(`${API_BASE}/api/infra/detail`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: f.id, kind: f.kind, lat: f.lat, lon: f.lon, props: f.props || {}, osm_type: f.osm_type }),
        }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((x) => { if (live) setD(x) }).catch((e) => { if (live) setD({ error: e.message }) })
        fetch(`${API_BASE}/api/infra/signals?kind=${encodeURIComponent(f.kind)}&lat=${f.lat}&lon=${f.lon}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((x) => { if (live) setSig(x || { signals: [] }) }).catch(() => { if (live) setSig({ signals: [] }) })
        return () => { live = false }
    }, [f.id]) // eslint-disable-line react-hooks/exhaustive-deps

    const addAsset = async () => {
        if (!d) return
        setAdding(true)
        try {
            const r = await fetch(`${API_BASE}/api/my-assets`, {
                method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: d.title, kind: d.asset_kind, lat: f.lat, lon: f.lon, radius_km: d.radius_km,
                                       notes: [d.label, ...(d.facts || []).map(([k, v]) => `${k}: ${v}`), d.osm_url].filter(Boolean).join("\n") }),
            })
            const a = await r.json()
            if (!r.ok) throw new Error(a.detail || `HTTP ${r.status}`)
            window.dispatchEvent(new CustomEvent("akili:assets-changed"))
            toast(`${d.title} is in the register`, { icon: "i-check" })
            window.__plxAssetSel = a.id
            window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "assets" } }))
            window.dispatchEvent(new CustomEvent("akili:open-asset", { detail: { id: a.id } }))
        } catch (e) {
            toast(e.message || "Could not register it", { icon: "i-alert" })
        } finally { setAdding(false) }
    }

    const wd = d?.wikidata
    const tags = Object.entries(d?.tags || {})
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
            <div style={{ position: "relative", border: "1px solid var(--gline)", borderRadius: 8, overflow: "hidden",
                          background: "radial-gradient(ellipse at 50% 62%, rgba(122,167,255,.10), transparent 72%)" }}>
                {d?.model ? <AssetModel kind={d.model} height={250} /> : <div style={{ height: 250 }} />}
                <span style={{ position: "absolute", left: 10, bottom: 8, fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".12em",
                               textTransform: "uppercase", color: "var(--txt4)" }}>{f.label} · drag to turn</span>
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
                <button style={{ ...BTN, borderColor: "var(--acchi)", background: "var(--accdim)" }} disabled={!d || adding || !!d?.error} onClick={addAsset}>
                    {adding ? "Adding…" : "Add to our assets"}
                </button>
                {d?.osm_url && <a href={d.osm_url} target="_blank" rel="noreferrer" style={{ ...BTN, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>OpenStreetMap ↗</a>}
                {wd?.wikipedia && <a href={wd.wikipedia} target="_blank" rel="noreferrer" style={{ ...BTN, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Wikipedia ↗</a>}
            </div>

            {!d && <span style={{ fontSize: 12.5, color: "var(--txt3)" }}>Reading OpenStreetMap and Wikidata…</span>}
            {d?.error && <span style={{ fontSize: 12.5, color: "#FF6B6B" }}>Could not read the details: {d.error}</span>}

            {d && !d.error && (
                <div>
                    <SectionLabel>What it is</SectionLabel>
                    {wd?.description && <div style={{ fontSize: "var(--text-sm)", color: "var(--txt)", lineHeight: 1.5, marginBottom: 8 }}>{wd.description[0].toUpperCase() + wd.description.slice(1)}.</div>}
                    <div style={ROW}>
                        {[...(d.facts || []), ...((wd?.facts || []).filter(([k]) => !(d.facts || []).some(([k2]) => k2 === k)))].map(([k, v]) => [
                            <span key={`k-${k}`} style={{ color: "var(--txt3)" }}>{k}</span>,
                            <span key={`v-${k}`} style={{ color: "var(--txt)", wordBreak: "break-word" }}>{v}</span>,
                        ])}
                        {!d.facts?.length && !wd?.facts?.length && <span style={{ gridColumn: "1 / -1", color: "var(--txt3)" }}>OpenStreetMap records little about this one beyond where it is.</span>}
                    </div>
                    {wd?.image && (
                        <figure style={{ margin: "10px 0 0" }}>
                            <img src={wd.image} alt={d.title} loading="lazy" style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 6, display: "block" }} />
                            <figcaption style={{ fontSize: 11, color: "var(--txt4)", marginTop: 4 }}>Wikimedia Commons, via Wikidata {wd.qid}</figcaption>
                        </figure>
                    )}
                </div>
            )}

            <div>
                <SectionLabel meta={sig?.signals ? `${sig.signals.length} within ${sig.radius_km} km · 72 h` : null}>Happening near it</SectionLabel>
                {!sig && <span style={{ fontSize: 12.5, color: "var(--txt3)" }}>Ranking what is near it…</span>}
                {sig?.exposure && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginBottom: 6 }}>
                        <i style={{ width: 8, height: 8, borderRadius: "50%", background: EXPO[sig.exposure] || EXPO.unknown }} />
                        <span style={{ color: "var(--txt2)", minWidth: 0, overflowWrap: "anywhere" }}>{{ high: "Exposed — serious events close by", elevated: "Something is happening nearby", low: "Minor activity nearby", quiet: "Quiet around it" }[sig.exposure] || "Not known"}</span>
                    </div>
                )}
                {sig?.signals?.length === 0 && <span style={{ fontSize: 12.5, color: "var(--txt3)" }}>Nothing reported within {sig.radius_km || "the"} km in the last three days.</span>}
                {(sig?.signals || []).slice(0, 8).map((s) => (
                    <button key={s.id} onClick={() => flyTo(s.lat, s.lon, 30_000)} style={{
                        display: "grid", gridTemplateColumns: "10px minmax(0,1fr)", gap: "2px 8px", width: "100%", textAlign: "left", border: 0,
                        borderTop: "1px solid var(--gline)", padding: "7px 0", background: "transparent", color: "var(--txt)", font: "inherit", cursor: "pointer",
                    }}>
                        <i style={{ width: 7, height: 7, borderRadius: "50%", marginTop: 6, background: SEV[String(s.severity).toLowerCase()] || "#9AA9BC" }} />
                        <span style={{ fontSize: 13, lineHeight: 1.4 }}>{s.title}</span>
                        <span />
                        <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>{[`${s.km} km`, s.when ? agoLabel(s.when) : null, s.source].filter(Boolean).join(" · ")}</span>
                    </button>
                ))}
            </div>

            {tags.length > 0 && (
                <div>
                    <button onClick={() => setAllTags((v) => !v)} style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", color: "var(--txt3)", font: "inherit" }}>
                        <SectionLabel meta={tags.length}>{allTags ? "▾" : "▸"} Everything OpenStreetMap records</SectionLabel>
                    </button>
                    {allTags && (
                        <div style={{ ...ROW, fontFamily: "var(--mz-font-mono)", fontSize: 11.5 }}>
                            {tags.map(([k, v]) => [
                                <span key={`k-${k}`} style={{ color: "var(--txt3)" }}>{k}</span>,
                                <span key={`v-${k}`} style={{ color: "var(--txt2)", wordBreak: "break-word" }}>{String(v)}</span>,
                            ])}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
