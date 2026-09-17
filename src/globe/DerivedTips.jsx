/**
 * DerivedTips.jsx — PARALLAX addendum §A9.
 *
 * Both marks are DERIVED: neither corresponds to a thing anyone reported. So
 * the tooltip owes three answers before the analyst commits to a click.
 *
 *   1. What is this          — the kicker, with the icon and the kind.
 *   2. What makes it true    — the metric strip, or the modality chips.
 *   3. WHICH RECORDS PRODUCED IT — the entity list.
 *
 * The third is the one usually left out, and it is the one that decides
 * whether the finding is believed: a derived mark that cannot name its inputs
 * is asking to be taken on faith.
 */
import { CAT } from "../components/timeStripMath.js"
import { overflowCount, agoStr } from "./derivedMarkGeometry.js"

const MODICON = (m) =>
    m === "confirmation" ? "i-confirm"
    : m === "imagery" ? "i-sat"
    : m === "ais" ? "i-ship"
    : m === "aircraft" ? "i-plane"
    : "i-bell"

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 2)}…` : s || "")

/**
 * §A5's copy discipline, rendered. "A surge is a change in ATTENTION, not a
 * confirmed change on the ground, and the UI must say so every time it renders
 * one."
 */
function challengeText(s) {
    if (s.mult) return `×${s.mult.toFixed(1)} the usual rate here`
    // A multiplier against zero is a lie with a number in it (§A10).
    return "above a cell with no prior activity of this kind"
}

export function SurgeTip({ surge, nowMs }) {
    const cat = CAT[surge.cat] || { name: surge.cat, color: "var(--amber)" }
    const rows = (surge.rows || []).slice(0, 4)
    return (
        <>
            <div className="tipk">
                <svg><use href="#i-surge" /></svg><span>Surge</span>
                <i className="dia" style={{ background: cat.color }} />
                <em>{cat.name}</em>
            </div>
            <b>{String(cat.name).toLowerCase()} reporting surging around {surge.place}</b>
            <p className="tipp">
                Coverage of this kind is running <b>{challengeText(surge)}</b>.
                A change in attention, not a confirmed change on the ground.
            </p>
            <div className="tipm">
                <div><b>{surge.n}</b><span>in {Math.round(surge.window_days ?? 7)} days</span></div>
                <div><b>{Number(surge.expected ?? 0).toFixed(1)}</b><span>expected</span></div>
                <div><b>{Number(surge.p).toExponential(0)}</b><span>p, Poisson</span></div>
            </div>
            <div className="tipe">
                <span className="tipl">Triggered by {(surge.rows || []).length} confirmations</span>
                {rows.map((r) => (
                    <div className="tipr" key={r.id}>
                        <svg><use href="#i-confirm" /></svg>
                        <span>{clip(r.title, 46)}</span>
                        <em>{agoStr(r.ts, nowMs)}</em>
                    </div>
                ))}
                {overflowCount((surge.rows || []).length, 4) > 0 && (
                    <div className="tipmore">+{overflowCount(surge.rows.length, 4)} more · click to open</div>
                )}
            </div>
        </>
    )
}

export function FusionTip({ fusion, nowMs }) {
    const items = (fusion.items || []).slice(0, 5)
    return (
        <>
            <div className="tipk">
                <svg><use href="#i-fusion" /></svg><span>Fusion point</span>
                <em>{fusion.mods.length} modalities</em>
            </div>
            <b>{fusion.mods.length} independent sources converging at {fusion.place}</b>
            <p className="tipp">
                Different <b>kinds</b> of source agree here within {Math.round(fusion.span_h)} hours.
                Two records of the same kind would be a busy week.
            </p>
            <div className="tipmods">
                {fusion.mods.map((m) => (
                    <span className="tipmod" key={m}>
                        <svg><use href={`#${MODICON(m)}`} /></svg>{m}
                    </span>
                ))}
            </div>
            <div className="tipe">
                <span className="tipl">Triggered by {(fusion.items || []).length} records</span>
                {items.map((i, n) => (
                    <div className="tipr" key={`${i.ref}-${n}`}>
                        <svg><use href={`#${MODICON(i.mod)}`} /></svg>
                        <span>{clip(i.label || i.ref, 44)}</span>
                        <em>{agoStr(i.ts, nowMs)}</em>
                    </div>
                ))}
                {overflowCount((fusion.items || []).length, 5) > 0 && (
                    <div className="tipmore">+{overflowCount(fusion.items.length, 5)} more · click to open</div>
                )}
            </div>
            <div className="tiphint">dashed lines show the records that made this point</div>
        </>
    )
}
