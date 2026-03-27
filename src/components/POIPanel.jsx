import { useState, useEffect, useRef, useCallback } from "react"
import API_BASE from "../apiBase.js"
import TabBar from "./TabBar.jsx"

const API = API_BASE
const PIN_CORRECT = "1010"

// ── Design tokens ─────────────────────────────────────────────────────────────
const SEC_HDR = {
    fontSize: 10, fontWeight: 700, color: "#0d9488",
    letterSpacing: "0.1em", textTransform: "uppercase",
}
const BTN_PRIMARY = {
    background: "#0d9488", color: "#0a0e14", border: "none",
    borderRadius: 3, padding: "5px 12px", fontSize: 11,
    fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
    cursor: "pointer", flexShrink: 0,
}
const BTN_SECONDARY = {
    background: "transparent", border: "1px solid rgba(255,255,255,0.12)",
    color: "#8899aa", borderRadius: 3, padding: "5px 10px",
    fontSize: 11, cursor: "pointer", flexShrink: 0,
}
const BTN_DANGER = { ...BTN_SECONDARY, color: "#dc2626", borderColor: "rgba(220,38,38,0.25)" }
const INPUT = {
    width: "100%", background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)", borderRadius: 3,
    color: "#e8edf2", fontSize: 12, padding: "6px 10px",
    outline: "none", fontFamily: "inherit", boxSizing: "border-box",
}
const TAG_COLOR = {
    target: "#dc2626", suspect: "#d97706", associate: "#0d9488", unknown: "#4a5568",
}
const REL_COLOR = {
    associate: "#3b82f6", family: "#8b5cf6", handler: "#d97706", target: "#dc2626", unknown: "#4a5568",
}
const REL_COLOR_3D = {
    associate: 0x3b82f6, family: 0x8b5cf6, handler: 0xd97706, target: 0xdc2626, unknown: 0x4a5568,
}
const SOCIAL_PLATFORM_COLOR = {
    Instagram: "#E1306C", Snapchat: "#FFFC00", TikTok: "#69C9D0",
    Twitter: "#1DA1F2", LinkedIn: "#0A66C2", Facebook: "#1877F2",
    Telegram: "#2CA5E0", WhatsApp: "#25D366", YouTube: "#FF0000",
    GitHub: "#6e5494", Reddit: "#FF4500", Other: "#4a5568",
}
const PLATFORMS = ["All", "Instagram", "Twitter", "TikTok", "LinkedIn", "Reddit", "GitHub", "YouTube", "Telegram"]
const SOCIAL_PLATFORMS = ["Instagram", "Snapchat", "TikTok", "Twitter", "LinkedIn", "Facebook", "Telegram", "WhatsApp", "YouTube", "GitHub", "Reddit", "Other"]
const REL_TYPES = ["associate", "family", "handler", "target", "unknown"]

