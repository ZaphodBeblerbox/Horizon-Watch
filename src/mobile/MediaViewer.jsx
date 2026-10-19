/**
 * MediaViewer.jsx — a picture or a video on the phone, full screen.
 *
 * The owner: "When we press on an image or a video in the desk, we should be
 * able to have it in full screen. That should have a smooth transition and a
 * player UI, so we can press pause, scroll forward or backward, or tap twice
 * left or right to skip 10 seconds."
 *
 * We fly instead of teleport: the media grows from where it sat on the page
 * to the whole screen while the page fades to black, and goes back into its
 * place when closed. Swiped down it follows the finger, giving a little of
 * its size; let go far or fast enough it flies home, otherwise it springs back.
 *
 *   video   tap: the controls (they hide after 2.5 s while playing)
 *           tap twice on the left or right third: back or on 10 s (again
 *           and again: 20 s, 30 s…); twice in the middle: pause or play
 *           the bar: drag anywhere along it to scrub
 *   image   tap twice: zoom in there, and out again; drag to look around
 *
 * ONE CALL. A call site does not render the viewer: `captureMedia` as an
 * onClickCapture on any box around the media opens whatever <img> or
 * <video> was tapped (inside .m2 only — the desktop shares these
 * components), or `openMedia({ src, type, poster, fromEl })` does it by
 * hand. The first call mounts <MediaViewerHost/> by itself, in its own
 * small React root inside the phone's .m2 (so the phone's tokens apply);
 * nothing in MobileApp has to know. Mounting <MediaViewerHost/> somewhere
 * by hand works too, and then the self-mounted one is never made.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { attachDrag, flingMs } from "./gesture.js"
import { containRect, dragTransform, flyFrom, fmtTime, tapZone } from "./media.js"
import "./media.css"

/* ── the one open item, and who listens ──────────────────────────────── */

let current = null
let seq = 0
let hosts = 0
let selfRoot = null, selfBox = null
const subs = new Set()
const emit = () => subs.forEach((f) => f())
const subscribe = (f) => { subs.add(f); return () => subs.delete(f) }
const snapshot = () => current

function ensureHost() {
    if (hosts > 0 || typeof document === "undefined") return
    if (selfRoot && selfBox?.isConnected) return
    // The phone was torn down and built again (sign-out, a reload of the
    // shell): the old box went with it, so start a fresh one.
    if (selfRoot) { try { selfRoot.unmount() } catch { /* already gone */ } }
    selfBox = document.createElement("div")
    selfBox.className = "m2-mv-host"
    ;(document.querySelector(".m2") || document.body).appendChild(selfBox)
    selfRoot = createRoot(selfBox)
    selfRoot.render(<MediaViewerHost self />)
}

/* A LIST, SWIPED THROUGH (owner, 2026-10-18: Home's Live footage — "swipe
   sideways to show the latest Telegram videos"): `list` items are
   { src, type, poster, fromEl (an element, or a function giving it when
   needed), title, meta, ground, onMap }; the viewer opens at `index`, a
   sideways swipe (or the arrow keys) brings the next or the previous, and
   `onIndex(i)` lets the page bring that one's card into view so closing
   flies back into it. */
function itemAt(list, index, onIndex, enter = null) {
    const it = list[index] || {}
    const fromEl = typeof it.fromEl === "function" ? it.fromEl() : it.fromEl || null
    return { id: ++seq, src: it.src, type: it.type || "image", poster: it.poster || null, fromEl, download: it.download || null,
             title: it.title || null, meta: it.meta || null, ground: !!it.ground, onMap: it.onMap || null,
             list, index, onIndex, enter }
}

/** Open a picture or a video full screen, growing from `fromEl` if given. */
export function openMedia({ src, type = "image", poster = null, fromEl = null, download = null, list = null, index = 0, onIndex = null,
                            title = null, meta = null, onMap = null }) {
    if (Array.isArray(list) && list.length) {
        const i = Math.max(0, Math.min(list.length - 1, index | 0))
        if (!list[i]?.src) return
        ensureHost()
        current = itemAt(list, i, onIndex)
        emit()
        return
    }
    if (!src) return
    ensureHost()
    current = { id: ++seq, src, type, poster, fromEl, download, title, meta, onMap }
    emit()
}

