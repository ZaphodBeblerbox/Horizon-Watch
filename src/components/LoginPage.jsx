import { useState } from "react"
import Logo from "./Logo"
import { setToken, apiFetch } from "../auth.js"

const STARS = Array.from({ length: 30 }, (_, i) => ({
    left:   `${(i * 41 + 7) % 100}%`,
    top:    `${(i * 29 + 13) % 100}%`,
    size:   i % 4 === 0 ? 2 : 1,
    opacity: 0.08 + (i % 5) * 0.06,
    anim:   `drift${i % 5}`,
    dur:    `${9 + (i % 6)}s`,
    delay:  `${(i % 7) * -1.1}s`,
}))

export default function LoginPage({ onAuthenticated }) {
    const [mode,     setMode]     = useState("login")   // login | register | forgot | forgot_sent
    const [email,    setEmail]    = useState("")
    const [password, setPassword] = useState("")
    const [name,     setName]     = useState("")
    const [showPw,   setShowPw]   = useState(false)
    const [loading,  setLoading]  = useState(false)
    const [error,    setError]    = useState("")
    const [info,     setInfo]     = useState("")

    async function handleLogin(e) {
        e.preventDefault()
        if (!email.trim() || !password) return
        setLoading(true); setError("")
        try {
            const res = await apiFetch("/api/auth/login", {
                method: "POST",
                body: JSON.stringify({ email: email.trim(), password }),
            })
            const data = await res.json()
            if (!res.ok) { setError(data.detail || "Login failed"); return }
            setToken(data.access_token)
            onAuthenticated(data.user)
        } catch {
            setError("Connection error — check backend.")
        } finally {
            setLoading(false)
        }
    }

    async function handleRegister(e) {
        e.preventDefault()
        if (!name.trim() || !email.trim() || !password) return
        setLoading(true); setError("")
        try {
            const res = await apiFetch("/api/auth/register", {
                method: "POST",
                body: JSON.stringify({ email: email.trim(), password, name: name.trim() }),
            })
            const data = await res.json()
            if (!res.ok) { setError(data.detail || "Registration failed"); return }
            setInfo("Account created. Awaiting admin approval.")
            setMode("login")
        } catch {
            setError("Connection error — check backend.")
        } finally {
            setLoading(false)
        }
    }

    async function handleForgot(e) {
        e.preventDefault()
        if (!email.trim()) return
        setLoading(true); setError("")
        try {
            await apiFetch("/api/auth/forgot-password", {
                method: "POST",
                body: JSON.stringify({ email: email.trim() }),
            })
            setMode("forgot_sent")
        } catch {
            setError("Connection error.")
        } finally {
            setLoading(false)
        }
    }

    const inputStyle = {
        width:        "100%",
        background:   "rgba(255,255,255,0.06)",
        border:       "1px solid rgba(255,255,255,0.12)",
        borderRadius: 6,
        padding:      "10px 12px",
        fontSize:     13,
        color:        "#fff",
        outline:      "none",
        boxSizing:    "border-box",
        fontFamily:   "Inter, -apple-system, sans-serif",
    }

    const btnStyle = {
        width:        "100%",
        padding:      "10px 0",
        borderRadius: 6,
        border:       "none",
        background:   loading ? "rgba(26,110,181,0.4)" : "rgba(26,110,181,0.85)",
        color:        "#fff",
        fontSize:     13,
        fontWeight:   600,
        letterSpacing:"0.06em",
        cursor:       loading ? "default" : "pointer",
        transition:   "background 0.2s",
        marginTop:    4,
    }

    return (
        <div style={{
            position:       "fixed",
            inset:          0,
            background:     "#060d1a",
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            zIndex:         9998,
            fontFamily:     "Inter, -apple-system, sans-serif",
            overflow:       "hidden",
        }}>
            {/* Starfield */}
            {STARS.map((s, i) => (
                <div key={i} style={{
                    position:       "absolute",
                    width:          s.size,
                    height:         s.size,
                    background:     "white",
                    borderRadius:   "50%",
                    left:           s.left,
                    top:            s.top,
                    opacity:        s.opacity,
                    animation:      `${s.anim} ${s.dur} ease-in-out infinite`,
                    animationDelay: s.delay,
                    pointerEvents:  "none",
                }} />
            ))}

            {/* Card */}
            <div style={{
                position:     "relative",
                zIndex:       2,
                width:        400,
                background:   "rgba(10,16,28,0.85)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border:       "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12,
                padding:      "36px 32px 28px",
                boxShadow:    "0 8px 32px rgba(0,0,0,0.5)",
            }}>

                {/* Logo */}
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
                    <Logo size={60} />
                </div>

                {/* Title */}
                <div style={{ textAlign: "center", marginBottom: 28 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "0.18em", color: "white", textTransform: "uppercase" }}>
                        HORIZON WATCH
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.14em", marginTop: 5, textTransform: "uppercase" }}>
                        {mode === "login"       ? "Sign in to continue" :
                         mode === "register"    ? "Request access" :
                         mode === "forgot"      ? "Password reset" :
                                                  "Check your inbox"}
                    </div>
                </div>

                {/* Info banner */}
                {info && (
                    <div style={{ background: "rgba(26,110,181,0.2)", border: "1px solid rgba(26,110,181,0.4)", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "rgba(255,255,255,0.7)", marginBottom: 16, lineHeight: 1.5 }}>
                        {info}
                    </div>
                )}

                {/* Forgot sent */}
                {mode === "forgot_sent" && (
                    <div style={{ textAlign: "center", color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 1.7, marginBottom: 20 }}>
                        If an account exists for <strong style={{ color: "white" }}>{email}</strong>, a reset link has been sent.
                        <br />Check your inbox.
                    </div>
                )}

                {/* Login form */}
                {mode === "login" && (
                    <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <input
                            type="email"
                            placeholder="Email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            autoFocus
                            style={inputStyle}
                        />
                        <div style={{ position: "relative" }}>
                            <input
                                type={showPw ? "text" : "password"}
                                placeholder="Password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                style={{ ...inputStyle, paddingRight: 40 }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPw(v => !v)}
                                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 12, padding: 0 }}
                            >
                                {showPw ? "HIDE" : "SHOW"}
                            </button>
                        </div>
                        {error && <div style={{ fontSize: 11, color: "#f87171", marginTop: -4 }}>{error}</div>}
                        <button type="submit" disabled={loading} style={btnStyle}>
                            {loading ? "Signing in…" : "SIGN IN"}
                        </button>
                    </form>
                )}

                {/* Register form */}
                {mode === "register" && (
                    <form onSubmit={handleRegister} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <input
                            type="text"
                            placeholder="Full name"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            required
                            autoFocus
                            style={inputStyle}
                        />
                        <input
                            type="email"
                            placeholder="Email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            style={inputStyle}
                        />
                        <div style={{ position: "relative" }}>
                            <input
                                type={showPw ? "text" : "password"}
                                placeholder="Password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                style={{ ...inputStyle, paddingRight: 40 }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPw(v => !v)}
                                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 12, padding: 0 }}
                            >
                                {showPw ? "HIDE" : "SHOW"}
                            </button>
                        </div>
                        {error && <div style={{ fontSize: 11, color: "#f87171", marginTop: -4 }}>{error}</div>}
                        <button type="submit" disabled={loading} style={btnStyle}>
                            {loading ? "Submitting…" : "REQUEST ACCESS"}
                        </button>
                    </form>
                )}

                {/* Forgot password form */}
                {mode === "forgot" && (
                    <form onSubmit={handleForgot} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <input
                            type="email"
                            placeholder="Your account email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            autoFocus
                            style={inputStyle}
                        />
                        {error && <div style={{ fontSize: 11, color: "#f87171", marginTop: -4 }}>{error}</div>}
                        <button type="submit" disabled={loading} style={btnStyle}>
                            {loading ? "Sending…" : "SEND RESET LINK"}
                        </button>
                    </form>
                )}

                {/* Footer links */}
                <div style={{ marginTop: 20, display: "flex", justifyContent: "center", gap: 20 }}>
                    {mode !== "login" && mode !== "forgot_sent" && (
                        <button onClick={() => { setMode("login"); setError(""); setInfo("") }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", fontSize: 11, cursor: "pointer", padding: 0 }}>
                            Back to sign in
                        </button>
                    )}
                    {(mode === "login" || mode === "forgot_sent") && (
                        <button onClick={() => { setMode("forgot"); setError("") }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", fontSize: 11, cursor: "pointer", padding: 0 }}>
                            Forgot password
                        </button>
                    )}
                    {(mode === "login" || mode === "forgot_sent") && (
                        <button onClick={() => { setMode("register"); setError("") }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", fontSize: 11, cursor: "pointer", padding: 0 }}>
                            Request access
                        </button>
                    )}
                </div>
            </div>

            <style>{`
                @keyframes drift0 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(12px,-8px)} }
                @keyframes drift1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-10px,14px)} }
                @keyframes drift2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(8px,10px)} }
                @keyframes drift3 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-14px,-6px)} }
                @keyframes drift4 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(6px,-12px)} }
            `}</style>
        </div>
    )
}