function normalizeIdentifiers(ids) {
    return { email: "", username: "", phone: "", full_name: "", ...(ids || {}) }
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function Silhouette({ size = 48 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="48" r="22" fill="rgba(255,255,255,0.06)" />
            <circle cx="24" cy="18" r="10" fill="rgba(255,255,255,0.1)" />
        </svg>
    )
}

function Spinner() {
    return (
        <span style={{
            display: "inline-block", width: 12, height: 12,
            border: "2px solid rgba(13,148,136,0.3)", borderTopColor: "#0d9488",
            borderRadius: "50%", animation: "poiSpin 0.7s linear infinite",
        }} />
    )
}

function CollapsibleSection({ title, children, defaultOpen = true }) {
    const [open, setOpen] = useState(defaultOpen)
    return (
        <div>
            <div onClick={() => setOpen(o => !o)} style={{
                display: "flex", alignItems: "center",
                cursor: "pointer", paddingBottom: 6, marginBottom: open ? 10 : 0,
                borderBottom: "1px solid rgba(255,255,255,0.05)", userSelect: "none",
            }}>
                <span style={SEC_HDR}>{title}</span>
                <span style={{
                    color: "#4a5568", fontSize: 9, marginLeft: "auto",
                    transform: open ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.2s", display: "inline-block", lineHeight: 1,
                }}>▾</span>
            </div>
            <div style={{ overflow: "hidden", maxHeight: open ? 9999 : 0, transition: "max-height 0.2s ease" }}>
                <div style={{ paddingTop: open ? 2 : 0 }}>{children}</div>
            </div>
        </div>
    )
}

function relativeTime(iso) {
    if (!iso) return null
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 2) return "just now"
    if (mins < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconEmail() { return <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="2.5" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1"/><path d="M1 3.5l5 3.5 5-3.5" stroke="currentColor" strokeWidth="1"/></svg> }
function IconAt() { return <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="1"/><path d="M8.5 6c0 1.657 0 2.5 1.5 2.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1"/></svg> }
function IconPhone() { return <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2.5c0-.276.224-.5.5-.5h1.618l1 2.5-.75.75a6.5 6.5 0 002.382 2.382l.75-.75 2.5 1V9.5c0 .276-.224.5-.5.5C4.343 10 2 7.657 2 2.5z" stroke="currentColor" strokeWidth="1"/></svg> }
function IconPerson() { return <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="4" r="2.5" stroke="currentColor" strokeWidth="1"/><path d="M1 11c0-2.761 2.239-5 5-5s5 2.239 5 5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg> }
function IconLock({ locked }) {
    return locked
        ? <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="2" y="6" width="9" height="6" rx="1" stroke="#f59e0b" strokeWidth="1.2"/><path d="M4 6V4a2.5 2.5 0 015 0v2" stroke="#f59e0b" strokeWidth="1.2"/></svg>
        : <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="2" y="6" width="9" height="6" rx="1" stroke="#8899aa" strokeWidth="1.2"/><path d="M4 6V4a2.5 2.5 0 015 0" stroke="#8899aa" strokeWidth="1.2" strokeLinecap="round"/></svg>
}
function IconMap() { return <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 2l3.5 1.5L7.5 2 11 3.5v7L7.5 9 4.5 10.5 1 9V2z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/><path d="M4.5 2v8.5M7.5 2v7" stroke="currentColor" strokeWidth="1"/></svg> }

// ── PIN Overlay ───────────────────────────────────────────────────────────────
function PinOverlay({ onSuccess, onCancel }) {
    const [input, setInput] = useState("")
    const [shake, setShake] = useState(false)
    const MAX = PIN_CORRECT.length

    const press = (d) => {
        if (input.length >= MAX) return
        const next = input + d
        setInput(next)
        if (next.length === MAX) {
            if (next === PIN_CORRECT) { onSuccess() }
            else { setShake(true); setTimeout(() => { setShake(false); setInput("") }, 600) }
        }
    }

    return (
        <div style={{
            position: "absolute", inset: 0, zIndex: 200,
            background: "rgba(10,14,20,0.96)", backdropFilter: "blur(8px)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24,
        }}>
            <div style={{ ...SEC_HDR, fontSize: 12, letterSpacing: "0.2em" }}>Restricted Access</div>
            <div style={{
                fontSize: 28, letterSpacing: "0.5em", color: "#e8edf2",
                textAlign: "center", fontFamily: "monospace", minHeight: 36,
                animation: shake ? "pinShake 0.5s ease" : "none",
            }}>
                {Array.from({ length: MAX }, (_, i) => (
                    <span key={i} style={{ color: i < input.length ? "#0d9488" : "#2a3340" }}>●</span>
                ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 56px)", gap: 8 }}>
                {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k, i) => (
                    <button key={i} onClick={() => { if (k === "⌫") setInput(p => p.slice(0,-1)); else if (k) press(k) }}
                        style={{
                            width: 56, height: 56, borderRadius: 6, fontFamily: "inherit", fontSize: 18, fontWeight: 600,
                            background: k === "" ? "transparent" : "rgba(255,255,255,0.06)",
                            border: k === "" ? "none" : "1px solid rgba(255,255,255,0.1)",
                            color: "#e8edf2", cursor: k === "" ? "default" : "pointer",
                        }}>{k}</button>
                ))}
            </div>
            <button onClick={onCancel} style={{ ...BTN_SECONDARY, fontSize: 10 }}>Cancel</button>
        </div>
    )
}

// ── Image overlay ─────────────────────────────────────────────────────────────
function ImageOverlay({ src, onClose }) {
    return (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
            <img src={src} alt="" style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 4 }} onClick={e => e.stopPropagation()} />
            <button onClick={onClose} style={{ position: "absolute", top: 20, right: 20, background: "rgba(255,255,255,0.1)", border: "none", color: "#e8edf2", fontSize: 22, width: 38, height: 38, borderRadius: "50%", cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
    )
}

// ── Three.js loader hook ──────────────────────────────────────────────────────
function useThreeLoaded() {
    const [loaded, setLoaded] = useState(!!window.THREE)
    useEffect(() => {
        if (window.THREE) { setLoaded(true); return }
        const s = document.createElement("script")
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"
        s.onload = () => setLoaded(true)
        s.onerror = () => console.warn("[POI] Three.js failed to load from CDN")
        document.head.appendChild(s)
    }, [])
    return loaded
}

// ── 3D Relationship Graph ─────────────────────────────────────────────────────
function ThreeGraph({ poi, results, relations, allPois, isInLockedView, onSwitchPoi }) {
    const mountRef = useRef(null)
    const threeLoaded = useThreeLoaded()
    const [tooltip, setTooltip] = useState(null)

    useEffect(() => {
        if (!threeLoaded || !mountRef.current) return
        const THREE = window.THREE
        const el = mountRef.current
        let W = el.clientWidth || 400
        let H = el.clientHeight || 400

        // Build nodes
        const nodes = []
        const addN = (id, label, type, color, r, url, poiId, relType) =>
            nodes.push({ id, label, type, color, r, url, poiId, relType,
                x: (Math.random()-.5)*60, y: (Math.random()-.5)*60, z: (Math.random()-.5)*60,
                vx: 0, vy: 0, vz: 0 })

        addN("__poi__", poi.name || "POI", "poi", 0x0d9488, 18, null, null, null)
        ;(results?.holehe || []).filter(r => r.found && !r.error).forEach(r => addN(`h_${r.platform}`, r.platform, "email", 0xf59e0b, 4, r.url, null, null))
        ;(results?.sherlock || []).filter(r => !r.error).forEach(r => addN(`s_${r.platform}`, r.platform, "social", 0x2979FF, 4, r.url, null, null))
        if (results?.phone?.carrier && !results?.phone?.error) addN("phone_nd", results.phone.carrier, "phone", 0x22c55e, 4, null, null, null)

        const visRels = (relations || []).filter(rel => rel?.poi_id && rel?.relation_type).filter(rel => {
            const rp = allPois?.find(p => p.id === rel.poi_id)
            return rp && (isInLockedView ? !!rp.locked : !rp.locked)
        })
        visRels.forEach(rel => addN(`rel_${rel.poi_id}`, rel.poi_name || "?", "related_poi",
            REL_COLOR_3D[rel.relation_type] || REL_COLOR_3D.unknown, 12, null, rel.poi_id, rel.relation_type))

        // Secondary relations (relations of relations)
        const addedSecondary = new Set()
        visRels.forEach(rel => {
            const relPoi = allPois?.find(p => p.id === rel.poi_id)
            if (!relPoi) return
            ;(relPoi.relations || []).filter(r => r?.poi_id && r.poi_id !== poi.id).forEach(secRel => {
                const secId = `sec_${secRel.poi_id}`
                if (!addedSecondary.has(secId) && !nodes.find(n => n.id === `rel_${secRel.poi_id}`)) {
                    addedSecondary.add(secId)
                    addN(secId, secRel.poi_name || "?", "secondary_poi",
                        REL_COLOR_3D[secRel.relation_type] || REL_COLOR_3D.unknown, 7, null, secRel.poi_id, secRel.relation_type)
                }
            })
        })

        if (nodes.length <= 1) return

        const edgeIdxs = nodes.slice(1).map((_, i) => ({ s: 0, t: i + 1 }))

        // Force simulation
        for (let iter = 0; iter < 100; iter++) {
            for (let a = 0; a < nodes.length; a++) {
                for (let b = a + 1; b < nodes.length; b++) {
                    const dx = nodes[b].x-nodes[a].x, dy = nodes[b].y-nodes[a].y, dz = nodes[b].z-nodes[a].z
                    const d2 = dx*dx+dy*dy+dz*dz+0.1, f = 600/d2, d = Math.sqrt(d2)
                    nodes[a].vx -= dx/d*f; nodes[a].vy -= dy/d*f; nodes[a].vz -= dz/d*f
                    nodes[b].vx += dx/d*f; nodes[b].vy += dy/d*f; nodes[b].vz += dz/d*f
                }
            }
            for (const e of edgeIdxs) {
                const a = nodes[e.s], b = nodes[e.t]
                const dx = b.x-a.x, dy = b.y-a.y, dz = b.z-a.z
                const d = Math.sqrt(dx*dx+dy*dy+dz*dz)+0.1, f = (d-32)*0.04
                a.vx += dx/d*f; a.vy += dy/d*f; a.vz += dz/d*f
                b.vx -= dx/d*f; b.vy -= dy/d*f; b.vz -= dz/d*f
            }
            nodes.forEach(n => { n.x+=n.vx; n.y+=n.vy; n.z+=n.vz; n.vx*=0.75; n.vy*=0.75; n.vz*=0.75 })
        }

        // Three.js setup
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setSize(W, H)
        el.appendChild(renderer.domElement)

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(55, W/H, 0.1, 2000)
        camera.position.z = 110
        scene.add(new THREE.AmbientLight(0xffffff, 0.7))
        const dl = new THREE.DirectionalLight(0xffffff, 0.4); dl.position.set(1,2,1); scene.add(dl)

        // ResizeObserver
        const ro = new ResizeObserver(() => {
            const nW = el.clientWidth, nH = el.clientHeight
            if (!nW || !nH) return
            W = nW; H = nH
            renderer.setSize(W, H)
            camera.aspect = W / H
            camera.updateProjectionMatrix()
        })
        ro.observe(el)

        // Shared glow texture
        const gc = document.createElement("canvas"); gc.width = 64; gc.height = 64
        const gctx = gc.getContext("2d")
        const gg = gctx.createRadialGradient(32,32,0,32,32,32)
        gg.addColorStop(0,"rgba(255,255,255,1)"); gg.addColorStop(0.5,"rgba(255,255,255,0.3)"); gg.addColorStop(1,"rgba(255,255,255,0)")
        gctx.fillStyle = gg; gctx.fillRect(0,0,64,64)
        const glowTex = new THREE.CanvasTexture(gc)

        // Text label sprite factory
        function makeTextSprite(text, hexColor) {
            const c = document.createElement('canvas'); c.width = 256; c.height = 52
            const ctx = c.getContext('2d')
            ctx.clearRect(0, 0, 256, 52)
            ctx.font = 'bold 22px sans-serif'
            const r = (hexColor >> 16) & 255, g = (hexColor >> 8) & 255, b = hexColor & 255
            ctx.fillStyle = `rgb(${r},${g},${b})`
            ctx.textAlign = 'center'
            ctx.fillText(String(text).slice(0, 20), 128, 36)
            const tex = new THREE.CanvasTexture(c); tex.needsUpdate = true
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
            sp.scale.set(20, 4, 1)
            return sp
        }
        function makeEdgeLabel(text, hexColor) {
            const c = document.createElement('canvas'); c.width = 192; c.height = 40
            const ctx = c.getContext('2d')
            ctx.clearRect(0, 0, 192, 40)
            ctx.font = '600 16px sans-serif'
            const r = (hexColor >> 16) & 255, g = (hexColor >> 8) & 255, b = hexColor & 255
            ctx.fillStyle = `rgba(${r},${g},${b},0.8)`
            ctx.textAlign = 'center'
            ctx.fillText(String(text).toUpperCase().slice(0, 16), 96, 28)
            const tex = new THREE.CanvasTexture(c); tex.needsUpdate = true
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.7 }))
            sp.scale.set(14, 2.5, 1)
            return sp
        }

        const sg = new THREE.Group()
        scene.add(sg)
        const raytargets = []

        nodes.forEach(n => {
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(n.r, 16, 16),
                new THREE.MeshPhongMaterial({ color: n.color, emissive: n.color, emissiveIntensity: 0.2 })
            )
            mesh.position.set(n.x, n.y, n.z)
            mesh.userData.node = n
            sg.add(mesh); raytargets.push(mesh)
            const glowOpacity = n.type === "secondary_poi" ? 0.18 : 0.45
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: n.color, transparent: true, opacity: glowOpacity, depthWrite: false, blending: THREE.AdditiveBlending }))
            sp.scale.set(n.r*4.5, n.r*4.5, 1); mesh.add(sp)
            // Floating text label always facing camera
            const lbl = makeTextSprite(n.label, n.color)
            lbl.position.set(n.x, n.y + n.r + 6, n.z)
            sg.add(lbl)
        })

        const particles = []
        edgeIdxs.forEach(e => {
            const a = nodes[e.s], b = nodes[e.t]
            const isRel = b.type === "related_poi"
            const edgeColor = isRel ? b.color : 0x334155
            const pts = [new THREE.Vector3(a.x,a.y,a.z), new THREE.Vector3(b.x,b.y,b.z)]
            // Main edge line
            sg.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(pts),
                new THREE.LineBasicMaterial({ color: edgeColor, opacity: isRel ? 0.6 : 0.2, transparent: true })
            ))
            // Glow edge (additive blending)
            sg.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(pts),
                new THREE.LineBasicMaterial({ color: edgeColor, opacity: isRel ? 0.15 : 0.05, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
            ))
            // Relation type label at edge midpoint
            if (isRel && b.relType) {
                const el2 = makeEdgeLabel(b.relType, b.color)
                el2.position.set((a.x+b.x)/2, (a.y+b.y)/2 + 3, (a.z+b.z)/2)
                sg.add(el2)
            }
            // Only animate particles on direct relation edges
            if (isRel && b.type === "related_poi") for (let pi = 0; pi < 2; pi++) {
                const pm = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 8), new THREE.MeshBasicMaterial({ color: edgeColor, blending: THREE.AdditiveBlending, depthWrite: false }))
                sg.add(pm)
                particles.push({ mesh: pm, sx: a.x, sy: a.y, sz: a.z, ex: b.x, ey: b.y, ez: b.z, off: pi/2 })
            }
        })

        // Controls: left drag = rotate, right drag = pan, scroll = zoom
        let drag = false, rightDrag = false, px = 0, py = 0, rpx = 0, rpy = 0
        const down = e => {
            if (e.button === 0) { drag = true; px = e.clientX; py = e.clientY }
            else if (e.button === 2) { rightDrag = true; rpx = e.clientX; rpy = e.clientY; e.preventDefault() }
        }
        const move = e => {
            if (drag) { sg.rotation.y += (e.clientX-px)*0.006; sg.rotation.x += (e.clientY-py)*0.006; px = e.clientX; py = e.clientY }
            if (rightDrag) { const dx = (e.clientX-rpx)*0.08, dy = (e.clientY-rpy)*0.08; camera.position.x -= dx; camera.position.y += dy; rpx = e.clientX; rpy = e.clientY }
        }
        const up = () => { drag = false; rightDrag = false }
        const noCtxMenu = e => e.preventDefault()
        const wheel = e => { camera.position.z = Math.max(40, Math.min(400, camera.position.z + e.deltaY*0.12)); e.preventDefault() }

        // Raycasting
        const rc = new THREE.Raycaster(), mv = new THREE.Vector2()
        const getHit = e => {
            const rect = renderer.domElement.getBoundingClientRect()
            mv.x = ((e.clientX-rect.left)/W)*2-1; mv.y = -((e.clientY-rect.top)/H)*2+1
            rc.setFromCamera(mv, camera)
            const hits = rc.intersectObjects(raytargets)
            return hits.length ? hits[0].object.userData.node : null
        }
        const onClick = e => {
            const n = getHit(e)
            if (n) { const rect = renderer.domElement.getBoundingClientRect(); setTooltip({ x: e.clientX-rect.left+12, y: e.clientY-rect.top-12, label: n.label, relType: n.relType, url: n.url, poiId: n.poiId }) }
            else setTooltip(null)
        }
        const onDbl = e => {
            const n = getHit(e)
            if (n?.type === "related_poi" && n.poiId) onSwitchPoi?.(n.poiId)
            else if (n?.url) window.open(n.url, "_blank")
        }

        renderer.domElement.addEventListener("mousedown", down)
        window.addEventListener("mousemove", move)
        window.addEventListener("mouseup", up)
        renderer.domElement.addEventListener("wheel", wheel, { passive: false })
        renderer.domElement.addEventListener("click", onClick)
        renderer.domElement.addEventListener("dblclick", onDbl)
        renderer.domElement.addEventListener("contextmenu", noCtxMenu)

        let raf
        const clock = new THREE.Clock()
        const animate = () => {
            raf = requestAnimationFrame(animate)
            const t = clock.getElapsedTime()
            particles.forEach(p => {
                const prog = (t*0.33 + p.off) % 1
                p.mesh.position.set(p.sx+(p.ex-p.sx)*prog, p.sy+(p.ey-p.sy)*prog, p.sz+(p.ez-p.sz)*prog)
            })
            renderer.render(scene, camera)
        }
        animate()

        return () => {
            ro.disconnect()
            cancelAnimationFrame(raf)
            renderer.domElement.removeEventListener("mousedown", down)
            window.removeEventListener("mousemove", move)
            window.removeEventListener("mouseup", up)
            renderer.domElement.removeEventListener("wheel", wheel)
            renderer.domElement.removeEventListener("click", onClick)
            renderer.domElement.removeEventListener("dblclick", onDbl)
            renderer.domElement.removeEventListener("contextmenu", noCtxMenu)
            renderer.dispose()
            if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement)
        }
    }, [threeLoaded, poi.id, results, relations, allPois, isInLockedView]) // eslint-disable-line

    if (!threeLoaded) {
        return <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#4a5568" }}>Loading 3D engine…</div>
    }

    return (
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
            <div ref={mountRef} style={{ width: "100%", height: "100%", cursor: "grab" }} />
            {tooltip && (
                <div style={{
                    position: "absolute", left: tooltip.x, top: tooltip.y,
                    background: "rgba(10,14,20,0.95)", backdropFilter: "blur(8px)",
                    border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4,
                    padding: "6px 10px", fontSize: 11, color: "#e8edf2",
                    pointerEvents: "none", zIndex: 10, maxWidth: 180,
                }}>
                    <div style={{ fontWeight: 600 }}>{tooltip.label}</div>
                    {tooltip.relType && <div style={{ fontSize: 9, color: REL_COLOR[tooltip.relType] || "#4a5568", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>{tooltip.relType}</div>}
                    {(tooltip.url || tooltip.poiId) && <div style={{ fontSize: 9, color: "#0d9488", marginTop: 2 }}>{tooltip.poiId ? "double-click to open" : "double-click to visit"}</div>}
                </div>
            )}
        </div>
    )
}

// ── Tool result sections ──────────────────────────────────────────────────────
function ToolSection({ title, children }) {
    return (
        <div style={{ marginBottom: 14 }}>
            <div style={{ ...SEC_HDR, marginBottom: 8 }}>{title}</div>
            {children}
        </div>
    )
}

function InvestResults({ results, status }) {
    if (!results || Object.keys(results).length === 0) {
        if (status === "running") return <div style={{ fontSize: 11, color: "#8899aa", display: "flex", alignItems: "center", gap: 8 }}><Spinner /> Gathering intelligence…</div>
        return null
    }
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {status === "running" && <div style={{ fontSize: 11, color: "#0d9488", display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}><Spinner /> Investigation running…</div>}
            {results.holehe !== undefined && (
                <ToolSection title="Holehe — Email Accounts">
                    {results.holehe?.find?.(r => r.error) && <div style={{ fontSize: 11, color: "#d97706" }}>Error: {results.holehe.find(r => r.error).error}</div>}
                    {(() => {
                        const found = results.holehe?.filter?.(r => r.found && !r.error) || []
                        return found.length === 0
                            ? <div style={{ fontSize: 11, color: "#4a5568" }}>No accounts found.</div>
                            : found.map((r, i) => (
                                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                                    <span style={{ color: "#22c55e", fontSize: 12 }}>✓</span>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: "#e8edf2" }}>{r.platform}</span>
                                    {r.url && <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#0d9488", marginLeft: "auto" }}>↗</a>}
                                </div>
                            ))
                    })()}
                </ToolSection>
            )}
            {results.sherlock !== undefined && (
                <ToolSection title="Sherlock — Username Search">
                    {(() => {
                        const found = results.sherlock?.filter?.(r => !r.error) || []
                        return found.length === 0
                            ? <div style={{ fontSize: 11, color: "#4a5568" }}>No accounts found.</div>
                            : found.map((r, i) => (
                                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: "#e8edf2", minWidth: 90 }}>{r.platform}</span>
                                    {r.url && <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#0d9488" }}>↗</a>}
                                </div>
                            ))
                    })()}
                </ToolSection>
            )}
            {results.exif !== undefined && (
                <ToolSection title="EXIF — Image Metadata">
                    {results.exif?.error && <div style={{ fontSize: 11, color: "#d97706" }}>Error: {results.exif.error}</div>}
                    {results.exif && !results.exif.error && Object.keys(results.exif).length === 0 && <div style={{ fontSize: 11, color: "#4a5568" }}>No EXIF data found.</div>}
                    {results.exif && !results.exif.error && Object.entries(results.exif).map(([k, v]) => (
                        <div key={k} style={{ display: "flex", gap: 8, padding: "2px 0", fontSize: 11 }}>
                            <span style={{ color: "#4a5568", minWidth: 90, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", paddingTop: 1 }}>{k.replace(/_/g, " ")}</span>
                            <span style={{ color: "#e8edf2" }}>{String(v)}</span>
                        </div>
                    ))}
                </ToolSection>
            )}
            {results.phone !== undefined && (
                <ToolSection title="Phone Lookup">
                    {results.phone?.note && <div style={{ fontSize: 11, color: "#4a5568" }}>{results.phone.note}</div>}
                    {results.phone && !results.phone?.error && Object.entries(results.phone)
                        .filter(([k]) => !["status","note","error"].includes(k))
                        .map(([k, v]) => (
                            <div key={k} style={{ display: "flex", gap: 8, padding: "2px 0", fontSize: 11 }}>
                                <span style={{ color: "#4a5568", minWidth: 80, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", paddingTop: 1 }}>{k}</span>
                                <span style={{ color: "#e8edf2" }}>{String(v)}</span>
                            </div>
                        ))}
                </ToolSection>
            )}
            {results.mentions !== undefined && (
                <ToolSection title="Horizon Watch Mentions">
                    {results.mentions?.length === 0
                        ? <div style={{ fontSize: 11, color: "#4a5568" }}>No mentions found.</div>
                        : results.mentions?.map?.((m, i) => (
                            <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                                <div style={{ fontSize: 11, color: "#e8edf2" }}>{m.headline}</div>
                                <div style={{ fontSize: 9, color: "#4a5568", marginTop: 2 }}>
                                    {m.source === "briefing" ? "Briefing" : "Surface pool"}
                                    {m.date ? ` · ${new Date(m.date).toLocaleDateString()}` : ""}
                                </div>
                            </div>
                        ))
                    }
                </ToolSection>
            )}
        </div>
    )
}

// ── Profile Workspace ─────────────────────────────────────────────────────────
function ProfileWorkspace({ poi, isNew, onUpdate, onDuplicate, onDelete, onExport, onLockToggle, allPois, isInLockedView, onSwitchPoi }) {
    const lastInv = poi.last_investigation || null
    const normalize = (p) => ({
        ...p,
        identifiers: normalizeIdentifiers(p.identifiers),
        social_accounts: p.social_accounts || [],
        relations: p.relations || [],
        gallery_images: p.gallery_images || [],
    })

    const [local, setLocal] = useState(() => normalize(poi))
    const [photoPreview, setPhotoPreview] = useState(null)
    const [photob64, setPhotob64] = useState(null)
    const [dragging, setDragging] = useState(false)
    const [saveState, setSaveState] = useState("idle") // idle | saving | saved | error
    const [investing, setInvesting] = useState(false)
    const [investStatus, setInvestStatus] = useState((lastInv || poi.investigation_results) ? "complete" : "idle")
    const [investRes, setInvestRes] = useState(lastInv?.results || poi.investigation_results || {})
    const [investRunAt, setInvestRunAt] = useState(lastInv?.run_at || null)
    const [investErr, setInvestErr] = useState(null)
    const [platforms, setPlatforms] = useState(["All"])
    const [confirmDel, setConfirmDel] = useState(false)
    const [galOverlay, setGalOverlay] = useState(null)
    const [newGalB64s, setNewGalB64s] = useState([])
    const [removedGalIdx, setRemovedGalIdx] = useState([])
    const [addingSocial, setAddingSocial] = useState(false)
    const [newSocial, setNewSocial] = useState({ platform: "Instagram", handle: "", url: "" })
    const [addingRelation, setAddingRelation] = useState(false)
    const [newRelation, setNewRelation] = useState({ poi_id: "", poi_name: "", relation_type: "associate", notes: "" })

    const pollRef = useRef(null)
    const fileRef = useRef(null)
    const galFileRef = useRef(null)
    const nameRef = useRef(null)
    const autoSaveRef = useRef(null)

    useEffect(() => { if (isNew && nameRef.current) { nameRef.current.focus(); nameRef.current.select() } }, []) // eslint-disable-line

    useEffect(() => {
        const li = poi.last_investigation || null
        setLocal(normalize(poi))
        setInvestRes(li?.results || poi.investigation_results || {})
        setInvestStatus((li || poi.investigation_results) ? "complete" : "idle")
        setInvestRunAt(li?.run_at || null)
        setPhotoPreview(null); setPhotob64(null); setInvestErr(null)
        setNewGalB64s([]); setRemovedGalIdx([])
    }, [poi.id]) // eslint-disable-line

    useEffect(() => {
        if (!local.id) return
        autoSaveRef.current = setInterval(() => doSave(), 30000)
        return () => clearInterval(autoSaveRef.current)
    }, [local, photob64, newGalB64s, removedGalIdx]) // eslint-disable-line

    useEffect(() => () => clearInterval(pollRef.current), [])

    const patch = (field, val) => setLocal(p => ({ ...p, [field]: val }))
    const patchId = (field, val) => setLocal(p => ({ ...p, identifiers: { ...p.identifiers, [field]: val } }))

    const geocodeAddress = async (address, latField, lonField) => {
        if (!address) return
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`)
            const data = await res.json()
            if (data.length > 0) setLocal(p => ({ ...p, [latField]: parseFloat(data[0].lat), [lonField]: parseFloat(data[0].lon) }))
        } catch {}
    }

    const doSave = useCallback(async (localOverride) => {
        const src = localOverride || local
        setSaveState("saving")
        try {
            const body = { ...src }
            if (photob64) body.photo_base64 = photob64
            if (newGalB64s.length > 0) body.gallery_b64_add = newGalB64s
            if (removedGalIdx.length > 0) body.gallery_remove_indices = removedGalIdx

            // Geocode location if present and no coords yet
            if (src.location && !src.lat) {
                try {
                    const g = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(src.location)}&limit=1`)
                    const gd = await g.json()
                    if (gd.length > 0) { body.lat = parseFloat(gd[0].lat); body.lon = parseFloat(gd[0].lon) }
                } catch {}
            }

            let saved
            if (!src.id) {
                const r = await fetch(`${API}/api/poi`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
                saved = await r.json()
            } else {
                const r = await fetch(`${API}/api/poi/${src.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
                saved = await r.json()
            }
            const norm = normalize(saved)
            setLocal(norm)
            setPhotob64(null); setNewGalB64s([]); setRemovedGalIdx([])
            onUpdate(saved)
            // Notify map layer of location/photo changes
            window.dispatchEvent(new CustomEvent("akili:poi-location-updated", { detail: saved }))
            setSaveState("saved")
            setTimeout(() => setSaveState("idle"), 1500)
            return saved
        } catch (e) {
            setSaveState("error")
            setTimeout(() => setSaveState("idle"), 1500)
            throw e
        }
    }, [local, photob64, newGalB64s, removedGalIdx, onUpdate]) // eslint-disable-line

    const investigate = useCallback(async () => {
        setInvestErr(null)
        let id = local.id
        try { const s = await doSave(); id = s.id } catch (e) { setInvestErr(`Save failed: ${e.message}`); return }
        if (!id) { setInvestErr("No ID after save."); return }
        setInvesting(true); setInvestStatus("running"); setInvestRes({})
        const platList = platforms.includes("All") ? [] : platforms
        try {
            const r = await fetch(`${API}/api/poi/${id}/investigate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platforms: platList }) })
            const resp = await r.json()
            if (resp.error) throw new Error(resp.error)
        } catch (e) { setInvestErr(`Failed: ${e.message}`); setInvesting(false); return }
        clearInterval(pollRef.current)
        pollRef.current = setInterval(async () => {
            try {
                const r = await fetch(`${API}/api/poi/${id}/investigate/results`)
                const data = await r.json()
                setInvestRes(data.results || {}); setInvestStatus(data.status)
                if (data.status === "complete") {
                    clearInterval(pollRef.current); setInvesting(false)
                    const runAt = data.run_at || new Date().toISOString()
                    setInvestRunAt(runAt)
                    setLocal(prev => ({ ...prev, last_investigation: { run_at: runAt, status: "complete", results: data.results || {} } }))
                }
            } catch (e) { console.error("[POI] poll error:", e) }
        }, 2000)
    }, [local, photob64, platforms, doSave]) // eslint-disable-line

    const loadPhoto = (file) => {
        const reader = new FileReader()
        reader.onload = ev => {
            setPhotoPreview(ev.target.result)
            setPhotob64(ev.target.result.split(',')[1])
        }
        reader.readAsDataURL(file)
    }
    const loadGalleryPhoto = (file) => {
        const reader = new FileReader()
        reader.onload = ev => setNewGalB64s(prev => [...prev, ev.target.result])
        reader.readAsDataURL(file)
    }

    const togglePlatform = (p) => {
        if (p === "All") { setPlatforms(["All"]); return }
        setPlatforms(prev => { const w = prev.filter(x => x !== "All" && x !== p); const n = prev.includes(p) ? w : [...w, p]; return n.length === 0 ? ["All"] : n })
    }

    const addSocialAccount = () => {
        if (!newSocial.handle.trim()) return
        patch("social_accounts", [...(local.social_accounts || []), { ...newSocial }])
        setNewSocial({ platform: "Instagram", handle: "", url: "" }); setAddingSocial(false)
    }
    const removeSocialAccount = (idx) => patch("social_accounts", (local.social_accounts || []).filter((_, i) => i !== idx))

    // Relations — immediate backend save
    const addRelation = useCallback(async () => {
        if (!newRelation.poi_id) return
        const newRels = [...(local.relations || []), { ...newRelation }]
        const updated = { ...local, relations: newRels }
        setLocal(updated)
        setNewRelation({ poi_id: "", poi_name: "", relation_type: "associate", notes: "" })
        setAddingRelation(false)
        if (local.id) {
            console.log("[POI] addRelation → immediate save, relations:", newRels)
            await doSave(updated)
        }
    }, [local, newRelation, doSave])

    const removeRelation = useCallback(async (idx) => {
        const newRels = (local.relations || []).filter((_, i) => i !== idx)
        const updated = { ...local, relations: newRels }
        setLocal(updated)
        if (local.id) {
            console.log("[POI] removeRelation → immediate save, relations:", newRels)
            await doSave(updated)
        }
    }, [local, doSave])

    const showOnMap = () => {
        if (!local.lat || !local.lon) return
        window.dispatchEvent(new CustomEvent("akili:poi-show-on-map", {
            detail: { lat: local.lat, lon: local.lon, poiId: local.id, name: local.name, tag: local.tag },
        }))
    }

    const availableForRelation = (allPois || []).filter(p => {
        if (p.id === local.id) return false
        if ((local.relations || []).some(r => r.poi_id === p.id)) return false
        return isInLockedView ? !!p.locked : !p.locked
    })

    const ids = local.identifiers || {}
    const hasIdentifiers = Object.values(ids).some(v => v && String(v).trim())
    const canInvestigate = hasIdentifiers || photoPreview || local.photo_path

    const existingGalImages = (local.gallery_images || [])
        .map((_, i) => ({ src: `${API}/api/poi/${local.id}/gallery/${i}`, origIdx: i }))
        .filter(({ origIdx }) => !removedGalIdx.includes(origIdx))

    const saveBtnStyle = {
        ...BTN_PRIMARY,
        background: saveState === "saved" ? "#16a34a" : saveState === "error" ? "#dc2626" : "#0d9488",
        display: "flex", alignItems: "center", gap: 4, transition: "background 0.2s",
    }

    return (
        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr 380px", gridTemplateRows: "220px 1fr", width: "100%", height: "calc(100vh - 88px)", overflow: "hidden" }}>
            {/* Cell 1 [row1, col1] — Photo zone */}
            <div
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f?.type.startsWith("image/")) loadPhoto(f) }}
                onClick={() => fileRef.current?.click()}
                style={{
                    gridColumn: "1", gridRow: "1",
                    borderRight: `1px solid ${dragging ? "#0d9488" : "rgba(255,255,255,0.07)"}`,
                    borderBottom: "1px solid rgba(255,255,255,0.07)",
                    cursor: "pointer", overflow: "hidden", position: "relative",
                    background: dragging ? "rgba(13,148,136,0.06)" : "rgba(255,255,255,0.02)",
                    transition: "border-color 0.15s",
                }}>
                {(photoPreview || local.photo_path)
                    ? <img src={photoPreview || `${API}/api/poi/${local.id}/photo`} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                    : <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, pointerEvents: "none" }}>
                        <Silhouette size={72} />
                        <div style={{ fontSize: 10, color: "#4a5568" }}>Drop photo or click</div>
                      </div>
                }
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) loadPhoto(f); e.target.value = "" }} />

            {/* Cell 2 [row1, col2-3] — Info + buttons */}
            <div style={{ gridColumn: "2 / 4", gridRow: "1", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8, position: "relative", minWidth: 0, borderBottom: "1px solid rgba(255,255,255,0.07)", overflow: "hidden" }}>
                {/* Action buttons row */}
                <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "nowrap", justifyContent: "flex-end" }}>
                    <button onClick={() => doSave()} style={saveBtnStyle}>
                        {saveState === "saving" && <Spinner />}
                        {saveState === "saved" && "✓ Saved"}
                        {saveState === "error" && "✗ Failed"}
                        {saveState === "idle" && "Save"}
                    </button>
                    <button onClick={() => onDuplicate(local)} style={BTN_SECONDARY}>Duplicate</button>
                    <button onClick={() => onLockToggle(local)} style={{ ...BTN_SECONDARY, color: local.locked ? "#f59e0b" : "#8899aa", borderColor: local.locked ? "rgba(245,158,11,0.3)" : undefined, display: "flex", alignItems: "center", gap: 3, padding: "5px 8px" }}>
                        <IconLock locked={local.locked} />{local.locked ? "Locked" : "Lock"}
                    </button>
                    {(local.lat && local.lon) && (
                        <button onClick={showOnMap} style={{ ...BTN_SECONDARY, display: "flex", alignItems: "center", gap: 3, padding: "5px 8px" }}>
                            <IconMap />Map
                        </button>
                    )}
                    {confirmDel
                        ? <><span style={{ fontSize: 11, color: "#dc2626" }}>Confirm?</span>
                            <button onClick={() => { setConfirmDel(false); onDelete(local.id) }} style={{ ...BTN_DANGER, borderColor: "rgba(220,38,38,0.5)" }}>Yes</button>
                            <button onClick={() => setConfirmDel(false)} style={BTN_SECONDARY}>No</button></>
                        : <button onClick={() => setConfirmDel(true)} style={BTN_DANGER}>Delete</button>
                    }
                    <button onClick={() => onExport(local)} style={BTN_SECONDARY}>Export</button>
                </div>
                {/* Name */}
                <input ref={nameRef} value={local.name || ""} onChange={e => patch("name", e.target.value)} placeholder="Name" style={{ ...INPUT, fontSize: 24, fontWeight: 700, padding: "4px 8px", background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.1)", borderRadius: 0 }} />
                {/* Tag pill */}
                <select value={local.tag || "unknown"} onChange={e => patch("tag", e.target.value)} style={{ background: `${TAG_COLOR[local.tag || "unknown"]}22`, border: `1px solid ${TAG_COLOR[local.tag || "unknown"]}66`, color: TAG_COLOR[local.tag || "unknown"], borderRadius: 12, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", appearance: "auto", fontFamily: "inherit", letterSpacing: "0.06em", textTransform: "uppercase", alignSelf: "flex-start" }}>
                    {["target", "suspect", "associate", "unknown"].map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
                {/* Description */}
                <textarea rows={2} placeholder="Short description or alias…" value={local.description || ""} onChange={e => patch("description", e.target.value)} style={{ ...INPUT, resize: "none", lineHeight: 1.5, flex: 1, minHeight: 0 }} />
            </div>

            {/* Cell 3 [row2, col1] — Relations */}
            <div style={{ gridColumn: "1", gridRow: "2", overflowY: "auto", borderRight: "1px solid rgba(255,255,255,0.07)", padding: "10px 14px" }}>
                <div style={{ ...SEC_HDR, marginBottom: 8 }}>Relations</div>
                {(local.relations || []).length === 0 && !addingRelation && <div style={{ fontSize: 11, color: "#4a5568" }}>No relations recorded.</div>}
                {(local.relations || []).map((rel, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 3, border: "1px solid rgba(255,255,255,0.06)", marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#e8edf2", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rel.poi_name}</span>
                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 10, flexShrink: 0, background: `${REL_COLOR[rel.relation_type] || "#4a5568"}22`, color: REL_COLOR[rel.relation_type] || "#4a5568", border: `1px solid ${REL_COLOR[rel.relation_type] || "#4a5568"}44`, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{rel.relation_type}</span>
                        {rel.notes && <span style={{ fontSize: 10, color: "#4a5568", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rel.notes}</span>}
                        <button onClick={() => removeRelation(i)} style={{ ...BTN_DANGER, padding: "2px 6px", fontSize: 10 }}>×</button>
                    </div>
                ))}
                {addingRelation ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, background: "rgba(255,255,255,0.02)", borderRadius: 3, border: "1px solid rgba(255,255,255,0.08)" }}>
                        <select value={newRelation.poi_id} onChange={e => { const p = availableForRelation.find(x => x.id === e.target.value); setNewRelation(r => ({ ...r, poi_id: e.target.value, poi_name: p?.name || "" })) }} style={{ ...INPUT, appearance: "auto" }}>
                            <option value="">— Select POI —</option>
                            {availableForRelation.map(p => <option key={p.id} value={p.id}>{p.name || "Untitled"}</option>)}
                        </select>
                        <select value={newRelation.relation_type} onChange={e => setNewRelation(r => ({ ...r, relation_type: e.target.value }))} style={{ ...INPUT, appearance: "auto" }}>
                            {REL_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                        </select>
                        <input placeholder="Notes (optional)" value={newRelation.notes} onChange={e => setNewRelation(r => ({ ...r, notes: e.target.value }))} style={INPUT} />
                        <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={addRelation} style={{ ...BTN_PRIMARY, flex: 1 }}>Add</button>
                            <button onClick={() => setAddingRelation(false)} style={BTN_SECONDARY}>Cancel</button>
                        </div>
                    </div>
                ) : <button onClick={() => setAddingRelation(true)} style={{ ...BTN_PRIMARY, alignSelf: "flex-start", marginTop: 4 }}>+ Add Relation</button>}
            </div>

            {/* Cell 4 [row2, col2] — 3D Graph */}
            <div style={{ gridColumn: "2", gridRow: "2", overflow: "hidden", background: "rgba(14,20,32,0.6)" }}>
                <ThreeGraph poi={local} results={investRes} relations={local.relations} allPois={allPois} isInLockedView={isInLockedView} onSwitchPoi={onSwitchPoi} />
            </div>

            {/* Cell 5 [row2, col3] — Right fields */}
            <div style={{ gridColumn: "3", gridRow: "2", overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 16 }}>

                    {/* IDENTIFIERS */}
                    <CollapsibleSection title="Identifiers">
                        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ color: "#4a5568", flexShrink: 0 }}><IconEmail /></span>
                                <input type="email" value={ids.email || ""} onChange={e => patchId("email", e.target.value)} placeholder="Email address" style={INPUT} />
                            </div>
                            <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ color: "#4a5568", flexShrink: 0 }}><IconAt /></span>
                                    <input type="text" value={ids.username || ""} onChange={e => patchId("username", e.target.value)} placeholder="Username / handle" style={INPUT} />
                                </div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8, paddingLeft: 20 }}>
                                    {PLATFORMS.map(p => (
                                        <button key={p} onClick={() => togglePlatform(p)} style={{ fontSize: 9, padding: "2px 7px", borderRadius: 10, cursor: "pointer", background: platforms.includes(p) ? "rgba(13,148,136,0.2)" : "rgba(255,255,255,0.04)", border: `1px solid ${platforms.includes(p) ? "rgba(13,148,136,0.5)" : "rgba(255,255,255,0.1)"}`, color: platforms.includes(p) ? "#0d9488" : "#4a5568", fontWeight: platforms.includes(p) ? 700 : 400 }}>{p}</button>
                                    ))}
                                </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ color: "#4a5568", flexShrink: 0 }}><IconPhone /></span>
                                <input type="tel" value={ids.phone || ""} onChange={e => patchId("phone", e.target.value)} placeholder="Phone number" style={INPUT} />
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ color: "#4a5568", flexShrink: 0 }}><IconPerson /></span>
                                <input type="text" value={ids.full_name || ""} onChange={e => patchId("full_name", e.target.value)} placeholder="Full name (as in documents)" style={INPUT} />
                            </div>
                        </div>
                    </CollapsibleSection>

                    {/* SOCIAL ACCOUNTS */}
                    <CollapsibleSection title="Social Accounts">
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {(local.social_accounts || []).length === 0 && !addingSocial && <div style={{ fontSize: 11, color: "#4a5568" }}>No accounts added.</div>}
                            {(local.social_accounts || []).map((acc, i) => (
                                <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 3, border: "1px solid rgba(255,255,255,0.06)" }}>
                                    <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: SOCIAL_PLATFORM_COLOR[acc.platform] || "#4a5568" }} />
                                    <span style={{ fontSize: 10, color: "#8899aa", minWidth: 58, flexShrink: 0 }}>{acc.platform}</span>
                                    <span style={{ fontSize: 11, color: "#e8edf2", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>@{acc.handle}</span>
                                    {acc.url && <a href={acc.url} target="_blank" rel="noreferrer" style={{ fontSize: 9, color: "#0d9488", flexShrink: 0 }}>↗</a>}
                                    <button onClick={() => removeSocialAccount(i)} style={{ ...BTN_DANGER, padding: "2px 6px", fontSize: 10 }}>×</button>
                                </div>
                            ))}
                            {addingSocial ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, background: "rgba(255,255,255,0.02)", borderRadius: 3, border: "1px solid rgba(255,255,255,0.08)" }}>
                                    <select value={newSocial.platform} onChange={e => setNewSocial(s => ({ ...s, platform: e.target.value }))} style={{ ...INPUT, appearance: "auto" }}>
                                        {SOCIAL_PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                    <input placeholder="Username / handle" value={newSocial.handle} onChange={e => setNewSocial(s => ({ ...s, handle: e.target.value }))} style={INPUT} />
                                    <input placeholder="URL (optional)" value={newSocial.url} onChange={e => setNewSocial(s => ({ ...s, url: e.target.value }))} style={INPUT} />
                                    <div style={{ display: "flex", gap: 6 }}>
                                        <button onClick={addSocialAccount} style={{ ...BTN_PRIMARY, flex: 1 }}>Save</button>
                                        <button onClick={() => setAddingSocial(false)} style={BTN_SECONDARY}>Cancel</button>
                                    </div>
                                </div>
                            ) : <button onClick={() => setAddingSocial(true)} style={{ ...BTN_PRIMARY, alignSelf: "flex-start", marginTop: 4 }}>+ Add Account</button>}
                        </div>
                    </CollapsibleSection>

                    {/* PERSONAL */}
                    <CollapsibleSection title="Personal">
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ display: "flex", gap: 8 }}>
                                <input type="number" placeholder="Age" value={local.age || ""} onChange={e => patch("age", e.target.value)} style={{ ...INPUT, width: "42%", flexShrink: 0 }} />
                                <select value={local.sex || ""} onChange={e => patch("sex", e.target.value)} style={{ ...INPUT, appearance: "auto", width: "58%" }}>
                                    <option value="">Sex</option>
                                    {["Male","Female","Other","Unknown"].map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <input placeholder="Nationality" value={local.nationality || ""} onChange={e => patch("nationality", e.target.value)} style={INPUT} />
                            <input placeholder="Occupation" value={local.occupation || ""} onChange={e => patch("occupation", e.target.value)} style={INPUT} />
                            <div>
                                <input placeholder="Occupation address" value={local.occupation_address || ""} onChange={e => patch("occupation_address", e.target.value)} style={INPUT} />
                                {local.occupation_address && (
                                    <button onClick={() => geocodeAddress(local.occupation_address, "work_lat", "work_lon")} style={{ ...BTN_SECONDARY, marginTop: 4, fontSize: 10 }}>Geocode Work</button>
                                )}
                                {(local.work_lat && local.work_lon) && <div style={{ fontSize: 9, color: "#d97706", marginTop: 3, letterSpacing: "0.04em" }}>Work: {Number(local.work_lat).toFixed(4)}, {Number(local.work_lon).toFixed(4)}</div>}
                            </div>
                            <input placeholder="Religion" value={local.religion || ""} onChange={e => patch("religion", e.target.value)} style={INPUT} />
                        </div>
                    </CollapsibleSection>

                    {/* LOCATION */}
                    <CollapsibleSection title="Location">
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div>
                                <input placeholder="Current / Home Address" value={local.home_address || ""} onChange={e => patch("home_address", e.target.value)} style={INPUT} />
                                {local.home_address && (
                                    <button onClick={() => geocodeAddress(local.home_address, "home_lat", "home_lon")} style={{ ...BTN_SECONDARY, marginTop: 4, fontSize: 10 }}>Geocode Home</button>
                                )}
                                {(local.home_lat && local.home_lon) && <div style={{ fontSize: 9, color: "#0d9488", marginTop: 3, letterSpacing: "0.04em" }}>Home: {Number(local.home_lat).toFixed(4)}, {Number(local.home_lon).toFixed(4)}</div>}
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                                <input placeholder="Last known location" value={local.last_known_location || ""} onChange={e => patch("last_known_location", e.target.value)} style={{ ...INPUT, flex: 1 }} />
                                <input type="date" value={local.last_known_location_date || ""} onChange={e => patch("last_known_location_date", e.target.value)} style={{ ...INPUT, width: 130, flexShrink: 0, colorScheme: "dark" }} />
                            </div>
                            {(local.lat && local.lon) && <div style={{ fontSize: 9, color: "#0d9488", letterSpacing: "0.04em" }}>Geocoded: {Number(local.lat).toFixed(4)}, {Number(local.lon).toFixed(4)}</div>}
                        </div>
                    </CollapsibleSection>

                    {/* BACKGROUND */}
                    <CollapsibleSection title="Background">
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ fontSize: 10, color: "#4a5568" }}>Political Ideology</div>
                            <textarea value={local.political_ideology || ""} onChange={e => patch("political_ideology", e.target.value)} placeholder="Describe known or suspected political ideology…" rows={3} style={{ ...INPUT, resize: "vertical" }} />
                            <div style={{ fontSize: 10, color: "#4a5568" }}>Interests</div>
                            <textarea value={local.interests || ""} onChange={e => patch("interests", e.target.value)} placeholder="Known interests, hobbies, affiliations…" rows={2} style={{ ...INPUT, resize: "vertical" }} />
                        </div>
                    </CollapsibleSection>

                    {/* ASSESSMENT */}
                    <CollapsibleSection title="Assessment">
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ fontSize: 10, color: "#4a5568" }}>Strengths</div>
                            <textarea value={local.strengths || ""} onChange={e => patch("strengths", e.target.value)} placeholder="Subject strengths, resources, capabilities…" rows={2} style={{ ...INPUT, resize: "vertical" }} />
                            <div style={{ fontSize: 10, color: "#4a5568" }}>Weaknesses</div>
                            <textarea value={local.weaknesses || ""} onChange={e => patch("weaknesses", e.target.value)} placeholder="Subject vulnerabilities, limitations…" rows={2} style={{ ...INPUT, resize: "vertical" }} />
                        </div>
                    </CollapsibleSection>

                    {/* NOTES */}
                    <div>
                        <div style={{ ...SEC_HDR, marginBottom: 6 }}>Notes</div>
                        <textarea value={local.notes || ""} onChange={e => patch("notes", e.target.value)} placeholder="Intelligence notes, field observations…" style={{ ...INPUT, resize: "vertical", lineHeight: 1.6, minHeight: 70 }} />
                    </div>

                    {/* INVESTIGATE */}
                    <div>
                        {investErr && <div style={{ fontSize: 11, color: "#d97706", background: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.2)", borderRadius: 3, padding: "6px 10px", marginBottom: 8 }}>{investErr}</div>}
                        <button onClick={investigate} disabled={investing || !canInvestigate} style={{ ...BTN_PRIMARY, width: "100%", justifyContent: "center", display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", fontSize: 12, opacity: (investing || !canInvestigate) ? 0.45 : 1 }}>
                            {investing && <Spinner />}{investing ? "Investigating…" : "Investigate"}
                        </button>
                        {!canInvestigate && <div style={{ fontSize: 10, color: "#4a5568", marginTop: 5 }}>Add at least one identifier or photo.</div>}
                    </div>

                    {/* INVESTIGATION RESULTS */}
                    {(investStatus !== "idle" || Object.keys(investRes).length > 0) && (
                        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 14 }}>
                            {investRunAt && investStatus !== "running" && <div style={{ fontSize: 10, color: "#4a5568", marginBottom: 10 }}>Last investigated {relativeTime(investRunAt)}</div>}
                            <InvestResults results={investRes} status={investStatus} />
                        </div>
                    )}

                    {/* ADDITIONAL IMAGES */}
                    <CollapsibleSection title="Additional Images" defaultOpen={false}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {existingGalImages.map(({ src, origIdx }) => (
                                <div key={`e${origIdx}`} className="poi-gal-thumb" style={{ position: "relative", width: 60, height: 60 }}>
                                    <img src={src} onClick={() => setGalOverlay(src)} style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 4, cursor: "pointer", background: "rgba(255,255,255,0.04)", display: "block" }} alt="" />
                                    <button onClick={e => { e.stopPropagation(); setRemovedGalIdx(prev => [...prev, origIdx]) }} className="poi-gal-del" style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,0.75)", border: "none", color: "#fff", fontSize: 11, width: 16, height: 16, borderRadius: "50%", cursor: "pointer", display: "none", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0 }}>×</button>
                                </div>
                            ))}
                            {newGalB64s.map((b64, i) => (
                                <div key={`n${i}`} className="poi-gal-thumb" style={{ position: "relative", width: 60, height: 60 }}>
                                    <img src={b64} onClick={() => setGalOverlay(b64)} style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 4, cursor: "pointer", display: "block" }} alt="" />
                                    <button onClick={e => { e.stopPropagation(); setNewGalB64s(prev => prev.filter((_, j) => j !== i)) }} className="poi-gal-del" style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,0.75)", border: "none", color: "#fff", fontSize: 11, width: 16, height: 16, borderRadius: "50%", cursor: "pointer", display: "none", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0 }}>×</button>
                                </div>
                            ))}
                            <button onClick={() => galFileRef.current?.click()} style={{ width: 60, height: 60, borderRadius: 4, background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.12)", color: "#4a5568", fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                        </div>
                        <input ref={galFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) loadGalleryPhoto(f); e.target.value = "" }} />
                    </CollapsibleSection>

                </div>

            {galOverlay && <ImageOverlay src={galOverlay} onClose={() => setGalOverlay(null)} />}

            <style>{`
                @keyframes poiSpin { to { transform: rotate(360deg); } }
                @keyframes pinShake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)} 60%{transform:translateX(-6px)} 80%{transform:translateX(6px)} }
                .poi-gal-thumb:hover .poi-gal-del { display: flex !important; }
            `}</style>
        </div>
    )
}

