// Team.jsx — Workstation module (§7.11). Real roster view: this org's
// real team(s) and real members (real authentication round — no invented
// demo people). RFIs/activity/handovers views land in a later pass; this
// pass builds the real roster since the real Team/User data now exists to
// back it.
import { useState, useEffect } from "react"
import API_BASE from "../apiBase.js"

async function getJSON(path) {
    const r = await fetch(`${API_BASE}${path}`, { credentials: "include" })
    if (!r.ok) return null
    return r.json()
}

export default function Team({ onClose = null }) {
    const [teams, setTeams] = useState([])
    const [membersByTeam, setMembersByTeam] = useState({})

    useEffect(() => {
        if (!onClose) return undefined
        const onKey = (e) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [onClose])

    useEffect(() => {
        getJSON("/api/teams").then(async (rows) => {
            const list = rows || []
            setTeams(list)
            const entries = await Promise.all(list.map(async (t) => [t.id, (await getJSON(`/api/teams/${t.id}/members`)) || []]))
            setMembersByTeam(Object.fromEntries(entries))
        })
    }, [])

    return (
        <div data-testid="view-root-team" data-screen-label="Team" style={{
            display: "flex", flexDirection: "column", height: "100%", minHeight: 0,
        }}>
            {/* A WAY OUT. The v6 chrome has no close control for a module —
                the tab bar holds theaters, not modules — so a screen you
                reach deliberately has to carry its own exit or it is a dead
                end. This one was: opened, and then nothing on screen would
                leave it. */}
            <div style={{
                display: "flex", alignItems: "center", gap: 10, height: 40, flex: "none",
                padding: "0 8px 0 16px", borderBottom: "1px solid var(--gline)",
            }}>
                <span style={{
                    fontFamily: "var(--mz-font-mono)", fontWeight: 500, fontSize: 10,
                    letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)",
                }}>Roster</span>
                {onClose && (
                    <button onClick={onClose} title="Close (Esc)" aria-label="Close the roster" style={{
                        marginLeft: "auto", width: 28, height: 28, border: "1px solid var(--gline2)",
                        background: "transparent", color: "var(--txt3)", font: "inherit",
                        cursor: "pointer", borderRadius: 0,
                    }}>✕</button>
                )}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 20 }}>
            {teams.length === 0 && <div style={{ font: "400 12px var(--font)", color: "var(--txt-4)" }}>No real team configured yet.</div>}
            {teams.map((t) => (
                <div key={t.id} style={{ marginBottom: 24 }}>
                    <div style={{ font: "700 15px var(--font)", color: "var(--txt)", marginBottom: 10 }}>{t.name}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {(membersByTeam[t.id] || []).map((u) => (
                            <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: 8, background: "var(--bg-2)", borderRadius: "var(--r)" }}>
                                <div style={{
                                    width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                                    background: u.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                                    font: "700 11px var(--font)",
                                }}>{u.initials}</div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ font: "600 13px var(--font)", color: "var(--txt)" }}>
                                        {u.name}{u.title ? <span style={{ color: "var(--txt-3)", fontWeight: 400 }}> — {u.title}</span> : null}
                                    </div>
                                    <div style={{ font: "400 11px var(--mono)", color: "var(--txt-3)" }}>{u.email}</div>
                                </div>
                                <div style={{ font: "400 10px var(--font)", color: "var(--txt-3)", textAlign: "right" }}>
                                    <div>{u.capability_role || "no capability role"}</div>
                                    <div style={{ color: "var(--txt-4)" }}>{u.timezone}</div>
                                </div>
                            </div>
                        ))}
                        {(membersByTeam[t.id] || []).length === 0 && (
                            <div style={{ font: "400 12px var(--font)", color: "var(--txt-4)" }}>No real members yet.</div>
                        )}
                    </div>
                </div>
            ))}
            </div>
        </div>
    )
}
