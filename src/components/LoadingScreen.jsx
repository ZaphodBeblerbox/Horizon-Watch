import { useEffect, useState } from "react"
import Logo from "./Logo"

const steps = [
    "Initialising intelligence feeds",
    "Connecting data sources",
    "Loading infrastructure database",
    "Calibrating geospatial engine",
    "Establishing secure connection",
    "Ready"
]

export default function LoadingScreen({ onComplete }) {
    const [phase,   setPhase]   = useState(0)
    const [stepIdx, setStepIdx] = useState(0)
    const [progress,setProgress]= useState(0)
    const [visible, setVisible] = useState(true)

    useEffect(() => {
        const t1 = setTimeout(() => setPhase(1), 600)
        const t2 = setTimeout(() => setPhase(2), 1800)
        const t3 = setTimeout(() => setPhase(3), 3000)
        const t4 = setTimeout(() => {
            setVisible(false)
            setTimeout(onComplete, 600)
        }, 4200)

        // Progress bar over 2.4s starting at phase 1
        const t5 = setTimeout(() => {
            let p = 0
            const iv = setInterval(() => {
                p += 2
                setProgress(p)
                if (p >= 100) clearInterval(iv)
            }, 48)
        }, 600)

        // Step text cycling
        const t6 = setTimeout(() => {
            let i = 0
            const iv = setInterval(() => {
                i++
                setStepIdx(i)
                if (i >= steps.length - 1) clearInterval(iv)
            }, 400)
        }, 600)

        return () => [t1, t2, t3, t4, t5, t6].forEach(clearTimeout)
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div style={{
            position:       "fixed",
            inset:          0,
            zIndex:         9999,
            background:     "#060d1a",
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            flexDirection:  "column",
            opacity:        visible ? 1 : 0,
            transition:     "opacity 0.6s ease-in",
            overflow:       "hidden",
        }}>
            {/* Starfield */}
            {Array.from({ length: 40 }).map((_, i) => (
                <div key={i} style={{
                    position:        "absolute",
                    width:           i % 3 === 0 ? 2 : 1,
                    height:          i % 3 === 0 ? 2 : 1,
                    background:      "white",
                    borderRadius:    "50%",
                    left:            `${(i * 37 + 11) % 100}%`,
                    top:             `${(i * 23 + 7) % 100}%`,
                    opacity:         0.1 + (i % 4) * 0.08,
                    animation:       `drift${i % 5} ${8 + (i % 7)}s ease-in-out infinite`,
                    animationDelay:  `${(i % 6) * -1.3}s`,
                }} />
            ))}

            {/* Main content */}
            <div style={{
                display:        "flex",
                flexDirection:  "column",
                alignItems:     "center",
                gap:            0,
                position:       "relative",
                zIndex:         2,
            }}>

                {/* Title — fades in phase 1 */}
                <div style={{
                    opacity:    phase >= 1 ? 1 : 0,
                    transition: "opacity 1.4s ease-in",
                    textAlign:  "center",
                    marginBottom: 32,
                }}>
                    <div style={{
                        fontSize:      32,
                        fontWeight:    700,
                        letterSpacing: "0.28em",
                        color:         "white",
                        textTransform: "uppercase",
                        fontFamily:    "Inter, -apple-system, sans-serif",
                    }}>
                        HORIZON WATCH
                    </div>
                    <div style={{
                        fontSize:      10,
                        letterSpacing: "0.2em",
                        color:         "rgba(255,255,255,0.35)",
                        textTransform: "uppercase",
                        marginTop:     8,
                    }}>
                        by Trifecta Technologies
                    </div>
                </div>

                {/* Logo — rises in phase 2 */}
                <div style={{
                    opacity:    phase >= 2 ? 1 : 0,
                    transform:  phase >= 2 ? "translateY(0)" : "translateY(24px)",
                    transition: "opacity 0.8s ease-out, transform 0.8s ease-out",
                    filter:     phase >= 2 ? "drop-shadow(0 0 20px rgba(255,255,255,0.3))" : "none",
                    marginBottom: 40,
                }}>
                    <Logo size={100} />
                </div>

                {/* Progress bar */}
                <div style={{
                    opacity:    phase >= 1 ? 1 : 0,
                    transition: "opacity 0.8s",
                    width:      200,
                    display:    "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap:        10,
                }}>
                    <div style={{
                        width:        "100%",
                        height:       1.5,
                        background:   "rgba(255,255,255,0.08)",
                        borderRadius: 2,
                    }}>
                        <div style={{
                            height:     "100%",
                            width:      `${progress}%`,
                            background: "linear-gradient(90deg, #1a6eb5, #2d8fe8)",
                            borderRadius: 2,
                            transition: "width 0.05s linear",
                        }} />
                    </div>
                    <div style={{
                        fontSize:      11,
                        color:         "rgba(255,255,255,0.3)",
                        letterSpacing: "0.08em",
                        height:        16,
                    }}>
                        {steps[stepIdx]}
                    </div>
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
