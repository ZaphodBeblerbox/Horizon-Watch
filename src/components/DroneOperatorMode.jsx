import { useState, useEffect, useRef, useCallback } from 'react'

const MONO = '"IBM Plex Mono", "Courier New", monospace'

const detColor = (cls) =>
    cls === 'person' ? '#FF2D2D'
    : ['car','truck','bus','motorcycle','bicycle','boat'].includes(cls) ? '#FFB800'
    : '#00D4FF'

const MOCK_DETECTIONS = [
    { id: 1, class: 'person',  confidence: 0.94, bbox: [120, 80,  180, 220], bbox_normalized: [0.094, 0.111, 0.141, 0.306], timestamp: Date.now() },
    { id: 2, class: 'truck',   confidence: 0.87, bbox: [320, 180, 520, 300], bbox_normalized: [0.250, 0.250, 0.406, 0.417], timestamp: Date.now() - 2000 },
    { id: 3, class: 'car',     confidence: 0.91, bbox: [580, 240, 720, 340], bbox_normalized: [0.453, 0.333, 0.563, 0.472], timestamp: Date.now() - 4000 },
    { id: 4, class: 'person',  confidence: 0.79, bbox: [240, 300, 290, 440], bbox_normalized: [0.188, 0.417, 0.227, 0.611], timestamp: Date.now() - 6000 },
]

// ── Canvas helpers ────────────────────────────────────────────────────────────

function drawDetectionBox(ctx, det, W, H) {
    const color = detColor(det.class || 'default')
    const bn = det.bbox_normalized || det.bbox
    if (!bn) return
    const [nx1, ny1, nx2, ny2] = bn
    const x1 = nx1 * W, y1 = ny1 * H
    const x2 = nx2 * W, y2 = ny2 * H
    const bw = x2 - x1, bh = y2 - y1

    const cl = Math.min(bw, bh) * 0.15  // corner length 15% of smaller dim

    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    for (const [cx, cy, dx, dy] of [[x1,y1,1,1],[x2,y1,-1,1],[x1,y2,1,-1],[x2,y2,-1,-1]]) {
        ctx.beginPath()
        ctx.moveTo(cx + dx * cl, cy)
        ctx.lineTo(cx, cy)
        ctx.lineTo(cx, cy + dy * cl)
        ctx.stroke()
    }

    const label = `${(det.class || 'UNK').toUpperCase()}  ${Math.round((det.confidence || 0) * 100)}%`
    ctx.font = `700 9px ${MONO}`
    const lw = ctx.measureText(label).width + 8
    ctx.fillStyle = color + 'EE'
    ctx.beginPath()
    ctx.rect(x1, y1 - 18, lw, 16)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillText(label, x1 + 4, y1 - 6)
}

function formatDuration(ms) {
    const s = Math.floor(ms / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':')
}

// ─────────────────────────────────────────────────────────────────────────────