// ── Full-page POI workspace ───────────────────────────────────────────────────
function useIsMobile() {
    const [v, setV] = useState(() => typeof window !== "undefined" && window.innerWidth < 768)
    useEffect(() => {
        const h = () => setV(window.innerWidth < 768)
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])
    return v
}

export default function POIPanel({ onClose }) {
    const isMobile = useIsMobile()
    const [pois, setPois] = useState([])
    const [selected, setSelected] = useState(null)
    const [loading, setLoading] = useState(true)
    const [newlyCreated, setNewlyCreated] = useState(null)
    const [newError, setNewError] = useState(null)
    const [openPoiIds, setOpenPoiIds] = useState([])
    const [sidebarTab, setSidebarTab] = useState("main")
    const [lockedAuth, setLockedAuth] = useState(false)
    const [showPin, setShowPin] = useState(false)

    const fetchPois = useCallback(async () => {
        try {
            const r = await fetch(`${API}/api/poi`)
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            const data = await r.json()
            if (Array.isArray(data)) setPois(data.map(p => ({ ...p, identifiers: normalizeIdentifiers(p.identifiers) })))
        } catch (e) { console.error("[POI] fetch error:", e) }
        finally { setLoading(false) }
    }, [])

    useEffect(() => { fetchPois() }, [fetchPois])

    const visiblePois = pois.filter(p => sidebarTab === "locked" ? !!p.locked : !p.locked)
    const selectedPoi = pois.find(p => p.id === selected) || null
    const isInLockedView = sidebarTab === "locked"

    const openSubTab = useCallback((id) => { setSelected(id); setOpenPoiIds(prev => prev.includes(id) ? prev : [...prev, id]) }, [])
    const closeSubTab = useCallback((id) => {
        setOpenPoiIds(prev => {
            const next = prev.filter(x => x !== id)
            if (selected === id) { const idx = prev.indexOf(id); setSelected(next[idx] ?? next[idx-1] ?? next[0] ?? null) }
            return next
        })
    }, [selected])
    const reorderSubTabs = useCallback((fromIdx, toIdx) => {
        setOpenPoiIds(prev => { const n = [...prev]; const [m] = n.splice(fromIdx,1); n.splice(toIdx,0,m); return n })
    }, [])

    const handleUpdate = useCallback((saved) => {
        const norm = { ...saved, identifiers: normalizeIdentifiers(saved.identifiers) }
        setPois(prev => { const idx = prev.findIndex(p => p.id === saved.id); if (idx >= 0) { const n = [...prev]; n[idx] = norm; return n } return [...prev, norm] })
        setSelected(saved.id)
    }, [])

    const handleNew = useCallback(async () => {
        setNewError(null)
        try {
            const r = await fetch(`${API}/api/poi`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "New Profile", tag: "unknown", locked: sidebarTab === "locked" }) })
            if (!r.ok) throw new Error(`Server error ${r.status}`)
            const saved = await r.json()
            if (!saved.id) throw new Error("No ID returned")
            const norm = { ...saved, identifiers: normalizeIdentifiers(saved.identifiers) }
            setPois(prev => [...prev, norm])
            setOpenPoiIds(prev => [...prev, saved.id])
            setNewlyCreated(saved.id); setSelected(saved.id)
        } catch (e) { setNewError(e.message) }
    }, [sidebarTab])

    const handleDuplicate = useCallback(async (poi) => {
        const r = await fetch(`${API}/api/poi`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...poi, id: undefined, name: poi.name + " (copy)", investigation_results: null }) })
        const saved = await r.json()
        const norm = { ...saved, identifiers: normalizeIdentifiers(saved.identifiers) }
        setPois(prev => [...prev, norm]); setOpenPoiIds(prev => [...prev, saved.id]); setSelected(saved.id)
    }, [])

    const handleDelete = useCallback(async (id) => {
        await fetch(`${API}/api/poi/${id}`, { method: "DELETE" })
        setPois(prev => prev.filter(p => p.id !== id))
        setOpenPoiIds(prev => prev.filter(x => x !== id)); setSelected(null)
    }, [])

    const handleLockToggle = useCallback(async (poi) => {
        try {
            const r = await fetch(`${API}/api/poi/${poi.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locked: !poi.locked }) })
            const saved = await r.json()
            setPois(prev => prev.map(p => p.id === saved.id ? { ...p, locked: saved.locked } : p))
            if (!poi.locked) { setOpenPoiIds(prev => prev.filter(x => x !== poi.id)); if (selected === poi.id) setSelected(null) }
        } catch (e) { console.error("[POI] lock error:", e) }
    }, [selected])

    const handleExport = useCallback(async (poi) => {
        const md = [`# POI Report — ${poi.name || "Unknown"}\n`, `**Tag:** ${poi.tag || "unknown"}`, poi.notes ? `\n## Notes\n${poi.notes}` : "", `\n## Identifiers\n`, Object.entries(poi.identifiers || {}).filter(([,v]) => v).map(([k,v]) => `- **${k}:** ${v}`).join("\n")].filter(Boolean).join("\n")
        try { await fetch(`${API}/api/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `POI — ${poi.name || "Unknown"}`, content: md, folder: "saved-analysis" }) }) }
        catch (e) { console.error("[POI] export error:", e) }
    }, [])

    const handleSwitchPoi = useCallback((poiId) => {
        const target = pois.find(p => p.id === poiId)
        if (!target) return
        if (target.locked && !lockedAuth) return
        setSidebarTab(target.locked ? "locked" : "main"); openSubTab(poiId)
    }, [pois, lockedAuth, openSubTab])

    const visibleOpenIds = openPoiIds.filter(id => { const p = pois.find(x => x.id === id); return p && (isInLockedView ? !!p.locked : !p.locked) })

    return (
        <div style={{ width: "100%", height: "100%", background: "var(--akili-panel-solid, #0e1420)", display: "flex", flexDirection: "column", fontFamily: "system-ui, -apple-system, sans-serif", position: "relative" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 20px", height: 44, borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "#8899aa", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px 0 0" }}>←</button>
                <span style={{ ...SEC_HDR, fontSize: 11 }}>Persons of Interest</span>
                <span style={{ fontSize: 10, color: "#4a5568" }}>{pois.filter(p => !p.locked).length} profile{pois.filter(p => !p.locked).length !== 1 ? "s" : ""}</span>
            </div>

            {/* Sub-tab row */}
            <div style={{ height: 28, flexShrink: 0, display: "flex", alignItems: "stretch", borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.18)" }}>
                <TabBar tabs={visibleOpenIds.map(id => ({ id, type: "poi", label: pois.find(p => p.id === id)?.name || "Untitled" }))} activeTabId={selected} height={28} iconSize={12} onSwitch={id => setSelected(id)} onClose={closeSubTab} onNew={handleNew} onReorder={reorderSubTabs} canClose={() => true} />
            </div>

            {/* Body */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
                {/* Sidebar — hidden on mobile when a profile is selected */}
                <div style={{ width: isMobile ? "100%" : 200, flexShrink: 0, borderRight: isMobile ? "none" : "1px solid rgba(255,255,255,0.07)", display: isMobile && selected ? "none" : "flex", flexDirection: "column", background: "rgba(10,14,20,0.5)", position: "relative" }}>
                    <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                        {[{ id: "main", label: "Profiles" }, { id: "locked", label: "Locked" }].map(tab => (
                            <button key={tab.id} onClick={() => tab.id === "locked" ? (lockedAuth ? setSidebarTab("locked") : setShowPin(true)) : setSidebarTab("main")} style={{
                                flex: 1, background: "none", border: "none",
                                borderBottom: sidebarTab === tab.id ? "2px solid #0d9488" : "2px solid transparent",
                                color: sidebarTab === tab.id ? "#e8edf2" : "#4a5568",
                                fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                                cursor: "pointer", padding: "7px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                            }}>
                                {tab.id === "locked" && <IconLock locked={lockedAuth} />}{tab.label}
                                {tab.id === "locked" && pois.filter(p => p.locked).length > 0 && <span style={{ fontSize: 9, background: "rgba(245,158,11,0.2)", color: "#f59e0b", borderRadius: 8, padding: "1px 5px" }}>{pois.filter(p => p.locked).length}</span>}
                            </button>
                        ))}
                    </div>
                    <div style={{ flex: 1, overflowY: "auto" }}>
                        {loading && <div style={{ padding: 16, fontSize: 11, color: "#4a5568" }}>Loading…</div>}
                        {!loading && visiblePois.length === 0 && <div style={{ padding: "24px 12px", fontSize: 11, color: "#4a5568", textAlign: "center" }}>No profiles yet.<br />Click New POI below.</div>}
                        {visiblePois.map(poi => (
                            <div key={poi.id} onClick={() => openSubTab(poi.id)} style={{
                                display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer",
                                borderBottom: "1px solid rgba(255,255,255,0.04)",
                                borderLeft: poi.id === selected ? "2px solid #0d9488" : "2px solid transparent",
                                background: poi.id === selected ? "rgba(13,148,136,0.06)" : "transparent", transition: "background 0.1s",
                            }}
                                onMouseEnter={e => { if (poi.id !== selected) e.currentTarget.style.background = "rgba(255,255,255,0.03)" }}
                                onMouseLeave={e => { if (poi.id !== selected) e.currentTarget.style.background = "transparent" }}>
                                <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, background: "rgba(255,255,255,0.06)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    {poi.photo_path ? <img src={`${API}/api/poi/${poi.id}/photo`} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" /> : <Silhouette size={28} />}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11, fontWeight: 600, color: "#e8edf2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{poi.name || "Untitled"}</div></div>
                                <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: TAG_COLOR[poi.tag] || TAG_COLOR.unknown }} />
                            </div>
                        ))}
                    </div>
                    <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                        <button onClick={handleNew} style={{ ...BTN_PRIMARY, width: "100%", justifyContent: "center" }}>+ New POI</button>
                        {newError && <div style={{ fontSize: 10, color: "#dc2626", marginTop: 6, wordBreak: "break-word" }}>{newError}</div>}
                    </div>
                    {showPin && <PinOverlay onSuccess={() => { setLockedAuth(true); setShowPin(false); setSidebarTab("locked") }} onCancel={() => setShowPin(false)} />}
                </div>

                {selectedPoi
                    ? (
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                            {isMobile && (
                                <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                                    <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#8899aa", cursor: "pointer", fontSize: 13, padding: 0, display: "flex", alignItems: "center", gap: 4 }}>
                                        ← Back to profiles
                                    </button>
                                </div>
                            )}
                            <ProfileWorkspace key={selectedPoi.id} poi={selectedPoi} isNew={selectedPoi.id === newlyCreated} onUpdate={handleUpdate} onDuplicate={handleDuplicate} onDelete={handleDelete} onExport={handleExport} onLockToggle={handleLockToggle} allPois={pois} isInLockedView={isInLockedView} onSwitchPoi={handleSwitchPoi} />
                        </div>
                    )
                    : !isMobile && <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#4a5568", fontSize: 13 }}>No profile selected</div>
                }
            </div>
        </div>
    )
}
