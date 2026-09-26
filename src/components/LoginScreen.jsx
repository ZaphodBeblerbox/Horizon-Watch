// LoginScreen.jsx — real authentication round. Real email/password form
// against the real POST /api/auth/login, real error state on a real 401
// (never a fabricated success). Blocks the real app shell from rendering
// until a real session exists — see app.jsx's boot sequence.
//
// The sign-in succeeds, then the screen fades rather than cutting. The cut
// was jarring because the login panel and the app behind it share nothing
// visually: one frame you are looking at a small card on an empty field,
// the next at a full globe. The fade also covers the moment the shell
// spends mounting, which was previously a flash of half-built UI.
import { useState } from "react"
import { login } from "../state/authStore.js"
import { ParallaxMark } from "../print/PageFrame.jsx"

const FADE_MS = 620

export default function LoginScreen({ onLoggedIn, offline = false }) {
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState(null)
    const [submitting, setSubmitting] = useState(false)
    const [leaving, setLeaving] = useState(false)

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
            // Fade first, hand over after. onLoggedIn unmounts this
            // component, so calling it immediately would remove the thing
            // that is supposed to be fading.
            setLeaving(true)
            setTimeout(() => onLoggedIn?.(user), FADE_MS)
        } catch (err) {
            const msg = err?.message || "Login failed."
            setError(offline && /enrol|expired|no record/i.test(msg)
                ? "This machine can't sign you in offline — connect to the server once first."
                : msg)
            setSubmitting(false)
        }
        // NOT in a finally: on success the button must stay in its
        // signing-in state through the fade, or it flicks back to "Sign in"
        // while the screen is dissolving.
    }

    return (
        <div
            style={{
                position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                background: "var(--bg-0, #171b20)", fontFamily: "var(--font, system-ui)",
                opacity: leaving ? 0 : 1,
                transform: leaving ? "scale(1.02)" : "none",
                transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
                pointerEvents: leaving ? "none" : "auto",
                zIndex: 200,
            }}
        >
            <style>{`
                @keyframes lg-spin { to { transform: rotate(360deg) } }
                @media (prefers-reduced-motion: reduce) {
                    .lg-spinner { animation: none !important }
                }
            `}</style>

            <form onSubmit={handleSubmit} style={{
                width: 340, padding: "34px 30px 28px", background: "var(--bg-2, #22282f)",
                border: "1px solid var(--line, #30373f)", borderRadius: "var(--r, 2px)",
                display: "flex", flexDirection: "column", gap: 12,
            }}>
                {/* The mark at a size that reads as identity rather than as
                    a label — this is the first thing anyone sees of the
                    product. */}
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
                    <LoginMark />
                </div>
                <div style={{
                    font: "400 11px var(--font)", color: "var(--txt-3, #818c96)",
                    textAlign: "center", letterSpacing: ".1em", textTransform: "uppercase",
                    marginBottom: 12,
                }}>
                    Trifecta Technologies
                </div>

                {/* SAY THAT THE SERVER IS NOT THERE. Without this the form
                    looks like an ordinary login that happens to accept the
                    password, and the reader has no idea they are on a local
                    grant with stale data behind it. */}
                {offline && (
                    <div style={{
                        font: "400 11px/1.55 var(--font)", color: "var(--txt-3, #818c96)",
                        background: "var(--bg-0, #171b20)", border: "1px solid var(--line, #30373f)",
                        borderRadius: 3, padding: "8px 10px", marginBottom: 4,
                    }}>
                        <b style={{ color: "var(--txt-2, #b6bec6)" }}>Working offline.</b> The server
                        cannot be reached, so this signs you in against this machine&rsquo;s stored
                        credentials. You&rsquo;ll see the data this machine already has.
                    </div>
                )}

                <input
                    type="email" placeholder="Email" value={email} autoFocus
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    className="input"
                    style={{ padding: "8px 10px", font: "400 13px var(--font)" }}
                />
                <input
                    type="password" placeholder="Password" value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                    className="input"
                    style={{ padding: "8px 10px", font: "400 13px var(--font)" }}
                />
                {error && (
                    <div role="alert" style={{ font: "400 12px var(--font)", color: "var(--red, #c4453c)" }}>{error}</div>
                )}
                <button type="submit" className="btn primary" disabled={submitting}
                        style={{
                            marginTop: 4, padding: "8px 0", display: "flex",
                            alignItems: "center", justifyContent: "center", gap: 8,
                        }}>
                    {submitting && (
                        <span
                            className="lg-spinner"
                            aria-hidden="true"
                            style={{
                                width: 12, height: 12, borderRadius: "50%",
                                border: "1.6px solid currentColor", borderTopColor: "transparent",
                                animation: "lg-spin .7s linear infinite", flexShrink: 0,
                            }}
                        />
                    )}
                    {submitting ? "Signing in…" : "Sign in"}
                </button>
            </form>
        </div>
    )
}

/* The Echo X at title size, with the wordmark under it. ParallaxMark is
   built for a document line, so this lays the two out vertically instead of
   scaling a lockup that was designed to sit inline. */
function LoginMark() {
    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <svg width="58" height="58" viewBox="0 0 24 24" fill="none"
                 strokeWidth="2.2" strokeLinecap="butt" aria-hidden="true">
                <path stroke="var(--txt, #d5dae0)" d="M3 4L14 20M14 4L3 20" />
                <path stroke="var(--acc-hi, #5f95d0)" d="M18 4L12.5 12M22 4L19.25 8" />
            </svg>
            <span style={{
                font: "700 19px var(--font)", color: "var(--txt, #d5dae0)",
                letterSpacing: ".22em", textTransform: "uppercase", lineHeight: 1,
            }}>Parallax</span>
        </div>
    )
}

export { FADE_MS }