/** The next (+1) or previous (-1) of the open list; false at either end. */
export function stepMedia(dir) {
    const c = current
    if (!c?.list) return false
    const i = c.index + dir
    if (i < 0 || i >= c.list.length || !c.list[i]?.src) return false
    try { c.onIndex?.(i) } catch { /* the page's business */ }
    current = itemAt(c.list, i, c.onIndex, dir > 0 ? "r" : "l")
    emit()
    return true
}

/** onClickCapture for a box holding media: a tap on its <img> or <video> opens the viewer. */
export function captureMedia(e) {
    const t = e.target
    const isImg = typeof HTMLImageElement !== "undefined" && t instanceof HTMLImageElement
    const isVid = typeof HTMLVideoElement !== "undefined" && t instanceof HTMLVideoElement
    if (!isImg && !isVid) return
    if (!t.closest(".m2")) return                              // the desktop keeps its own behaviour
    if (t.getAttribute("aria-hidden") != null) return          // the blurred still behind a warning
    if (/blur/.test(getComputedStyle(t).filter || "")) return
    const src = t.currentSrc || t.getAttribute("src")
    if (!src) return
    e.preventDefault(); e.stopPropagation()
    const a = t.closest("a[download]")
    openMedia({ type: isVid ? "video" : "image", src, poster: isVid ? t.poster || null : null, fromEl: t,
                download: a ? { href: a.href, name: a.getAttribute("download") || "" } : null })
}

export function MediaViewerHost({ self = false }) {
    const item = useSyncExternalStore(subscribe, snapshot, snapshot)
    useEffect(() => {
        if (self) return
        hosts++
        return () => { hosts-- }
    }, [self])
    const done = useCallback(() => { current = null; emit() }, [])
    if (!item) return null
    return <Viewer key={item.id} item={item} onDone={done} />
}

/* ── the viewer ──────────────────────────────────────────────────────── */

const EASE = "cubic-bezier(.22,1,.36,1)"
const OPEN_MS = 420, CLOSE_MS = 360, SIDE_MS = 340
const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches
const tf = (t) => `translate(${t.tx}px, ${t.ty}px) scale(${t.s})`
const inset = (c) => `inset(${c[0]}px ${c[1]}px ${c[2]}px ${c[3]}px)`

function naturalOf(el, fallback) {
    if (el?.tagName === "VIDEO" && el.videoWidth) return { w: el.videoWidth, h: el.videoHeight }
    if (el?.tagName === "IMG" && el.naturalWidth) return { w: el.naturalWidth, h: el.naturalHeight }
    return fallback
}
const viewBox = () => ({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight })

