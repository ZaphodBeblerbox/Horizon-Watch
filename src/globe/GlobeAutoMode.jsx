// Intelligent autoplay — camera routes only to active intelligence signals.
// Priority: escalating zones → fusion events → sanctions/STS → surges → tier 1 news
// Replaces the old random-event globe spin.

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useCesium } from "resium"
import { Cartesian3, EasingFunction, Math as CesiumMath } from "cesium"
import { buildAutoplayQueue, AUTOPLAY_SEGMENT_DURATION } from "../services/autoplayer.js"
import AutoplayInfoCard from "../components/AutoplayInfoCard.jsx"
import API_BASE from "../apiBase.js"

export default function GlobeAutoMode({ enabled }) {
    const { viewer } = useCesium()

    const cancelRef         = useRef(false)
    const timerRef          = useRef(null)
    const queueRef          = useRef([])
    const indexRef          = useRef(0)
    const viewerRef         = useRef(null)
    const rotationHandleRef = useRef(null)

    const [queue,   setQueue]   = useState([])
    const [index,   setIndex]   = useState(0)
    const [loading, setLoading] = useState(false)

    // Keep a stable ref to the viewer so the interval callback can access it
    useEffect(() => { viewerRef.current = viewer }, [viewer])

    const startRotation = (vwr) => {
        clearInterval(rotationHandleRef.current)
        rotationHandleRef.current = setInterval(() => {
            if (vwr?.scene) vwr.camera.rotate(Cartesian3.UNIT_Z, -0.003)
        }, 16)
    }

    const flyToSegment = (seg, vwr) => {
        if (!seg || !vwr) return
        clearInterval(rotationHandleRef.current)
        try {
            const isNews = seg.type === 'NEWS'
            vwr.camera.flyTo({
                destination: Cartesian3.fromDegrees(seg.lon, seg.lat, seg.altitude),
                orientation: {
                    heading: CesiumMath.toRadians(0),
                    pitch:   seg.altitude > 5_000_000
                        ? CesiumMath.toRadians(-90)
                        : CesiumMath.toRadians(-75),
                    roll: 0,
                },
                duration:       isNews ? 3.5 : 2.8,
                easingFunction: EasingFunction.SINUSOIDAL_IN_OUT,
                complete:       () => { startRotation(vwr) },
            })
        } catch (_) {}
    }

    useEffect(() => {
        if (!enabled || !viewer) {
            clearInterval(timerRef.current)
            clearInterval(rotationHandleRef.current)
            cancelRef.current = true
            setQueue([])
            setIndex(0)
            indexRef.current = 0
            return
        }

        cancelRef.current = false
        setLoading(true)

        buildAutoplayQueue(API_BASE).then(q => {
            if (cancelRef.current) { setLoading(false); return }
            if (!q.length) { setLoading(false); return }

            queueRef.current  = q
            indexRef.current  = 0
            setQueue(q)
            setIndex(0)
            setLoading(false)

            flyToSegment(q[0], viewer)

            clearInterval(timerRef.current)
            timerRef.current = setInterval(() => {
                if (cancelRef.current) return
                const cur  = queueRef.current
                const i    = indexRef.current
                const next = (i + 1) % cur.length

                indexRef.current = next
                setIndex(next)
                flyToSegment(cur[next], viewerRef.current)

                // Rebuild the queue every full cycle so data stays fresh
                if (next === 0) {
                    buildAutoplayQueue(API_BASE).then(newQ => {
                        if (!cancelRef.current && newQ.length) {
                            queueRef.current = newQ
                            setQueue(newQ)
                        }
                    }).catch(() => {})
                }
            }, AUTOPLAY_SEGMENT_DURATION)
        }).catch(() => setLoading(false))

        return () => {
            cancelRef.current = true
            clearInterval(timerRef.current)
            clearInterval(rotationHandleRef.current)
        }
    }, [enabled, viewer]) // eslint-disable-line react-hooks/exhaustive-deps

    if (!enabled) return null

    const currentSeg = queue[index] || null

    return createPortal(
        <>
            {loading && (
                <div style={{
                    position:       'fixed',
                    bottom:         48,
                    right:          16,
                    color:          'rgba(0,212,255,0.75)',
                    fontFamily:     '"IBM Plex Mono", monospace',
                    fontSize:       11,
                    background:     'rgb(5, 10, 20)',
                    padding:        '8px 14px',
                    borderRadius:   4,
                    border:         '1px solid rgba(0,212,255,0.2)',
                    zIndex:         190,
                }}>
                    ⟳ Building intelligence queue…
                </div>
            )}
            {!loading && currentSeg && (
                <AutoplayInfoCard
                    segment={currentSeg}
                    index={index}
                    total={queue.length}
                />
            )}
        </>,
        document.body
    )
}
