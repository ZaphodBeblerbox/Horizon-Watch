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

export default function Team() {
    const [teams, setTeams] = useState([])
    const [membersByTeam, setMembersByTeam] = useState({})

    useEffect(() => {
        getJSON("/api/teams").then(async (rows) => {
            const list = rows || []
            setTeams(list)
            const entries = await Promise.all(list.map(async (t) => [t.id, (await getJSON(`/api/teams/${t.id}/members`)) || []]))
            setMembersByTeam(Object.fromEntries(entries))
        })
    }, [])

    return (
        <div data-testid="view-root-team" style={{ padding: 20, overflowY: "auto", height: "100%", background: "var(--bg-0)" }}>
            <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Roster</div>
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
    )
}