function Viewer({ item, onDone }) {
    const isVideo = item.type === "video"
    const el = item.fromEl && item.fromEl.isConnected ? item.fromEl : null
    const still = useRef(reduced()).current
    // What the page was doing, to give back on the way out.
    const page = useRef(null)
    if (!page.current) {
        const r = el?.getBoundingClientRect()
        page.current = {
            natural: naturalOf(el, r ? { w: r.width, h: r.height } : { w: 16, h: 9 }),
            at: isVideo && el?.tagName === "VIDEO" ? el.currentTime || 0 : 0,
            wasPlaying: isVideo && el?.tagName === "VIDEO" ? !el.paused : false,
            // the page's copy may already know the length (a stream may not say)
            dur: isVideo && el?.tagName === "VIDEO" && Number.isFinite(el.duration) ? el.duration : 0,
            hidden: el ? (el.tagName === "VIDEO" ? el.parentElement || el : el) : null,
        }
    }
    const [target, setTarget] = useState(() => containRect(page.current.natural.w, page.current.natural.h, viewBox()))

    const rootRef = useRef(null), backRef = useRef(null), boxRef = useRef(null), stageRef = useRef(null)
    const zoomRef = useRef(null), vidRef = useRef(null), canvasRef = useRef(null)
    const phase = useRef("opening")
    const [ui, setUi] = useState(true)
    const [poke, setPoke] = useState(0)
    const [playing, setPlaying] = useState(false)
    const [muted, setMuted] = useState(false)
    const [cur, setCur] = useState(page.current.at)
    const [dur, setDur] = useState(page.current.dur)
    const [ready, setReady] = useState(false)
    const [scrub, setScrub] = useState(false)
    const [ripple, setRipple] = useState(null)
    const [closing, setClosing] = useState(false)

    // Where the media sits on the page right now, as a transform of its rest.
    const home = useCallback(() => {
        const e = item.fromEl
        if (!e || !e.isConnected) return null
        const r = e.getBoundingClientRect()
        if (!r.width || r.bottom < 0 || r.top > window.innerHeight) return null
        const fit = getComputedStyle(e).objectFit === "cover" ? "cover" : "contain"
        return flyFrom(page.current.natural, { x: r.left, y: r.top, w: r.width, h: r.height }, fit, target)
    }, [item.fromEl, target])

    const setBox = (t, clip, ms = 0, ease = EASE) => {
        const b = boxRef.current
        if (!b) return
        b.style.transition = ms ? `transform ${ms}ms ${ease}, clip-path ${ms}ms ${ease}, opacity ${ms}ms ease` : "none"
        b.style.transform = t ? tf(t) : "none"
        b.style.clipPath = clip ? inset(clip) : "inset(0px 0px 0px 0px)"
    }
    const setBack = (o, ms = 0) => {
        const b = backRef.current
        if (!b) return
        b.style.transition = ms ? `opacity ${ms}ms ease` : "none"
        b.style.opacity = String(o)
    }

    /* OPENING: from the page to the screen. The page's own copy is hidden
       meanwhile, so there is only ever one of it. */
    useLayoutEffect(() => {
        const p = page.current
        if (isVideo && el?.tagName === "VIDEO") {
            // The frame the page was on, until the full-screen video has it.
            try {
                const c = canvasRef.current
                if (c && el.videoWidth) { c.width = el.videoWidth; c.height = el.videoHeight; c.getContext("2d").drawImage(el, 0, 0) }
            } catch { /* nothing drawn: the poster stands in */ }
            el.pause()
        }
        if (p.hidden) p.hidden.style.visibility = "hidden"
        const h = still || item.enter ? null : home()
        if (item.enter && !still) {
            // the next of a list: the screen stays black, the media slides in
            setBack(1)
            setBox({ tx: (item.enter === "r" ? 1 : -1) * (window.innerWidth + 40), ty: 0, s: 1 }, null)
            boxRef.current.getBoundingClientRect()
            requestAnimationFrame(() => setBox(null, null, SIDE_MS))
        } else if (still) {
            rootRef.current.style.opacity = "0"
            requestAnimationFrame(() => { rootRef.current.style.transition = "opacity 160ms ease"; rootRef.current.style.opacity = "1" })
        } else {
            setBox(h || { tx: 0, ty: 24, s: 0.92 }, h?.clip)
            if (!h) boxRef.current.style.opacity = "0"
            setBack(0)
            boxRef.current.getBoundingClientRect()           // commit the start before moving off it
            requestAnimationFrame(() => {
                setBox(null, null, OPEN_MS)
                boxRef.current.style.opacity = "1"
                setBack(1, OPEN_MS * 0.8)
            })
        }
        const t = setTimeout(() => { phase.current = "open" }, still ? 160 : item.enter ? SIDE_MS : OPEN_MS)
        return () => {
            clearTimeout(t)
            // gone without closing (stepped to the next): the page has its copy back
            if (p.hidden) p.hidden.style.visibility = ""
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    /* SIDEWAYS: the next or the previous of the list. The media leaves to
       the side it was thrown; the next one comes in from the other. */
    const n = item.list ? item.list.length : 0
    const canStep = (dir) => n > 1 && item.index + dir >= 0 && item.index + dir < n
    const step = (dir, fromDx = 0, vx = 0) => {
        if (!canStep(dir) || phase.current !== "open") return false
        phase.current = "stepping"
        const v = vidRef.current
        if (v) v.pause()
        const w = window.innerWidth
        const ms = still ? 0 : flingMs(w - Math.abs(fromDx), vx)
        setBox({ tx: (dir > 0 ? -1 : 1) * (w + 40), ty: 0, s: 1 }, null, ms)
        setTimeout(() => {
            if (page.current.hidden) page.current.hidden.style.visibility = ""
            stepMedia(dir)
        }, ms)
        return true
    }
    const stepRef = useRef(step); stepRef.current = step

    // The phone turned: lay the media out again for the new screen.
    useEffect(() => {
        const r = () => setTarget(containRect(page.current.natural.w, page.current.natural.h, viewBox()))
        window.addEventListener("resize", r)
        return () => window.removeEventListener("resize", r)
    }, [])

    /* CLOSING: back into its place (or, if that place has scrolled away,
       a small fall and a fade), then the page has its copy again — a video
       at the moment it reached here, playing if it was. */
    const close = useCallback((ms = CLOSE_MS) => {
        if (phase.current === "closing") return
        phase.current = "closing"
        setClosing(true)
        const v = vidRef.current
        const at = v ? v.currentTime : null
        if (v) v.pause()
        const finish = () => {
            const p = page.current, e = item.fromEl
            if (p.hidden) p.hidden.style.visibility = ""
            if (isVideo && e?.tagName === "VIDEO" && e.isConnected && at != null) {
                try { e.currentTime = at } catch { /* not seekable yet */ }
                if (p.wasPlaying) { const pr = e.play(); if (pr?.catch) pr.catch(() => {}) }
            }
            onDone()
        }
        if (still) {
            rootRef.current.style.transition = "opacity 140ms ease"
            rootRef.current.style.opacity = "0"
            setTimeout(finish, 150)
            return
        }
        const h = home()
        if (zoomRef.current) { zoomRef.current.style.transition = `transform ${ms}ms ${EASE}`; zoomRef.current.style.transform = "none" }
        if (h) setBox(h, h.clip, ms)
        else { setBox({ tx: 0, ty: 40, s: 0.9 }, null, ms); boxRef.current.style.opacity = "0" }
        setBack(0, ms * 0.9)
        setTimeout(finish, ms + 20)
    }, [home, isVideo, item.fromEl, onDone, still])

    useEffect(() => {
        const k = (e) => {
            if (e.key === "Escape") { e.stopPropagation(); close() }
            else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { if (stepRef.current(e.key === "ArrowRight" ? 1 : -1)) e.stopPropagation() }
        }
        window.addEventListener("keydown", k, true)
        return () => window.removeEventListener("keydown", k, true)
    }, [close])

    /* ── the video ── */
    const play = () => {
        const v = vidRef.current
        if (!v) return
        if (v.ended) v.currentTime = 0
        const pr = v.play()
        // Sound needs the tap that opened us; if the browser has let that
        // go, play muted rather than not at all.
        if (pr?.catch) pr.catch(() => { v.muted = true; setMuted(true); const p2 = v.play(); if (p2?.catch) p2.catch(() => {}) })
    }
    const toggle = () => { const v = vidRef.current; if (!v) return; if (v.paused || v.ended) play(); else v.pause(); setPoke((n) => n + 1) }
    const onMeta = () => {
        const v = vidRef.current
        if (Number.isFinite(v.duration)) setDur(v.duration)
        if (page.current.at) { try { v.currentTime = page.current.at } catch { /* starts at the top */ } }
        play()
    }
    // The clock: once a frame while it runs, so the bar moves smoothly.
    useEffect(() => {
        if (!isVideo) return
        let raf = 0
        const tick = () => {
            const v = vidRef.current
            if (v && !scrub) { setCur(v.currentTime); if (v.duration && Number.isFinite(v.duration)) setDur(v.duration) }
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [isVideo, scrub])
    // The controls step aside while it plays.
    useEffect(() => {
        if (!ui || !playing || scrub || !isVideo) return
        const t = setTimeout(() => setUi(false), 2500)
        return () => clearTimeout(t)
    }, [ui, playing, scrub, poke, isVideo])

    const skipRef = useRef({ t: 0, zone: null, n: 0 })
    const rippleT = useRef(0)
    const skip = (zone) => {
        const v = vidRef.current
        if (!v) return
        const now = performance.now()
        const s = skipRef.current
        const n = s.zone === zone && now - s.t < 700 ? s.n + 1 : 1
        skipRef.current = { t: now, zone, n }
        const d = zone === "left" ? -10 : 10
        const to = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + d))
        try { v.currentTime = to } catch { /* not seekable */ }
        setCur(to)
        setRipple({ zone, n, key: now })
        clearTimeout(rippleT.current)
        rippleT.current = setTimeout(() => setRipple(null), 650)
    }

    /* ── the image: zoom where tapped, and look around ── */
    const zoom = useRef({ s: 1, x: 0, y: 0, bx: 0, by: 0 })
    const setZoom = (z, ms = 0) => {
        zoom.current = { ...zoom.current, ...z }
        const n = zoomRef.current
        if (!n) return
        if (zoom.current.s > 1 && boxRef.current) boxRef.current.style.clipPath = "none"   // free of its letterbox
        n.style.transition = ms ? `transform ${ms}ms ${EASE}` : "none"
        n.style.transform = `translate(${zoom.current.x}px, ${zoom.current.y}px) scale(${zoom.current.s})`
    }
    // Zoomed, the picture may spill out of its letterbox onto the whole
    // screen: kept to the screen's edges, centred on a side it does not fill.
    const clampZoom = (x, y, s) => {
        const t = targetRef.current
        const axis = (v, off, len, view) => {
            const size = len * s
            if (size <= view) return (view - size) / 2 - off
            return Math.min(-off, Math.max(view - off - size, v))
        }
        return { x: axis(x, t.x, t.w, window.innerWidth), y: axis(y, t.y, t.h, window.innerHeight) }
    }
    const zoomAt = (cx, cy) => {
        if (zoom.current.s > 1) { setZoom({ s: 1, x: 0, y: 0 }, still ? 0 : 320); return }
        const s = 2.5, px = cx - target.x, py = cy - target.y
        setZoom({ s, ...clampZoom(px * (1 - s), py * (1 - s), s) }, still ? 0 : 320)
    }

    /* ── taps: one shows or hides the controls, two act where they land ── */
    const lastTap = useRef({ t: 0, x: 0 })
    const single = useRef(0)
    const dragEnd = useRef(0)
    const onTap = (e) => {
        if (phase.current !== "open" || performance.now() - dragEnd.current < 300) return
        const r = stageRef.current.getBoundingClientRect()
        const zone = tapZone(e.clientX - r.left, r.width)
        const now = performance.now()
        // Already skipping on this side: each further tap is ten seconds more.
        if (isVideo && zone !== "mid" && skipRef.current.zone === zone && now - skipRef.current.t < 700) { clearTimeout(single.current); skip(zone); return }
        if (now - lastTap.current.t < 300 && Math.abs(e.clientX - lastTap.current.x) < 70) {
            clearTimeout(single.current)
            lastTap.current.t = 0
            if (!isVideo) zoomAt(e.clientX, e.clientY)
            else if (zone === "mid") toggle()
            else skip(zone)
            return
        }
        lastTap.current = { t: now, x: e.clientX }
        clearTimeout(single.current)
        single.current = setTimeout(() => { setUi((u) => !u); setPoke((n) => n + 1) }, 260)
    }
    useEffect(() => () => { clearTimeout(single.current); clearTimeout(rippleT.current) }, [])

    /* ── swipe down to put it away; when zoomed, the drag looks around ──
       Attached once: what changes underneath is read through refs, so a
       drag is never cut off by its own re-render. */
    const targetRef = useRef(target); targetRef.current = target
    const uiRef = useRef(ui); uiRef.current = ui
    const closeRef = useRef(close); closeRef.current = close
    useEffect(() => {
        const node = stageRef.current
        let mode = null
        return attachDrag(node, {
            start: () => phase.current === "open",
            move: ({ dx, dy, axis }) => {
                if (!mode) mode = zoom.current.s > 1 ? "pan" : axis === "y" && dy > 0 ? "down" : axis === "x" && n > 1 ? "side" : "none"
                if (mode === "side") {
                    // past either end it gives, but only a little
                    const d = canStep(dx < 0 ? 1 : -1) ? dx : dx / 3
                    setBox({ tx: d, ty: 0, s: 1 }, null)
                    if (uiRef.current) setUi(false)
                    return true
                }
                if (mode === "pan") {
                    const s = zoom.current.s
                    const { x, y } = clampZoom(zoom.current.bx + dx, zoom.current.by + dy, s)
                    setZoom({ x, y })
                    return true
                }
                if (mode !== "down") return false
                const d = dy < 0 ? dy / 3 : dy
                setBox(dragTransform(dx, d, targetRef.current, window.innerHeight), null)
                setBack(1 - Math.min(0.85, Math.max(0, d) / (window.innerHeight * 0.6)))
                if (uiRef.current) setUi(false)
                return true
            },
            end: ({ dx, dy, vx, vy, moved }) => {
                const m = mode
                mode = null
                if (moved) dragEnd.current = performance.now()
                if (m === "pan") { zoom.current.bx = zoom.current.x; zoom.current.by = zoom.current.y; return }
                if (m === "side") {
                    const dir = dx < 0 ? 1 : -1
                    if ((Math.abs(dx) > window.innerWidth * 0.2 || Math.abs(vx) > 0.45) && stepRef.current(dir, dx, vx)) return
                    setBox(null, null, still ? 0 : 320)
                    return
                }
                if (m !== "down") return
                if (dy > 110 || vy > 0.55) closeRef.current(flingMs(window.innerHeight - dy, vy))
                else { setBox(null, null, still ? 0 : 380); setBack(1, still ? 0 : 300) }
            },
        })
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    /* ── the scrubber ── */
    const track = useRef(null)
    const resume = useRef(false)
    const seekFrom = (e) => {
        const v = vidRef.current, r = track.current.getBoundingClientRect()
        if (!v || !dur) return
        const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur
        setCur(t)
        if (typeof v.fastSeek === "function" && scrub) v.fastSeek(t)
        else v.currentTime = t
    }
    const scrubDown = (e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture?.(e.pointerId)
        const v = vidRef.current
        resume.current = v ? !v.paused : false
        if (v) v.pause()
        setScrub(true)
        seekFrom(e)
    }
    const scrubMove = (e) => { if (scrub) seekFrom(e) }
    const scrubUp = (e) => {
        if (!scrub) return
        const v = vidRef.current, r = track.current.getBoundingClientRect()
        if (v && dur) v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur
        setScrub(false)
        setPoke((n) => n + 1)
        if (resume.current) play()
    }

    const frac = dur ? Math.max(0, Math.min(1, cur / dur)) : 0
    const showUi = ui && !closing
    const stop = (e) => e.stopPropagation()

    return (
        <div ref={rootRef} className="m2-mv" role="dialog" aria-modal="true" aria-label={isVideo ? "Video" : "Picture"} data-ui={showUi ? "shown" : "hidden"}>
            <div ref={backRef} className="m2-mv-back" />
            <div ref={boxRef} className="m2-mv-box" style={{ left: target.x, top: target.y, width: target.w, height: target.h }}>
                <div ref={zoomRef} className="m2-mv-zoom">
                    {isVideo ? <>
                        <video ref={vidRef} src={item.src} poster={item.poster || undefined} playsInline preload="auto"
                               onLoadedMetadata={onMeta} onPlaying={() => setReady(true)} onSeeked={() => setReady(true)}
                               onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setUi(true) }}
                               onVolumeChange={(e) => setMuted(e.currentTarget.muted)} />
                        <canvas ref={canvasRef} className="m2-mv-frame" style={{ opacity: ready ? 0 : 1 }} aria-hidden />
                    </> : <img src={item.src} alt="" draggable={false} />}
                </div>
            </div>
            <div ref={stageRef} className="m2-mv-stage" onClick={onTap} />

            {ripple && (
                <div key={ripple.key} className={`m2-mv-ripple ${ripple.zone}`} aria-hidden>
                    <span>
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">{ripple.zone === "left"
                            ? <path d="M11 6v12l-8.5-6L11 6zm9.5 0v12L12 12l8.5-6z" />
                            : <path d="M13 6v12l8.5-6L13 6zM3.5 6v12L12 12 3.5 6z" />}</svg>
                        {ripple.n * 10} s
                    </span>
                </div>
            )}

            <div className="m2-mv-top" onClick={stop}>
                <button className="m2-mv-btn" aria-label="Close" onClick={() => close()}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
                <span style={{ flex: 1 }} />
                {n > 1 && <span className="m2-mv-count">{item.index + 1} / {n}</span>}
                <span style={{ flex: 1 }} />
                {item.download && (
                    <a className="m2-mv-btn" href={item.download.href} download={item.download.name} aria-label="Save">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
                    </a>
                )}
                {isVideo && (
                    <button className="m2-mv-btn" aria-label={muted ? "Sound on" : "Sound off"} onClick={() => { const v = vidRef.current; if (v) { v.muted = !v.muted; setPoke((n) => n + 1) } }}>
                        {muted
                            ? <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6" /></svg>
                            : <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></svg>}
                    </button>
                )}
            </div>

            {n > 1 && canStep(-1) && (
                <button className="m2-mv-btn m2-mv-side left" aria-label="Previous" onClick={(e) => { stop(e); step(-1) }}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
                </button>
            )}
            {n > 1 && canStep(1) && (
                <button className="m2-mv-btn m2-mv-side right" aria-label="Next" onClick={(e) => { stop(e); step(1) }}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
                </button>
            )}

            {(item.title || item.meta || item.onMap) && (
                <div className={`m2-mv-cap${isVideo ? " over-bar" : ""}`} onClick={stop} data-testid="mv-caption">
                    {(item.meta || item.ground) && <span className="m2-mv-cap-meta">{[item.meta, item.ground ? "on the ground" : null].filter(Boolean).join(" · ")}</span>}
                    {item.title && <span className="m2-mv-cap-t">{item.title}</span>}
                    {item.onMap && (
                        <button className="m2-mv-pill" onClick={() => { const go = item.onMap; close(); setTimeout(go, still ? 160 : CLOSE_MS + 30) }}>
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></svg>
                            Show on map
                        </button>
                    )}
                </div>
            )}

            {isVideo && !playing && !scrub && (
                <button className="m2-mv-big" aria-label="Play" onClick={(e) => { stop(e); toggle() }}>
                    <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
                </button>
            )}

            {isVideo && (
                <div className="m2-mv-bar" onClick={stop}>
                    <button className="m2-mv-btn bare" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
                        {playing
                            ? <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
                            : <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>}
                    </button>
                    <span className="m2-mv-time">{fmtTime(cur)}</span>
                    <div ref={track} className={`m2-mv-scrub${scrub ? " on" : ""}`} role="slider" aria-label="Position"
                         aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(cur)} aria-valuetext={`${fmtTime(cur)} of ${fmtTime(dur)}`}
                         onPointerDown={scrubDown} onPointerMove={scrubMove} onPointerUp={scrubUp} onPointerCancel={scrubUp}>
                        <i className="m2-mv-rail"><i className="m2-mv-fill" style={{ transform: `scaleX(${frac})` }} /></i>
                        <i className="m2-mv-knob" style={{ left: `${frac * 100}%` }} />
                    </div>
                    <span className="m2-mv-time">{fmtTime(dur)}</span>
                </div>
            )}
        </div>
    )
}
