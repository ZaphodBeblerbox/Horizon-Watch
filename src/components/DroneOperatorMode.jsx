import { useState, useEffect, useRef, useCallback } from 'react'
import API_BASE from '../apiBase.js'

const DETECTION_COLORS = {
    person:     '#FF3B30',
    car:        '#FF9500',
    truck:      '#FF9500',
    motorcycle: '#FF9500',
    bicycle:    '#FF9500',
    bus:        '#FF9500',
    boat:       '#34AADC',
    dog:        '#30D158',
    cat:        '#30D158',
    bird:       '#30D158',
    default:    '#FFCC00',
}

const DETECTION_ICONS = {
    person:     '👤',
    car:        '🚗',
    truck:      '🚛',
    motorcycle: '🏍',
    bicycle:    '🚲',
    bus:        '🚌',
    boat:       '⛵',
    dog:        '🐕',
    cat:        '🐈',
    bird:       '🐦',
    default:    '◉',
}

const MOCK_DETECTIONS = [
    { id: 1, class: 'person',  confidence: 0.94, bbox: [120, 80,  180, 220], bbox_normalized: [0.094, 0.111, 0.141, 0.306], timestamp: Date.now() },
    { id: 2, class: 'truck',   confidence: 0.87, bbox: [320, 180, 520, 300], bbox_normalized: [0.250, 0.250, 0.406, 0.417], timestamp: Date.now() - 2000 },
    { id: 3, class: 'car',     confidence: 0.91, bbox: [580, 240, 720, 340], bbox_normalized: [0.453, 0.333, 0.563, 0.472], timestamp: Date.now() - 4000 },
    { id: 4, class: 'person',  confidence: 0.79, bbox: [240, 300, 290, 440], bbox_normalized: [0.188, 0.417, 0.227, 0.611], timestamp: Date.now() - 6000 },
]

// ── Canvas helpers (module-level, no closure deps) ────────────────────────────