export default function DroneOperatorMode({ mode, onMinimize, onExpand }) {
    const videoRef      = useRef(null)
    const canvasRef     = useRef(null)
    const hlsRef        = useRef(null)
    const mockTimerRef  = useRef(null)
    const pollTimerRef  = useRef(null)
    const recStartRef   = useRef(null)
    const hudAnimRef    = useRef(null)
    const detectionsRef = useRef([])
    const frameCountRef = useRef(0)

    const [streamStatus,    setStreamStatus]    = useState('idle')
    const [streamError,     setStreamError]     = useState(null)
    const [rtmpUrl,         setRtmpUrl]         = useState('rtmp://192.168.1.20:1935/drone')
    const [hlsUrl,          setHlsUrl]          = useState(null)
    const [showUrlInput,    setShowUrlInput]    = useState(false)
    const [detections,      setDetections]      = useState([])
    const [totalDetections, setTotalDetections] = useState(0)
    const [fps,             setFps]             = useState(0)
    const [aiActive,        setAiActive]        = useState(true)
    const videoDims = { w: 1280, h: 720 }

    // ── Tactical HUD (rAF canvas) ─────────────────────────────────────────────

    const drawHUD = useCallback((dets) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        const W = canvas.width   // 1280
        const H = canvas.height  // 720

        ctx.clearRect(0, 0, W, H)

        // Scanlines — drawn first, behind everything
        ctx.fillStyle = 'rgba(0,0,0,0.03)'
        for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1)

        // Rule-of-thirds grid — cyan tint
        ctx.strokeStyle = 'rgba(0,212,255,0.04)'
        ctx.lineWidth = 1
        for (let i = 1; i < 3; i++) {
            ctx.beginPath(); ctx.moveTo(W * i/3, 0); ctx.lineTo(W * i/3, H); ctx.stroke()
        }
        for (let i = 1; i < 3; i++) {
            ctx.beginPath(); ctx.moveTo(0, H * i/3); ctx.lineTo(W, H * i/3); ctx.stroke()
        }
        // Diagonal depth lines
        ctx.strokeStyle = 'rgba(0,212,255,0.02)'
        ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(W,H); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(W,0); ctx.lineTo(0,H); ctx.stroke()

        // Tactical crosshair
        const cx = W/2, cy = H/2
        ctx.strokeStyle = 'rgba(0,212,255,0.3)'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI*2); ctx.stroke()
        ctx.strokeStyle = 'rgba(0,212,255,0.6)'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI*2); ctx.stroke()
        ctx.strokeStyle = 'rgba(0,212,255,0.5)'
        ctx.lineWidth = 1.5
        const gaps = [[0,-1],[1,0],[0,1],[-1,0]]
        for (const [dx,dy] of gaps) {
            const ix = cx + dx*8, iy = cy + dy*8
            ctx.beginPath()
            ctx.moveTo(ix + dx*6, iy + dy*6)
            ctx.lineTo(ix + dx*18, iy + dy*18)
            ctx.stroke()
        }
        // Tick marks at clock positions
        ctx.strokeStyle = 'rgba(0,212,255,0.4)'
        ctx.lineWidth = 1
        for (const a of [0, Math.PI/2, Math.PI, Math.PI*1.5]) {
            ctx.beginPath()
            ctx.moveTo(cx + Math.cos(a)*22, cy + Math.sin(a)*22)
            ctx.lineTo(cx + Math.cos(a)*26, cy + Math.sin(a)*26)
            ctx.stroke()
        }

        // Corner brackets
        ctx.strokeStyle = 'rgba(0,212,255,0.2)'
        ctx.lineWidth = 1.5
        for (const [x, y, dx, dy] of [[20,20,1,1],[W-20,20,-1,1],[20,H-20,1,-1],[W-20,H-20,-1,-1]]) {
            ctx.beginPath()
            ctx.moveTo(x + dx*40, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy*40)
            ctx.stroke()
        }

        // ── Top bar (32px) ──────────────────────────────────────────────────
        ctx.fillStyle = 'rgba(5,10,20,0.75)'
        ctx.fillRect(0, 0, W, 32)

        ctx.fillStyle = '#00D4FF'
        ctx.font = `700 10px ${MONO}`
        if ('letterSpacing' in ctx) ctx.letterSpacing = '2px'
        ctx.fillText('◈ HW-DRONE-01', 14, 20)
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'

        // Blinking REC
        if (Math.floor(Date.now() / 1000) % 2 === 0) {
            ctx.fillStyle = '#FF2D2D'
            ctx.beginPath(); ctx.arc(W/2 - 44, 16, 4, 0, Math.PI*2); ctx.fill()
        }
        const recTime = recStartRef.current ? formatDuration(Date.now() - recStartRef.current) : '00:00:00'
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.font = `700 11px ${MONO}`
        ctx.textAlign = 'center'
        ctx.fillText(`REC  ${recTime}`, W/2, 20)

        ctx.textAlign = 'right'
        ctx.fillStyle = '#FFB800'
        ctx.font = `10px ${MONO}`
        ctx.fillText(`${new Date().toUTCString().slice(-12, -4)} UTC`, W - 14, 20)
        ctx.textAlign = 'left'

        // ── Bottom bar (28px) ───────────────────────────────────────────────
        ctx.fillStyle = 'rgba(5,10,20,0.75)'
        ctx.fillRect(0, H - 28, W, 28)

        ctx.fillStyle = 'rgba(255,255,255,0.3)'
        ctx.font = `9px ${MONO}`
        ctx.fillText('DRONE-01', 14, H - 9)

        const detCount = (dets || []).length
        ctx.textAlign = 'center'
        ctx.fillStyle = detCount > 0 ? '#FFB800' : 'rgba(255,255,255,0.2)'
        ctx.font = `700 10px ${MONO}`
        ctx.fillText(
            detCount > 0 ? `${detCount} TARGET${detCount !== 1 ? 'S' : ''} ACQUIRED` : 'NO TARGETS',
            W/2, H - 9
        )

        // AI status with blinking dot
        ctx.textAlign = 'right'
        if (aiActive && Math.floor(Date.now() / 1000) % 2 === 0) {
            ctx.fillStyle = '#00D4FF'
            ctx.beginPath(); ctx.arc(W - 88, H - 13, 3, 0, Math.PI*2); ctx.fill()
        }
        ctx.fillStyle = aiActive ? '#00D4FF' : 'rgba(255,255,255,0.2)'
        ctx.font = `700 9px ${MONO}`
        ctx.fillText(aiActive ? '◉ AI ACTIVE' : '○ AI OFF', W - 14, H - 9)
        ctx.textAlign = 'left'

        // ── Telemetry panel (sharp rect, top-right) ─────────────────────────
        const px = W - 116, py = 42, pw = 102, ph = 92
        ctx.fillStyle = 'rgba(5,10,20,0.8)'
        ctx.fillRect(px, py, pw, ph)
        ctx.strokeStyle = 'rgba(0,212,255,0.15)'
        ctx.lineWidth = 1
        ctx.strokeRect(px, py, pw, ph)

        const tRows = [['ZOOM','1.0×'],['ALT','—  m'],['SPD','—  kts'],['HDG','—  °']]
        tRows.forEach(([label, value], i) => {
            const ty = py + 18 + i * 20
            if (i > 0) {
                ctx.strokeStyle = 'rgba(0,212,255,0.07)'
                ctx.lineWidth = 1
                ctx.beginPath(); ctx.moveTo(px+4, ty-10); ctx.lineTo(px+pw-4, ty-10); ctx.stroke()
            }
            ctx.fillStyle = 'rgba(255,255,255,0.3)'
            ctx.font = `8px ${MONO}`
            ctx.fillText(label, px + 8, ty)
            ctx.fillStyle = 'rgba(255,255,255,0.85)'
            ctx.font = `10px ${MONO}`
            ctx.textAlign = 'right'
            ctx.fillText(value, px + pw - 8, ty)
            ctx.textAlign = 'left'
        })

        // ── Heading bar ─────────────────────────────────────────────────────
        const barY = 38, barW = 180, barX = W/2 - barW/2
        ctx.strokeStyle = 'rgba(0,212,255,0.12)'
        ctx.lineWidth = 1
        ctx.strokeRect(barX, barY, barW, 8)
        for (let i = 0; i <= 12; i++) {
            const tx = barX + (i/12) * barW
            const isMid = i === 6
            ctx.strokeStyle = isMid ? 'rgba(0,212,255,0.6)' : 'rgba(0,212,255,0.18)'
            ctx.lineWidth  = isMid ? 1.5 : 1
            ctx.beginPath(); ctx.moveTo(tx, barY); ctx.lineTo(tx, barY + 8); ctx.stroke()
        }
        ctx.fillStyle = 'rgba(0,212,255,0.5)'
        ctx.font = `8px ${MONO}`
        ctx.textAlign = 'center'
        ctx.fillText('N', W/2, barY + 20)
        ctx.textAlign = 'left'

        // ── Detection bounding boxes ─────────────────────────────────────────
        if (aiActive) {
            for (const det of (dets || [])) drawDetectionBox(ctx, det, W, H)
        }

        // DEBUG: test box when no real detections — confirms canvas pipeline
        if ((dets || []).length === 0) {
            drawDetectionBox(ctx, { class: 'TEST', confidence: 0.99, bbox_normalized: [0.3, 0.3, 0.7, 0.7] }, W, H)
        }
    }, [aiActive])

    // Keep ref in sync — rAF reads ref, not state, to avoid stale closure
    useEffect(() => { detectionsRef.current = detections }, [detections])

    // rAF loop
    useEffect(() => {
        if (streamStatus !== 'live' && streamStatus !== 'mock') {
            if (hudAnimRef.current) cancelAnimationFrame(hudAnimRef.current)
            return
        }
        const loop = () => {
            if (frameCountRef.current % 60 === 0)
                console.log('[drone rAF] running, dets:', detectionsRef.current.length)
            frameCountRef.current = (frameCountRef.current || 0) + 1
            drawHUD(detectionsRef.current)
            hudAnimRef.current = requestAnimationFrame(loop)
        }
        hudAnimRef.current = requestAnimationFrame(loop)
        return () => { if (hudAnimRef.current) cancelAnimationFrame(hudAnimRef.current) }
    }, [streamStatus, drawHUD])

    // ── HLS stream ────────────────────────────────────────────────────────────

    const loadHLSStream = useCallback((url) => {
        const video = videoRef.current
        if (!video) return
        if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }

        if (window.Hls && window.Hls.isSupported()) {
            const hls = new window.Hls({
                liveSyncDurationCount:       2,
                liveMaxLatencyDurationCount: 5,
                enableWorker:                true,
                lowLatencyMode:              true,
                xhrSetup: (xhr) => { xhr.withCredentials = true },
            })
            hls.loadSource(url)
            hls.attachMedia(video)
            hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
                video.play().catch(() => {})
                setStreamStatus('live')
                setStreamError(null)
                recStartRef.current = Date.now()
            })
            hls.on(window.Hls.Events.ERROR, (_e, data) => {
                if (data.fatal) { setStreamStatus('error'); setStreamError('Stream lost') }
            })
            hlsRef.current = hls
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url
            video.play().catch(() => {})
            setStreamStatus('live')
            setStreamError(null)
            recStartRef.current = Date.now()
        } else {
            setStreamStatus('error')
            setStreamError('HLS not supported in this browser')
        }
    }, [])

    // ── Connect ───────────────────────────────────────────────────────────────

    const handleConnect = useCallback(async () => {
        setStreamStatus('connecting')
        setStreamError(null)
        clearTimeout(pollTimerRef.current)

        let hlsUrl
        try {
            const url        = new URL(rtmpUrl)
            const streamName = url.pathname.split('/').filter(Boolean).pop() || 'drone'
            hlsUrl = `http://${url.hostname}:8888/${streamName}/index.m3u8`
            console.log('[drone] HLS URL:', hlsUrl)
            setHlsUrl(hlsUrl)
        } catch {
            setStreamStatus('error')
            setStreamError('Invalid RTMP URL — expected rtmp://host:1935/streamname')
            return
        }

        let attempts = 0
        const poll = async () => {
            attempts++
            try {
                const r = await fetch(hlsUrl, {
                    method: 'GET', credentials: 'include', redirect: 'follow',
                    signal: AbortSignal.timeout(3000),
                })
                console.log(`[drone] Poll ${attempts}: HTTP ${r.status}`)
                if (r.ok) { loadHLSStream(hlsUrl); return }
            } catch (e) {
                console.log(`[drone] Poll ${attempts} error: ${e.message}`)
            }
            if (attempts >= 20) {
                setStreamStatus('error')
                setStreamError('Stream not found. Is mediamtx running and drone streaming?')
                return
            }
            pollTimerRef.current = setTimeout(poll, 1000)
        }
        poll()
    }, [rtmpUrl, loadHLSStream])

    // ── Disconnect ────────────────────────────────────────────────────────────

    const handleDisconnect = useCallback(() => {
        clearTimeout(pollTimerRef.current)
        if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
        const video = videoRef.current
        if (video) { video.src = ''; video.load() }
        setStreamStatus('idle')
        setDetections([])
        setHlsUrl(null)
        setStreamError(null)
        recStartRef.current = null
    }, [])

    // ── Mock mode ─────────────────────────────────────────────────────────────

    const startMockMode = useCallback(() => {
        setStreamStatus('mock')
        recStartRef.current = Date.now()
        clearInterval(mockTimerRef.current)
        mockTimerRef.current = setInterval(() => {
            const subset   = MOCK_DETECTIONS.slice(0, Math.floor(Math.random() * 4) + 1)
            const jittered = subset.map(d => {
                const jBbox = d.bbox.map(v => v + Math.floor(Math.random() * 10) - 5)
                return {
                    ...d,
                    bbox:            jBbox,
                    bbox_normalized: [jBbox[0]/1280, jBbox[1]/720, jBbox[2]/1280, jBbox[3]/720],
                    confidence:      Math.min(0.99, d.confidence + (Math.random() * 0.06 - 0.03)),
                    timestamp:       Date.now(),
                }
            })
            setDetections(jittered)
            setTotalDetections(t => t + jittered.length)
        }, 1000)
    }, [])

    const stopFeed = useCallback(() => {
        clearInterval(mockTimerRef.current)
        handleDisconnect()
        setTotalDetections(0)
        const canvas = canvasRef.current
        if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    }, [handleDisconnect])

    // ── SSE ───────────────────────────────────────────────────────────────────

    useEffect(() => {
        if (streamStatus !== 'live') return
        const BACKEND = import.meta.env.VITE_API_BASE || 'http://localhost:8000'
        console.log('[drone] SSE connecting to:', BACKEND)
        const src = new EventSource(`${BACKEND}/api/drone/events`)
        src.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data)
                console.log('[drone SSE]', msg.type, msg.detections?.length ?? '')
                if (msg.type !== 'drone_detections') return
                const dets = (msg.detections || []).map((d, i) => ({ ...d, id: i, timestamp: Date.now() }))
                detectionsRef.current = dets
                setDetections(dets)
                setTotalDetections(t => t + dets.length)
            } catch (err) { console.error('[drone SSE parse]', err) }
        }
        src.onerror = (e) => console.error('[drone SSE error]', e)
        return () => src.close()
    }, [streamStatus])

    // ── Cleanup ───────────────────────────────────────────────────────────────

    useEffect(() => () => {
        clearInterval(mockTimerRef.current)
        clearTimeout(pollTimerRef.current)
        if (hudAnimRef.current) cancelAnimationFrame(hudAnimRef.current)
        if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
    }, [])

    // ── Derived ───────────────────────────────────────────────────────────────

    const isSplit     = mode === 'split'
    const statusColor = { idle:'#636366', connecting:'#FFB800', live:'#00D4FF', mock:'#FFB800', error:'#FF2D2D' }[streamStatus]
    const statusLabel = { idle:'NO FEED', connecting:'ACQUIRING…', live:'LIVE', mock:'DEMO', error:'FAULT' }[streamStatus]
    const feedVisible = streamStatus === 'live' || streamStatus === 'mock'

    return (
        <div style={{
            width: '100%', height: '100%',
            background: '#050a14',
            display: 'flex', flexDirection: isSplit ? 'column' : 'row',
            fontFamily: MONO,
            color: 'rgba(255,255,255,0.9)', overflow: 'hidden', position: 'relative',
        }}>
            <style>{`
                @keyframes radar-pulse {
                    0%   { opacity: 0.5; transform: scale(0.85) }
                    100% { opacity: 0;   transform: scale(1.5)  }
                }
                @keyframes panel-scan {
                    0%   { background-position: 0 0    }
                    100% { background-position: 0 100% }
                }
            `}</style>

            {/* ── Header ── */}
            <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 38,
                background: 'rgba(5,10,20,0.97)',
                borderBottom: '1px solid rgba(0,212,255,0.12)',
                display: 'flex', alignItems: 'center',
                padding: '0 16px', gap: 16, zIndex: 10, flexShrink: 0,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{
                        width: 7, height: 7, borderRadius: '50%',
                        background: statusColor,
                        boxShadow: streamStatus === 'live' ? `0 0 8px ${statusColor}, 0 0 16px ${statusColor}44` : 'none',
                    }}/>
                    <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: statusColor, letterSpacing: 2 }}>
                        {statusLabel}
                    </span>
                </div>
                <div style={{ width: 1, height: 16, background: 'rgba(0,212,255,0.15)' }}/>
                <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.7)', letterSpacing: 2 }}>
                    DRONE OPERATOR
                </span>

                <div onClick={() => setAiActive(v => !v)} style={{
                    display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px',
                    background: aiActive ? 'rgba(0,212,255,0.08)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${aiActive ? 'rgba(0,212,255,0.25)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 2, cursor: 'pointer',
                }}>
                    <div style={{
                        width: 5, height: 5, borderRadius: '50%',
                        background: aiActive ? '#00D4FF' : '#636366',
                        boxShadow: aiActive ? '0 0 6px #00D4FF' : 'none',
                    }}/>
                    <span style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, color: aiActive ? '#00D4FF' : 'rgba(255,255,255,0.3)', letterSpacing: 1.5 }}>
                        AI {aiActive ? 'ACTIVE' : 'OFF'}
                    </span>
                </div>

                {streamStatus === 'live' && fps > 0 && (
                    <span style={{ fontFamily: MONO, fontSize: 8, color: 'rgba(0,212,255,0.4)' }}>{fps} FPS</span>
                )}
                <div style={{ flex: 1 }}/>

                {[
                    { label: '⚙ RTMP', action: () => setShowUrlInput(v => !v), show: true },
                    { label: isSplit ? '⤢ EXPAND' : '⤡ SPLIT', action: isSplit ? onExpand : onMinimize, show: !!(onMinimize || onExpand) },
                ].filter(b => b.show).map(({ label, action }) => (
                    <button key={label} onClick={action} style={{
                        background: 'transparent',
                        border: '1px solid rgba(0,212,255,0.15)', borderRadius: 2,
                        color: 'rgba(255,255,255,0.4)', fontFamily: MONO,
                        fontSize: 8, letterSpacing: 1.5, padding: '4px 10px', cursor: 'pointer',
                    }}>{label}</button>
                ))}
            </div>

            {/* ── RTMP config dropdown ── */}
            {showUrlInput && (
                <div style={{
                    position: 'absolute', top: 38, right: 14, zIndex: 20,
                    background: 'rgba(5,10,20,0.99)',
                    border: '1px solid rgba(0,212,255,0.15)',
                    borderRadius: 2, padding: 14, width: 320,
                }}>
                    <div style={{ fontFamily: MONO, fontSize: 8, color: 'rgba(0,212,255,0.5)', marginBottom: 8, letterSpacing: 2, textTransform: 'uppercase' }}>
                        DJI Fly RTMP URL
                    </div>
                    <input
                        value={rtmpUrl}
                        onChange={e => setRtmpUrl(e.target.value)}
                        placeholder="rtmp://192.168.x.x:1935/drone"
                        style={{
                            width: '100%', background: 'rgba(0,212,255,0.04)',
                            border: '1px solid rgba(0,212,255,0.15)', borderRadius: 2,
                            color: '#00D4FF', fontFamily: MONO, fontSize: 10, padding: '6px 8px',
                            outline: 'none', boxSizing: 'border-box', marginBottom: 6,
                        }}
                    />
                    {rtmpUrl && (() => {
                        try {
                            const p = new URL(rtmpUrl)
                            const key = p.pathname.split('/').filter(Boolean).pop() || 'drone'
                            return <div style={{ fontFamily: MONO, fontSize: 9, color: 'rgba(255,255,255,0.2)', marginBottom: 8, wordBreak: 'break-all' }}>
                                HLS → {`http://${p.hostname}:8888/${key}/index.m3u8`}
                            </div>
                        } catch { return null }
                    })()}
                    <div style={{ fontFamily: MONO, fontSize: 8, color: 'rgba(255,255,255,0.2)', marginBottom: 10, lineHeight: 1.8 }}>
                        1. RUN: <span style={{ color: '#00D4FF' }}>mediamtx mediamtx.yml</span><br/>
                        2. DJI Fly → Transmission → RTMP<br/>
                        3. Stream name: <span style={{ color: '#00D4FF' }}>drone</span>
                    </div>
                    <button
                        onClick={streamStatus === 'live' ? handleDisconnect : handleConnect}
                        style={{
                            width: '100%', padding: '7px 0',
                            background: 'transparent',
                            border: `1px solid ${streamStatus === 'live' ? 'rgba(255,45,45,0.4)' : 'rgba(0,212,255,0.3)'}`,
                            borderRadius: 2,
                            color: streamStatus === 'live' ? '#FF2D2D' : '#00D4FF',
                            fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: 2, cursor: 'pointer',
                        }}
                    >
                        {streamStatus === 'live' ? '◼ DISCONNECT' : streamStatus === 'connecting' ? '⟳ ACQUIRING…' : '▶ CONNECT'}
                    </button>
                </div>
            )}

            {/* ── Body ── */}
            <div style={{ display: 'flex', flexDirection: isSplit ? 'column' : 'row', flex: 1, marginTop: 38, overflow: 'hidden' }}>

                {/* ── Video panel ── */}
                <div style={{ flex: isSplit ? '0 0 60%' : '1 1 70%', position: 'relative', background: '#000', overflow: 'hidden', minHeight: isSplit ? 200 : 0 }}>

                    {/* Idle — tactical radar screen */}
                    {streamStatus === 'idle' && (
                        <div style={{ position: 'absolute', inset: 0, background: '#050a14', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
                            <div style={{ position: 'relative', width: 120, height: 120 }}>
                                {[0,1,2].map(i => (
                                    <div key={i} style={{
                                        position: 'absolute', inset: `${i*20}px`, borderRadius: '50%',
                                        border: '1px solid rgba(0,212,255,0.15)',
                                        animation: `radar-pulse 3s ease-out ${i*0.8}s infinite`,
                                    }}/>
                                ))}
                                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(0,212,255,0.4)' }}/>
                                </div>
                            </div>
                            <div style={{ fontFamily: MONO, fontSize: 11, color: 'rgba(0,212,255,0.5)', letterSpacing: 3 }}>
                                AWAITING FEED
                            </div>
                            <div style={{ display: 'flex', gap: 10 }}>
                                {[
                                    { label: 'CONNECT RTMP', action: () => setShowUrlInput(true), color: '#00D4FF', border: 'rgba(0,212,255,0.3)' },
                                    { label: 'DEMO MODE',    action: startMockMode,                color: '#FFB800', border: 'rgba(255,184,0,0.3)' },
                                ].map(({ label, action, color, border }) => (
                                    <button key={label} onClick={action} style={{
                                        padding: '8px 20px', background: 'transparent',
                                        border: `1px solid ${border}`, borderRadius: 2,
                                        color, fontFamily: MONO, fontSize: 9, letterSpacing: 2, cursor: 'pointer',
                                    }}>{label}</button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Connecting */}
                    {streamStatus === 'connecting' && (
                        <div style={{ position: 'absolute', inset: 0, background: '#050a14', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                            <div style={{ fontSize: 22, color: '#FFB800' }}>⟳</div>
                            <div style={{ fontFamily: MONO, fontSize: 10, color: 'rgba(255,184,0,0.8)', letterSpacing: 2 }}>ACQUIRING STREAM…</div>
                            <div style={{ fontFamily: MONO, fontSize: 8, color: 'rgba(255,255,255,0.2)', letterSpacing: 1 }}>POLLING HLS MANIFEST</div>
                        </div>
                    )}

                    {/* Mock background — subtle grid */}
                    {streamStatus === 'mock' && (
                        <div style={{ position: 'absolute', inset: 0, background: '#050a14' }}>
                            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.06 }}>
                                <defs>
                                    <pattern id="tac-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#00D4FF" strokeWidth="0.5"/>
                                    </pattern>
                                </defs>
                                <rect width="100%" height="100%" fill="url(#tac-grid)"/>
                            </svg>
                        </div>
                    )}

                    {/* Video element */}
                    <video ref={videoRef} autoPlay muted playsInline
                        style={{ width: '100%', height: '100%', objectFit: 'contain', display: streamStatus === 'live' ? 'block' : 'none' }}
                    />

                    {/* HUD canvas */}
                    <canvas ref={canvasRef} width={videoDims.w} height={videoDims.h}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', display: feedVisible ? 'block' : 'none' }}
                    />

                    {/* Error */}
                    {streamStatus === 'error' && streamError && (
                        <div style={{
                            position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
                            background: 'rgba(255,45,45,0.1)', border: '1px solid rgba(255,45,45,0.3)',
                            borderRadius: 2, padding: '8px 16px',
                            fontFamily: MONO, fontSize: 10, color: '#FF2D2D',
                            textAlign: 'center', maxWidth: 300, zIndex: 10,
                        }}>
                            ⚠ {streamError}
                            <div style={{ marginTop: 8 }}>
                                <button onClick={() => { setStreamStatus('idle'); setStreamError(null) }} style={{
                                    background: 'transparent', border: '1px solid rgba(255,45,45,0.3)',
                                    borderRadius: 2, color: '#FF2D2D', fontFamily: MONO, fontSize: 8,
                                    letterSpacing: 1.5, padding: '3px 12px', cursor: 'pointer',
                                }}>DISMISS</button>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Intelligence panel ── */}
                <div style={{
                    flex: isSplit ? '0 0 40%' : '0 0 280px',
                    borderLeft:  isSplit ? 'none' : '1px solid rgba(0,212,255,0.1)',
                    borderTop:   isSplit ? '1px solid rgba(0,212,255,0.1)' : 'none',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    background: '#050a14',
                    backgroundImage: 'linear-gradient(180deg, transparent 0%, rgba(0,212,255,0.008) 50%, transparent 100%)',
                    backgroundSize: '100% 12px',
                    animation: 'panel-scan 6s linear infinite',
                }}>
                    {/* Stats row */}
                    <div style={{ display: 'flex', borderBottom: '1px solid rgba(0,212,255,0.1)', flexShrink: 0 }}>
                        {[
                            { label: 'TOTAL',    value: totalDetections,  color: '#00D4FF' },
                            { label: 'IN FRAME', value: detections.length, color: '#FFB800' },
                            { label: 'AVG CONF',
                                value: detections.length > 0
                                    ? Math.round(detections.reduce((a,d) => a + d.confidence, 0) / detections.length * 100) + '%'
                                    : '—',
                                color: '#30D158' },
                        ].map(({ label, value, color }) => (
                            <div key={label} style={{ flex: 1, padding: '10px 0', textAlign: 'center', borderRight: '1px solid rgba(0,212,255,0.08)' }}>
                                <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color, lineHeight: 1, letterSpacing: -0.5 }}>{value}</div>
                                <div style={{ fontFamily: MONO, fontSize: 8, color: 'rgba(255,255,255,0.3)', marginTop: 4, letterSpacing: 1.5, textTransform: 'uppercase' }}>{label}</div>
                            </div>
                        ))}
                    </div>

                    {/* Section label */}
                    <div style={{ padding: '8px 14px 6px', fontFamily: MONO, fontSize: 8, color: 'rgba(0,212,255,0.5)', letterSpacing: 2, textTransform: 'uppercase', borderBottom: '1px solid rgba(0,212,255,0.06)', flexShrink: 0 }}>
                        Live Detections
                    </div>

                    {/* Detection cards */}
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        {detections.length === 0 ? (
                            <div style={{ padding: '24px 14px', textAlign: 'center', fontFamily: MONO, fontSize: 9, color: 'rgba(255,255,255,0.15)', letterSpacing: 1.5, lineHeight: 2 }}>
                                {streamStatus === 'idle' ? 'NO FEED\nCONNECTED' : 'NO TARGETS\nIN FRAME'}
                            </div>
                        ) : (
                            [...detections]
                                .sort((a, b) => b.confidence - a.confidence)
                                .slice(0, 8)
                                .map((det, i) => {
                                    const color = detColor(det.class)
                                    const conf  = Math.round(det.confidence * 100)
                                    return (
                                        <div key={det.id ?? i} style={{ display: 'flex', alignItems: 'center', padding: '7px 14px', borderBottom: '1px solid rgba(255,255,255,0.03)', gap: 10 }}>
                                            <div style={{ width: 2, height: 28, background: color, flexShrink: 0, opacity: 0.8 }}/>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.9)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                                    {det.class}
                                                </div>
                                                <div style={{ fontFamily: MONO, fontSize: 8, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>
                                                    {det.timestamp ? `${Math.round((Date.now()-det.timestamp)/1000)}s ago` : 'now'}
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                                <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color, lineHeight: 1 }}>{conf}%</div>
                                                <div style={{ width: 40, height: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 1, marginTop: 5, overflow: 'hidden' }}>
                                                    <div style={{ width: `${conf}%`, height: '100%', background: color }}/>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })
                        )}
                    </div>

                    {/* Action footer */}
                    <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(0,212,255,0.08)', flexShrink: 0 }}>
                        {streamStatus === 'idle' && (
                            <button onClick={startMockMode} style={{
                                width: '100%', padding: '8px 0', background: 'transparent',
                                border: '1px solid rgba(255,184,0,0.25)', borderRadius: 2,
                                color: '#FFB800', fontFamily: MONO, fontSize: 8, letterSpacing: 2, cursor: 'pointer',
                            }}>▶ START DEMO</button>
                        )}
                        {(streamStatus === 'mock' || streamStatus === 'live') && (
                            <button onClick={stopFeed} style={{
                                width: '100%', padding: '8px 0', background: 'transparent',
                                border: '1px solid rgba(255,45,45,0.2)', borderRadius: 2,
                                color: 'rgba(255,45,45,0.6)', fontFamily: MONO, fontSize: 8, letterSpacing: 2, cursor: 'pointer',
                            }}>◼ STOP FEED</button>
                        )}
                        {streamStatus === 'connecting' && (
                            <button onClick={handleDisconnect} style={{
                                width: '100%', padding: '8px 0', background: 'transparent',
                                border: '1px solid rgba(255,184,0,0.2)', borderRadius: 2,
                                color: 'rgba(255,184,0,0.6)', fontFamily: MONO, fontSize: 8, letterSpacing: 2, cursor: 'pointer',
                            }}>✕ CANCEL</button>
                        )}
                        {streamStatus === 'error' && (
                            <button onClick={() => { setStreamStatus('idle'); setStreamError(null) }} style={{
                                width: '100%', padding: '8px 0', background: 'transparent',
                                border: '1px solid rgba(255,255,255,0.1)', borderRadius: 2,
                                color: 'rgba(255,255,255,0.4)', fontFamily: MONO, fontSize: 8, letterSpacing: 2, cursor: 'pointer',
                            }}>↩ RESET</button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
