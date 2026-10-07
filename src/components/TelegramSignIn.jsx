/**
 * TelegramSignIn.jsx — sign the server's Telegram account in, from Settings.
 *
 * The server has no terminal to answer Telegram's prompts. A super admin
 * gives the account's phone number, Telegram sends a code to that account's
 * app, and the code (plus the two-step password, if one is set) finishes
 * the sign-in. The session is kept on the server; collection starts on the
 * next pass (backend: telegram_ingest.login_start / login_code).
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import { getCurrentUser, subscribeAuth } from "../state/authStore.js"

const INPUT = { height: 30, padding: "0 8px", border: "1px solid var(--gline2)", background: "transparent", color: "var(--txt)",
                font: "inherit", fontSize: 13, borderRadius: 0, minWidth: 0 }
const BTN = { height: 30, padding: "0 14px", border: 0, background: "var(--acc)", color: "var(--mz-cream)", font: "inherit",
              fontSize: 13, fontWeight: 600, cursor: "pointer", borderRadius: 0 }

const call = (path, body) => fetch(`${API_BASE}/api/telegram/login${path}`, {
    method: body ? "POST" : "GET", credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
}).then((r) => r.json())

export default function TelegramSignIn() {
    const [user, setUser] = useState(() => getCurrentUser())
    useEffect(() => subscribeAuth(setUser), [])
    const [st, setSt] = useState(null)
    const [phone, setPhone] = useState("")
    const [code, setCode] = useState("")
    const [password, setPassword] = useState("")
    const [step, setStep] = useState("phone")      // phone | code | password
    const [busy, setBusy] = useState(false)
    const [msg, setMsg] = useState(null)

    const load = () => call("").then(setSt).catch(() => setSt({ error: "could not reach the server" }))
    useEffect(() => { if (user?.is_super_admin) load() }, [user?.is_super_admin])
    if (!user?.is_super_admin) return null

    const start = async () => {
        setBusy(true); setMsg(null)
        const r = await call("/start", { phone }).catch(() => ({ ok: false, error: "could not reach the server" }))
        setBusy(false)
        if (r.ok) { setStep("code"); setMsg("Telegram has sent a code to the account's Telegram app.") } else setMsg(r.error)
    }
    const finish = async () => {
        setBusy(true); setMsg(null)
        const r = await call("/code", { code, password: password || null }).catch(() => ({ ok: false, error: "could not reach the server" }))
        setBusy(false)
        if (r.ok) { setStep("phone"); setCode(""); setPassword(""); setMsg(`Signed in as ${r.account}. Collection starts within a minute.`); load() }
        else if (r.need_password) { setStep("password"); setMsg(r.error || "This account has two-step verification: enter its password.") }
        else setMsg(r.error)
    }

    return (
        <div style={{ border: "1px solid var(--gline)", padding: "14px 16px", marginBottom: 16 }}>
            <div style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)", marginBottom: 6 }}>
                Telegram on this server</div>
            {!st ? <div style={{ fontSize: 13, color: "var(--txt3)" }}>Checking…</div>
                : st.configured === false ? <div style={{ fontSize: 13, color: "var(--txt2)" }}>The server has no Telegram API credentials (TELEGRAM_API_ID, TELEGRAM_API_HASH).</div>
                : st.signed_in ? <div style={{ fontSize: 13, color: "var(--txt2)" }}>Signed in as <b>{st.account}</b>. Channels the account has joined are read every minute.</div>
                : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ fontSize: 13, color: "var(--txt2)", lineHeight: 1.5 }}>
                            Not signed in, so nothing is collected from Telegram. Sign in with the account that has joined the channels.
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {step === "phone" && <>
                                <input style={{ ...INPUT, width: 220 }} placeholder="+49 176 12345678" value={phone} onChange={(e) => setPhone(e.target.value)} />
                                <button style={BTN} disabled={busy} onClick={start}>{busy ? "Sending…" : "Send code"}</button>
                            </>}
                            {step !== "phone" && <>
                                <input style={{ ...INPUT, width: 140 }} placeholder="code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
                                {step === "password" && <input style={{ ...INPUT, width: 200 }} type="password" placeholder="two-step password" value={password} onChange={(e) => setPassword(e.target.value)} />}
                                <button style={BTN} disabled={busy} onClick={finish}>{busy ? "Signing in…" : "Sign in"}</button>
                                <button style={{ ...BTN, background: "transparent", color: "var(--txt3)", border: "1px solid var(--gline2)" }} onClick={() => { setStep("phone"); setMsg(null) }}>Start again</button>
                            </>}
                        </div>
                    </div>
                )}
            {msg && <div style={{ fontSize: 12.5, color: "var(--txt2)", marginTop: 8 }}>{msg}</div>}
        </div>
    )
}
