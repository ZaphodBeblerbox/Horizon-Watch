// LoginScreen.jsx — real authentication round. Real email/password form
// against the real POST /api/auth/login, real error state on a real 401
// (never a fabricated success). Blocks the real app shell from rendering
// until a real session exists — see app.jsx's boot sequence.
import { useState } from "react"
import { login } from "../state/authStore.js"

export default function LoginScreen({ onLoggedIn }) {
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState(null)
    const [submitting, setSubmitting] = useState(false)

    async function handleSubmit(e) {
        e.preventDefault()
        setError(null)
        const trimmedEmail = email.trim()
        if (!trimmedEmail || !password) {
            setError("Enter both email and password.")
            return
        }
        setSubmitting(true)
        try {
            const user = await login(trimmedEmail, password)
            onLoggedIn?.(user)
        } catch (err) {
            setError(err?.message || "Login failed.")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div style={{
            position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--bg-0, #171b20)", fontFamily: "var(--font, system-ui)",
        }}>
            <form onSubmit={handleSubmit} style={{
                width: 320, padding: 28, background: "var(--bg-2, #22282f)",
                border: "1px solid var(--line, #30373f)", borderRadius: "var(--r, 2px)",
                display: "flex", flexDirection: "column", gap: 12,
            }}>
                <div style={{ font: "600 15px var(--font)", color: "var(--txt, #d5dae0)", marginBottom: 4 }}>Horizon Watch</div>
                <div style={{ font: "400 12px var(--font)", color: "var(--txt-3, #818c96)", marginBottom: 8 }}>Sign in to continue</div>
                <input
                    type="email" placeholder="Email" value={email} autoFocus
                    onChange={(e) => setEmail(e.target.value)}
                    className="input"
                    style={{ padding: "8px 10px", font: "400 13px var(--font)" }}
                />
                <input
                    type="password" placeholder="Password" value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input"
                    style={{ padding: "8px 10px", font: "400 13px var(--font)" }}
                />
                {error && (
                    <div style={{ font: "400 12px var(--font)", color: "var(--red, #c4453c)" }}>{error}</div>
                )}
                <button type="submit" className="btn primary" disabled={submitting} style={{ marginTop: 4, padding: "8px 0" }}>
                    {submitting ? "Signing in…" : "Sign in"}
                </button>
            </form>
        </div>
    )
}
