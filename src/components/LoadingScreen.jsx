import { useEffect, useRef } from "react"
import Logo from "./Logo.jsx"

// Pre-computed star positions (deterministic, looks random)
const STARS = Array.from({ length: 40 }, (_, i) => ({
    x:       ((i * 37 + 13) % 97) / 97 * 100,
    y:       ((i * 53 +  7) % 89) / 89 * 100,
    size:    1 + ((i * 11) % 12) / 12,
    opacity: 0.1 + ((i * 17) % 31) / 100,
    drift:   (i % 6) + 1,
    dur:     15 + (i *  7) % 20,
    delay:   -((i * 11) % 30),
}))

const CSS = `
@keyframes hwDrift1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(8px,-6px)} }
@keyframes hwDrift2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-5px,9px)} }
@keyframes hwDrift3 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(10px,4px)} }
@keyframes hwDrift4 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-8px,-7px)} }
@keyframes hwDrift5 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(6px,10px)} }
@keyframes hwDrift6 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-3px,-10px)} }
@keyframes hwFadeIn  { from{opacity:0} to{opacity:1} }
@keyframes hwRiseUp  { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
@keyframes hwGlow    { 0%,100%{filter:drop-shadow(0 0 8px rgba(13,148,136,0.35))} 50%{filter:drop-shadow(0 0 22px rgba(13,148,136,0.7))} }
@keyframes hwFadeOut { from{opacity:1} to{opacity:0} }
`

export default function LoadingScreen({ onDone }) {
    const doneRef = useRef(onDone)
    doneRef.current = onDone

    useEffect(() => {
        const t = setTimeout(() => doneRef.current?.(), 5100)
        return () => clearTimeout(t)
    }, [])

    return (
        <div style={{
            position:   "fixed",
            inset:      0,
            zIndex:     9999,
            background: "#060a10",
            overflow:   "hidden",
            animation:  "hwFadeOut 1s ease-in 4s forwards",
        }}>
            <style>{CSS}</style>

            {/* Starfield */}
            <div style={{ position: "absolute", inset: 0 }}>
                {STARS.map((s, i) => (
                    <div key={i} style={{
                        position:     "absolute",
                        left:         `${s.x}%`,
                        top:          `${s.y}%`,
                        width:        s.size,
                        height:       s.size,
                        borderRadius: "50%",
                        background:   "#ffffff",
                        opacity:      s.opacity,
                        animation:    `hwDrift${s.drift} ${s.dur}s ease-in-out ${s.delay}s infinite`,
                    }} />
                ))}
            </div>

            {/* Centre content */}
            <div style={{
                position:        "absolute",
                inset:           0,
                display:         "flex",
                flexDirection:   "column",
                alignItems:      "center",
                justifyContent:  "center",
                gap:             36,
            }}>
                {/* Phase 2: text fades in at 0.8s */}
                <div style={{
                    textAlign: "center",
                    animation: "hwFadeIn 1.4s ease-in 0.8s forwards",
                    opacity:   0,
                }}>
                    <div style={{
                        fontSize:      36,
                        fontWeight:    700,
                        letterSpacing: "0.3em",
                        color:         "#e8edf2",
                        fontFamily:    "system-ui, -apple-system, sans-serif",
                        marginBottom:  12,
                    }}>
                        HORIZON WATCH
                    </div>
                    <div style={{
                        fontSize:      11,
                        letterSpacing: "0.2em",
                        color:         "#4a5568",
                        fontFamily:    "monospace",
                        animation:     "hwFadeIn 0.4s ease-in 1.2s forwards",
                        opacity:       0,
                    }}>
                        by Trifecta Technologies
                    </div>
                </div>

                {/* Phase 3: logo rises at 2.2s, glow pulses from 3s */}
                <div style={{
                    animation: "hwRiseUp 0.8s ease-out 2.2s forwards, hwGlow 2s ease-in-out 3s infinite",
                    opacity:   0,
                }}>
                    <Logo size={120} />
                </div>
            </div>
        </div>
    )
}