function drawDetectionBox(ctx, det, W, H) {
    const COLORS = {
        person: '#FF3B30', car: '#FF9500', truck: '#FF9500',
        motorcycle: '#FF9500', bicycle: '#FF9500', bus: '#FF9500',
        boat: '#34AADC', dog: '#30D158', cat: '#30D158', default: '#FFCC00',
    }
    const color = COLORS[det.class] || COLORS.default
    const bn = det.bbox_normalized || det.bbox
    if (!bn) return
    const [nx1, ny1, nx2, ny2] = bn
    const x1 = nx1 * W, y1 = ny1 * H
    const x2 = nx2 * W, y2 = ny2 * H
    const bw = x2 - x1, bh = y2 - y1

    ctx.fillStyle = color + '18'
    ctx.fillRect(x1, y1, bw, bh)

    const cs = Math.min(bw, bh) * 0.2
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    for (const [cx, cy, dx, dy] of [[x1,y1,1,1],[x2,y1,-1,1],[x1,y2,1,-1],[x2,y2,-1,-1]]) {
        ctx.beginPath()
        ctx.moveTo(cx + dx * cs, cy)
        ctx.lineTo(cx, cy)
        ctx.lineTo(cx, cy + dy * cs)
        ctx.stroke()
    }

    const label = `${det.class.toUpperCase()}  ${Math.round(det.confidence * 100)}%`
    ctx.font = 'bold 11px monospace'
    const lw = ctx.measureText(label).width + 10
    ctx.fillStyle = color + 'CC'
    ctx.fillRect(x1, y1 - 20, lw, 18)
    ctx.fillStyle = 'white'
    ctx.fillText(label, x1 + 5, y1 - 7)
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
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
    const recStartRef    = useRef(null)
    const hudAnimRef     = useRef(null)
    const detectionsRef  = useRef([])

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

    // ── Tactical HUD drawn on canvas rAF loop ────────────────────────────────

    const drawHUD = useCallback((dets) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        const W = canvas.width
        const H = canvas.height

        ctx.clearRect(0, 0, W, H)

        // Rule-of-thirds grid
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'
        ctx.lineWidth = 1
        for (let i = 1; i < 3; i++) {
            ctx.beginPath(); ctx.moveTo(W * i/3, 0); ctx.lineTo(W * i/3, H); ctx.stroke()
        }
        for (let i = 1; i < 3; i++) {
            ctx.beginPath(); ctx.moveTo(0, H * i/3); ctx.lineTo(W, H * i/3); ctx.stroke()
        }

        // Centre crosshair
        const cx = W/2, cy = H/2, cs = 20, cg = 6
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(cx - cs - cg, cy); ctx.lineTo(cx - cg, cy)
        ctx.moveTo(cx + cg, cy);      ctx.lineTo(cx + cs + cg, cy)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(cx, cy - cs - cg); ctx.lineTo(cx, cy - cg)
        ctx.moveTo(cx, cy + cg);      ctx.lineTo(cx, cy + cs + cg)
        ctx.stroke()
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.beginPath(); ctx.arc(cx, cy, 1.5, 0, Math.PI * 2); ctx.fill()

        // Corner brackets
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'
        ctx.lineWidth = 2
        for (const [x, y, dx, dy] of [[20,20,1,1],[W-20,20,-1,1],[20,H-20,1,-1],[W-20,H-20,-1,-1]]) {
            ctx.beginPath()
            ctx.moveTo(x + dx*40, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy*40)
            ctx.stroke()
        }

        // Top bar
        ctx.fillStyle = 'rgba(0,0,0,0.45)'
        ctx.fillRect(0, 0, W, 36)

        ctx.fillStyle = 'rgba(52,170,220,0.9)'
        ctx.font = 'bold 11px monospace'
        if ('letterSpacing' in ctx) ctx.letterSpacing = '2px'
        ctx.fillText('◈ HORIZON WATCH', 16, 22)
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'

        // Blinking REC dot
        if (Math.floor(Date.now() / 1000) % 2 === 0) {
            ctx.fillStyle = '#FF3B30'
            ctx.beginPath(); ctx.arc(W/2 - 42, 18, 4, 0, Math.PI * 2); ctx.fill()
        }
        const recTime = recStartRef.current ? formatDuration(Date.now() - recStartRef.current) : '00:00:00'
        ctx.fillStyle = 'rgba(255,255,255,0.8)'
        ctx.font = '11px monospace'
        ctx.textAlign = 'center'
        ctx.fillText(`REC  ${recTime}`, W/2, 22)

        ctx.textAlign = 'right'
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.font = '11px monospace'
        ctx.fillText(`${new Date().toUTCString().slice(-12, -4)} UTC`, W - 16, 22)
        ctx.textAlign = 'left'

        // Bottom bar
        ctx.fillStyle = 'rgba(0,0,0,0.45)'
        ctx.fillRect(0, H - 32, W, 32)

        ctx.fillStyle = 'rgba(255,255,255,0.4)'
        ctx.font = '10px monospace'
        ctx.fillText('DRONE-01', 16, H - 11)

        const detCount = (dets || []).length
        ctx.textAlign = 'center'
        ctx.fillStyle = detCount > 0 ? '#30D158' : 'rgba(255,255,255,0.3)'
        ctx.font = 'bold 11px monospace'
        ctx.fillText(`${detCount} object${detCount !== 1 ? 's' : ''} in frame`, W/2, H - 11)

        ctx.textAlign = 'right'
        ctx.fillStyle = aiActive ? '#30D158' : 'rgba(255,255,255,0.3)'
        ctx.font = 'bold 10px monospace'
        ctx.fillText(aiActive ? '◉ AI ACTIVE' : '○ AI OFF', W - 16, H - 11)
        ctx.textAlign = 'left'

        // Telemetry panel (top-right)
        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        roundRect(ctx, W - 110, 50, 96, 90, 4)
        ctx.fill()
        for (const [[label, value], i] of [['ZOOM','1.0×'],['ALT','—  m'],['SPD','—  km/h'],['HDG','—  °']].map((v,i)=>[v,i])) {
            const ty = 70 + i * 20
            ctx.fillStyle = 'rgba(255,255,255,0.35)'
            ctx.font = '9px monospace'
            ctx.fillText(label, W - 104, ty)
            ctx.fillStyle = 'rgba(255,255,255,0.8)'
            ctx.font = '10px monospace'
            ctx.textAlign = 'right'
            ctx.fillText(value, W - 18, ty)
            ctx.textAlign = 'left'
        }

        // Heading bar (below top bar, centred)
        const barY = 44, barW = 200, barX = W/2 - barW/2
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'
        ctx.lineWidth = 1
        ctx.strokeRect(barX, barY, barW, 10)
        for (let i = 0; i <= 10; i++) {
            const tx = barX + (i/10) * barW
            ctx.strokeStyle = i === 5 ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)'
            ctx.lineWidth  = i === 5 ? 2 : 1
            ctx.beginPath(); ctx.moveTo(tx, barY); ctx.lineTo(tx, barY + 10); ctx.stroke()
        }
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.font = '9px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('N', W/2, barY + 22)
        ctx.textAlign = 'left'

        // Detection bounding boxes
        if (aiActive) {
            for (const det of (dets || [])) {
                if (det.bbox_normalized) drawDetectionBox(ctx, det, W, H)
            }
        }
    }, [aiActive])

    // Keep ref in sync so rAF always reads latest detections without stale closure
    useEffect(() => { detectionsRef.current = detections }, [detections])

    // rAF loop — runs whenever feed is visible (live or mock)
    useEffect(() => {
        if (streamStatus !== 'live' && streamStatus !== 'mock') {
            if (hudAnimRef.current) cancelAnimationFrame(hudAnimRef.current)
            return
        }
        const loop = () => {
            drawHUD(detectionsRef.current)
            hudAnimRef.current = requestAnimationFrame(loop)
        }
        hudAnimRef.current = requestAnimationFrame(loop)
        return () => { if (hudAnimRef.current) cancelAnimationFrame(hudAnimRef.current) }
    }, [streamStatus, drawHUD])

    // ── HLS stream loading ────────────────────────────────────────────────────

    const loadHLSStream = useCallback((url) => {
        const video = videoRef.current
        if (!video) return

        if (hlsRef.current) {
            hlsRef.current.destroy()
            hlsRef.current = null
        }

        if (window.Hls && window.Hls.isSupported()) {
            const hls = new window.Hls({
                liveSyncDurationCount:      2,
                liveMaxLatencyDurationCount: 5,
                enableWorker:               true,
                lowLatencyMode:             true,
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
                if (data.fatal) {
                    setStreamStatus('error')
                    setStreamError('Stream lost')
                }
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

    // ── Connect: derive HLS URL from RTMP, poll until m3u8 appears ───────────

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
                    method: 'GET',
                    credentials: 'include',
                    redirect: 'follow',
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

    // ── Demo / mock mode ──────────────────────────────────────────────────────

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

    // ── SSE: receive real YOLO detections from drone_worker ──────────────────

    useEffect(() => {
        if (streamStatus !== 'live') return
        console.log('[drone] SSE connecting to:', `${API_BASE}/api/drone/events`)
        const src = new EventSource(`${API_BASE}/api/drone/events`)
        src.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data)
                console.log('[drone SSE]', msg.type, msg.detections?.length)
                if (msg.type !== 'drone_detections') return
                console.log('[drone] detections received:', msg.detections)
                const dets = (msg.detections || []).map((d, i) => ({
                    ...d,
                    id:        i,
                    timestamp: (msg.timestamp || Date.now() / 1000) * 1000,
                }))
                console.log('[drone] setting detections:', dets)
                setDetections(dets)
                setTotalDetections(t => t + dets.length)
            } catch (err) {
                console.error('[drone SSE parse error]', err)
            }
        }
        src.onerror = (e) => console.error('[drone SSE error]', e)
        return () => src.close()
    }, [streamStatus])

    // ── Cleanup on unmount ────────────────────────────────────────────────────

    useEffect(() => {
        return () => {
            clearInterval(mockTimerRef.current)
            clearTimeout(pollTimerRef.current)
            if (hudAnimRef.current) cancelAnimationFrame(hudAnimRef.current)
            if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
        }
    }, [])

    // ── Derived UI state ──────────────────────────────────────────────────────

    const isSplit    = mode === 'split'
    const statusColor = { idle: '#636366', connecting: '#FF9500', live: '#30D158', mock: '#5856D6', error: '#FF3B30' }[streamStatus]
    const statusLabel = { idle: 'NO FEED', connecting: 'CONNECTING…', live: 'LIVE', mock: 'DEMO MODE', error: 'ERROR' }[streamStatus]
    const feedVisible = streamStatus === 'live' || streamStatus === 'mock'

    return (
        <div style={{
            width: '100%', height: '100%',
            background: 'rgba(6,10,20,0.98)',
            display: 'flex', flexDirection: isSplit ? 'column' : 'row',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            color: 'white', overflow: 'hidden', position: 'relative',
        }}>

            {/* ── Header ── */}
            <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 40,
                background: 'rgba(6,10,20,0.95)',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center',
                padding: '0 14px', gap: 12, zIndex: 10, flexShrink: 0,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: statusColor,
                        boxShadow: streamStatus === 'live' ? `0 0 8px ${statusColor}` : 'none',
                    }}/>
                    <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, letterSpacing: 1 }}>
                        {statusLabel}
                    </span>
                </div>
                <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }}/>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.8)', letterSpacing: 0.5 }}>
                    DRONE OPERATOR MODE
                </span>

                <div onClick={() => setAiActive(v => !v)} style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '3px 8px',
                    background: aiActive ? 'rgba(48,209,88,0.1)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${aiActive ? 'rgba(48,209,88,0.3)' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: 20, cursor: 'pointer',
                }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: aiActive ? '#30D158' : '#636366' }}/>
                    <span style={{ fontSize: 10, fontWeight: 600, color: aiActive ? '#30D158' : 'rgba(255,255,255,0.4)' }}>
                        AI {aiActive ? 'ON' : 'OFF'}
                    </span>
                </div>

                {streamStatus === 'live' && fps > 0 && (
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{fps} fps</span>
                )}

                <div style={{ flex: 1 }}/>

                <button onClick={() => setShowUrlInput(v => !v)} style={{
                    background: showUrlInput ? 'rgba(52,170,220,0.12)' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${showUrlInput ? 'rgba(52,170,220,0.3)' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: 6, color: showUrlInput ? '#34AADC' : 'rgba(255,255,255,0.5)',
                    fontSize: 10, padding: '3px 8px', cursor: 'pointer',
                }}>⚙ RTMP</button>

                {(onMinimize || onExpand) && (
                    <button onClick={isSplit ? onExpand : onMinimize} style={{
                        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6, color: 'rgba(255,255,255,0.5)', fontSize: 10, padding: '3px 8px', cursor: 'pointer',
                    }}>
                        {isSplit ? '⤢ Expand' : '⤡ Split View'}
                    </button>
                )}
            </div>

            {/* ── RTMP config dropdown ── */}
            {showUrlInput && (
                <div style={{
                    position: 'absolute', top: 40, right: 14, zIndex: 20,
                    background: 'rgba(10,18,35,0.98)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8, padding: 14, width: 320,
                }}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                        DJI Fly RTMP URL
                    </div>
                    <input
                        value={rtmpUrl}
                        onChange={e => setRtmpUrl(e.target.value)}
                        placeholder="rtmp://192.168.x.x:1935/live/horizon"
                        style={{
                            width: '100%', background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6,
                            color: 'white', fontSize: 11, padding: '6px 8px', outline: 'none',
                            boxSizing: 'border-box', marginBottom: 6,
                        }}
                    />
                    {rtmpUrl && (() => {
                        try {
                            const p = new URL(rtmpUrl)
                            const key = p.pathname.split('/').filter(Boolean).pop() || 'drone'
                            return <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 6, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                HLS: {`http://${p.hostname}:8888/${key}/index.m3u8`}
                            </div>
                        } catch { return null }
                    })()}
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginBottom: 10, lineHeight: 1.6 }}>
                        1. Run: <code style={{ color: '#34AADC' }}>mediamtx mediamtx.yml</code><br/>
                        2. DJI Fly: Transmission → Live Streaming → RTMP<br/>
                        3. Stream name: <code style={{ color: '#34AADC' }}>drone</code><br/>
                        HLS auto-detected from RTMP URL
                    </div>
                    <button
                        onClick={streamStatus === 'live' ? handleDisconnect : handleConnect}
                        style={{
                            width: '100%', padding: '7px 0',
                            background: streamStatus === 'live' ? 'rgba(255,59,48,0.12)' : 'rgba(52,170,220,0.12)',
                            border: `1px solid ${streamStatus === 'live' ? 'rgba(255,59,48,0.3)' : 'rgba(52,170,220,0.3)'}`,
                            borderRadius: 6,
                            color: streamStatus === 'live' ? '#FF3B30' : '#34AADC',
                            fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}
                    >
                        {streamStatus === 'live' ? '◼ Disconnect' : streamStatus === 'connecting' ? '⟳ Connecting…' : '▶ Connect'}
                    </button>
                </div>
            )}

            {/* ── Body ── */}
            <div style={{
                display: 'flex', flexDirection: isSplit ? 'column' : 'row',
                flex: 1, marginTop: 40, overflow: 'hidden',
            }}>

                {/* Video panel */}
                <div style={{
                    flex: isSplit ? '0 0 60%' : '1 1 70%',
                    position: 'relative', background: '#000',
                    overflow: 'hidden', minHeight: isSplit ? 200 : 0,
                }}>
                    {/* Idle placeholder */}
                    {streamStatus === 'idle' && (
                        <div style={{
                            position: 'absolute', inset: 0,
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: 16,
                        }}>
                            <svg width="64" height="64" viewBox="0 0 24 24"
                                fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1">
                                <circle cx="12" cy="12" r="2"/>
                                <path d="M8 8L4 4M16 8l4-4M8 16l-4 4M16 16l4 4"/>
                                <circle cx="4"  cy="4"  r="1.5" fill="rgba(255,255,255,0.15)"/>
                                <circle cx="20" cy="4"  r="1.5" fill="rgba(255,255,255,0.15)"/>
                                <circle cx="4"  cy="20" r="1.5" fill="rgba(255,255,255,0.15)"/>
                                <circle cx="20" cy="20" r="1.5" fill="rgba(255,255,255,0.15)"/>
                            </svg>
                            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', textAlign: 'center', lineHeight: 1.6 }}>
                                No drone feed connected<br/>
                                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>
                                    Configure RTMP above or run demo mode
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={() => setShowUrlInput(true)} style={{
                                    padding: '7px 16px',
                                    background: 'rgba(52,170,220,0.1)', border: '1px solid rgba(52,170,220,0.3)',
                                    borderRadius: 6, color: '#34AADC', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                }}>⚙ Connect RTMP</button>
                                <button onClick={startMockMode} style={{
                                    padding: '7px 16px',
                                    background: 'rgba(88,86,214,0.1)', border: '1px solid rgba(88,86,214,0.3)',
                                    borderRadius: 6, color: '#5856D6', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                }}>▶ Demo Mode</button>
                            </div>
                        </div>
                    )}

                    {/* Connecting spinner */}
                    {streamStatus === 'connecting' && (
                        <div style={{
                            position: 'absolute', inset: 0,
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: 12,
                        }}>
                            <div style={{ fontSize: 22, color: '#FF9500' }}>⟳</div>
                            <div style={{ fontSize: 12, color: 'rgba(255,149,0,0.8)' }}>Waiting for stream…</div>
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>Polling for HLS manifest</div>
                        </div>
                    )}

                    {/* Mock background */}
                    {streamStatus === 'mock' && (
                        <div style={{
                            position: 'absolute', inset: 0,
                            background: 'linear-gradient(135deg, #0a1628 0%, #0d2137 50%, #0a1628 100%)',
                        }}>
                            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.07 }}>
                                <defs>
                                    <pattern id="drone-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5"/>
                                    </pattern>
                                </defs>
                                <rect width="100%" height="100%" fill="url(#drone-grid)"/>
                            </svg>
                        </div>
                    )}

                    {/* Real video element */}
                    <video ref={videoRef} autoPlay muted playsInline
                        style={{ width: '100%', height: '100%', objectFit: 'contain', display: streamStatus === 'live' ? 'block' : 'none' }}
                    />

                    {/* HUD canvas — drawn by drawHUD rAF loop */}
                    <canvas ref={canvasRef} width={videoDims.w} height={videoDims.h}
                        style={{
                            position: 'absolute', inset: 0, width: '100%', height: '100%',
                            pointerEvents: 'none',
                            display: feedVisible ? 'block' : 'none',
                        }}
                    />

                    {/* Error message */}
                    {streamStatus === 'error' && streamError && (
                        <div style={{
                            position: 'absolute', bottom: 20, left: '50%',
                            transform: 'translateX(-50%)',
                            background: 'rgba(255,59,48,0.15)',
                            border: '1px solid rgba(255,59,48,0.3)',
                            borderRadius: 8, padding: '8px 16px',
                            fontSize: 11, color: '#FF3B30',
                            textAlign: 'center', maxWidth: 280, zIndex: 10,
                        }}>
                            ⚠ {streamError}
                            <div style={{ marginTop: 8 }}>
                                <button onClick={() => { setStreamStatus('idle'); setStreamError(null) }} style={{
                                    background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.3)',
                                    borderRadius: 4, color: '#FF3B30', fontSize: 10, padding: '3px 10px', cursor: 'pointer',
                                }}>Dismiss</button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Intelligence panel */}
                <div style={{
                    flex: isSplit ? '0 0 40%' : '0 0 300px',
                    borderLeft:  isSplit ? 'none' : '1px solid rgba(255,255,255,0.06)',
                    borderTop:   isSplit ? '1px solid rgba(255,255,255,0.06)' : 'none',
                    display: 'flex', flexDirection: 'column',
                    overflow: 'hidden', background: 'rgba(8,14,28,0.98)',
                }}>
                    {/* Stats row */}
                    <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        {[
                            { label: 'DETECTIONS', value: totalDetections, color: '#30D158' },
                            { label: 'IN FRAME',   value: detections.length, color: '#34AADC' },
                            { label: 'CONFIDENCE',
                                value: detections.length > 0
                                    ? Math.round(detections.reduce((a, d) => a + d.confidence, 0) / detections.length * 100) + '%'
                                    : '—',
                                color: '#FF9500' },
                        ].map(({ label, value, color }) => (
                            <div key={label} style={{
                                flex: 1, padding: '10px 12px',
                                borderRight: '1px solid rgba(255,255,255,0.06)', textAlign: 'center',
                            }}>
                                <div style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
                                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 3, letterSpacing: 0.8 }}>{label}</div>
                            </div>
                        ))}
                    </div>

                    <div style={{ padding: '8px 14px 4px', fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600 }}>
                        Live Detections
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 10px' }}>
                        {detections.length === 0 ? (
                            <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.2)', lineHeight: 1.6 }}>
                                {streamStatus === 'idle' ? 'No feed connected' : 'No objects detected'}
                            </div>
                        ) : (
                            [...detections].sort((a, b) => b.confidence - a.confidence).map((det, i) => {
                                const color = DETECTION_COLORS[det.class] || DETECTION_COLORS.default
                                const icon  = DETECTION_ICONS[det.class]  || DETECTION_ICONS.default
                                const age   = Math.round((Date.now() - (det.timestamp || Date.now())) / 1000)
                                return (
                                    <div key={det.id ?? i} style={{
                                        display: 'flex', alignItems: 'center', gap: 10,
                                        padding: '8px 10px',
                                        background: 'rgba(255,255,255,0.03)',
                                        border: '1px solid rgba(255,255,255,0.06)',
                                        borderRadius: 8, marginBottom: 6,
                                    }}>
                                        <div style={{
                                            width: 32, height: 32, borderRadius: 8,
                                            background: color + '22', border: `1px solid ${color}44`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 16, flexShrink: 0,
                                        }}>{icon}</div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 12, fontWeight: 600, color: 'white', textTransform: 'capitalize' }}>{det.class}</div>
                                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>{age}s ago</div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontSize: 14, fontWeight: 700, color }}>{Math.round(det.confidence * 100)}%</div>
                                            <div style={{ width: 40, height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
                                                <div style={{ width: `${det.confidence * 100}%`, height: '100%', background: color, borderRadius: 2 }}/>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>

                    <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        {streamStatus === 'idle' && (
                            <button onClick={startMockMode} style={{
                                width: '100%', padding: '8px 0',
                                background: 'rgba(88,86,214,0.12)', border: '1px solid rgba(88,86,214,0.3)',
                                borderRadius: 8, color: '#5856D6', fontSize: 11, fontWeight: 700,
                                cursor: 'pointer', letterSpacing: 0.5,
                            }}>▶ Start Demo Mode</button>
                        )}
                        {(streamStatus === 'mock' || streamStatus === 'live') && (
                            <button onClick={stopFeed} style={{
                                width: '100%', padding: '8px 0',
                                background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)',
                                borderRadius: 8, color: 'rgba(255,59,48,0.7)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                            }}>◼ Stop Feed</button>
                        )}
                        {streamStatus === 'connecting' && (
                            <button onClick={handleDisconnect} style={{
                                width: '100%', padding: '8px 0',
                                background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.2)',
                                borderRadius: 8, color: 'rgba(255,149,0,0.7)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                            }}>✕ Cancel</button>
                        )}
                        {streamStatus === 'error' && (
                            <button onClick={() => { setStreamStatus('idle'); setStreamError(null) }} style={{
                                width: '100%', padding: '8px 0',
                                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 8, color: 'rgba(255,255,255,0.5)', fontSize: 11, cursor: 'pointer',
                            }}>↩ Reset</button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
