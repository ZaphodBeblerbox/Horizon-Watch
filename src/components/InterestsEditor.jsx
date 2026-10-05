/**
 * InterestsEditor.jsx — tell Parallax what you watch.
 *
 * Saved per user (settings.interests: {countries, regions, topics}) and read
 * by state/interests.js, which decides what Home leads with and what counts
 * as "for you". Your theaters already count; this adds what they do not
 * cover. Changes apply at once.
 */
import { useEffect, useState } from "react"
import { getSettings, subscribeSettings, updateSetting } from "../state/settingsStore.js"
import { REGIONS, TOPICS } from "../state/interests.js"
import PlacePicker from "../search/PlacePicker.jsx"

const chip = (on) => ({
    height: 26, padding: "0 10px", cursor: "pointer", borderRadius: 0,
    border: `1px solid ${on ? "var(--acc-line, var(--acchi))" : "var(--gline, var(--line))"}`,
    background: on ? "var(--accdim, var(--acc-dim))" : "transparent",
    color: on ? "var(--txt)" : "var(--txt-3, var(--txt3))", font: "400 12px var(--font)", whiteSpace: "nowrap",
})
const H = { font: "600 10.5px var(--font)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--txt-3, var(--txt3))", margin: "14px 0 6px" }

export default function InterestsEditor() {
    const [it, setIt] = useState(() => getSettings()?.interests || {})
    useEffect(() => subscribeSettings((s) => setIt(s?.interests || {})), [])
    const save = (next) => { setIt(next); updateSetting("interests", next) }
    const toggle = (key, v) => {
        const list = it[key] || []
        save({ ...it, [key]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] })
    }
    const countries = it.countries || []
    return (
        <div>
            <div style={{ font: "400 11.5px/1.6 var(--font)", color: "var(--txt-4, var(--txt4))" }}>
                What you watch decides what Home leads with and what is marked as yours. Your theaters already
                count — add anything they do not cover.
            </div>

            <div style={H}>Regions</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {Object.keys(REGIONS).map((r) => (
                    <button key={r} type="button" style={chip((it.regions || []).includes(r))} onClick={() => toggle("regions", r)}
                            title={REGIONS[r].join(", ")}>{r}</button>
                ))}
            </div>

            <div style={H}>Countries</div>
            <PlacePicker label="Add a country" placeholder="Add a country — Yemen, Sudan, Taiwan…"
                         onPick={(p) => { if (p.sub === "Country" && !countries.includes(p.label)) save({ ...it, countries: [...countries, p.label] }) }} />
            {countries.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
                    {countries.map((c) => (
                        <button key={c} type="button" style={chip(true)} onClick={() => toggle("countries", c)} title="Remove">{c} ✕</button>
                    ))}
                </div>
            )}

            <div style={H}>Topics</div>
            <div style={{ font: "400 11px var(--font)", color: "var(--txt-4, var(--txt4))", marginBottom: 6 }}>
                A critical signal on a topic you follow is yours wherever it happens.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {Object.entries(TOPICS).map(([k, t]) => (
                    <button key={k} type="button" style={chip((it.topics || []).includes(k))} onClick={() => toggle("topics", k)}>{t.label}</button>
                ))}
            </div>
        </div>
    )
}
