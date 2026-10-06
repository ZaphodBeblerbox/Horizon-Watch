/**
 * LocateWorkbench.jsx — where, when and which way, for one piece of footage.
 *
 * Opened from a Telegram post ("Locate", in the Inspector and the Inbox)
 * with `akili:locate` {post}. Three questions, each answered by the analyst
 * with the machine's help, never by the machine alone:
 *
 *   WHERE  The vision model reads the frame (signs, landmarks, terrain) and
 *          names places; the geocoder resolves them inside the post's
 *          country (backend locate.py). Each opens on sharp satellite
 *          imagery beside the frame; the analyst clicks the spot.
 *   WHEN   An upright object and its shadow, drawn on the frame, give the
 *          sun's elevation; at that spot the sun stood there twice a day,
 *          and a shadow's direction drawn on the satellite view picks one.
 *   WHICH WAY  An arrow along the road on the satellite view is a bearing;
 *          or a motion arrow in the frame, turned through the shadow.
 *
 * Saving moves the post's pin to the spot (POST /api/telegram/located) and
 * keeps the time and heading with it.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import SatView from "./SatView.jsx"
import { videoSrc } from "../components/TelegramMedia.jsx"
import { captureFrame, sampleFrames, fmtT } from "./frames.js"
import {
    elevationFromShadow, sunWindows, bearing, headingFromFrame, compass, solarClock, utcClock, norm360,
} from "./locateMath.js"

const EYE = { fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)" }
const BTN = {
    height: 26, padding: "0 10px", border: "1px solid var(--gline2)", background: "transparent",
    color: "var(--txt2)", font: "inherit", fontSize: 11.5, cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
}
const ON = { background: "var(--accdim)", color: "var(--txt)", border: "1px solid var(--acchi)" }
const SEG = { object: "#00E5FF", shadow: "#C9CED6", motion: "#FFB300" }
const SEG_LABEL = { object: "upright object", shadow: "its shadow", motion: "vehicle motion" }
const abs = (u) => (!u ? null : u.startsWith("http") ? u : `${API_BASE}${u}`)
const dayLabel = (ms) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })

/** The frame, with segments drawn on it in the image's own pixels. */
function Frame({ src, segs, tool, onSeg }) {
    const img = useRef(null)
    const [nat, setNat] = useState(null)
    const [drag, setDrag] = useState(null)
    const at = (e) => {
        const r = img.current.getBoundingClientRect()
        return { x: ((e.clientX - r.left) / r.width) * nat.w, y: ((e.clientY - r.top) / r.height) * nat.h }
    }
    const live = drag ? { ...segs, [drag.tool]: drag.s } : segs
    return (
        // Hugs the image (alignSelf), so the drawing layer is exactly the
        // picture — stretched to the column, a portrait video's lines landed
        // beside it.
        <div style={{ position: "relative", alignSelf: "flex-start", maxWidth: "100%", lineHeight: 0 }}>
            <img ref={img} src={src} alt="" crossOrigin="use-credentials" draggable={false}
                onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                style={{ display: "block", maxWidth: "100%", maxHeight: "62vh", userSelect: "none" }} />
            {nat && (
                <svg viewBox={`0 0 ${nat.w} ${nat.h}`} preserveAspectRatio="none"
                    onPointerDown={(e) => { if (!tool) return; e.currentTarget.setPointerCapture?.(e.pointerId); const p = at(e); setDrag({ tool, s: { x1: p.x, y1: p.y, x2: p.x, y2: p.y } }) }}
                    onPointerMove={(e) => { if (!drag) return; const p = at(e); setDrag({ ...drag, s: { ...drag.s, x2: p.x, y2: p.y } }) }}
                    onPointerUp={() => { if (drag && Math.hypot(drag.s.x2 - drag.s.x1, drag.s.y2 - drag.s.y1) > 4) onSeg(drag.tool, drag.s); setDrag(null) }}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: tool ? "crosshair" : "default", touchAction: "none" }}>
                    <defs>
                        {Object.entries(SEG).map(([k, c]) => (
                            <marker key={k} id={`fr-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                                <path d="M0 0L10 5L0 10z" fill={c} />
                            </marker>
                        ))}
                    </defs>
                    {Object.entries(live).map(([k, s]) => s && (
                        <line key={k} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={SEG[k]} strokeWidth={Math.max(2, nat.w / 300)}
                            markerEnd={k === "object" ? undefined : `url(#fr-${k})`} vectorEffect="non-scaling-stroke"
                            style={{ filter: "drop-shadow(0 0 2px rgba(0,0,0,.9))" }} />
                    ))}
                </svg>
            )}
        </div>
    )
}

export default function LocateWorkbench({ post, onClose }) {
    const vid = useRef(null)
    const [frame, setFrame] = useState(post._frame || (post.media === "video" ? null : abs(post.thumb_url)))
    const [frameNote, setFrameNote] = useState(post._frame && post._frameAt != null ? `frame at ${fmtT(post._frameAt)} of the video` : null)
    const [strip, setStrip] = useState(null)        // [{t, url}] across the video
    const [vt, setVt] = useState(post._frameAt || 0)
    const [segs, setSegs] = useState({ object: null, shadow: null, motion: null })
    const [frameTool, setFrameTool] = useState(null)
    const start = Number.isFinite(post.lat) ? { lat: post.lat, lon: post.lon } : { lat: 15.35, lon: 44.2 }
    const [view, setView] = useState({ center: start, zoom: post.precision === "site" ? 17 : 14 })
    const [mapTool, setMapTool] = useState("pin")
    const [pin, setPin] = useState(post.located ? { lat: post.located.lat, lon: post.located.lon } : null)
    const [arrows, setArrows] = useState({ shadow: null, motion: null })
    const [sugg, setSugg] = useState(null)        // {loading} | result
    const [rangeDays, setRangeDays] = useState(2)
    const [pick, setPick] = useState(0)
    const [saved, setSaved] = useState(null)

    useEffect(() => {
        const k = (e) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", k)
        return () => window.removeEventListener("keydown", k)
    }, [onClose])

    // The whole video as a strip, to find the frame without scrubbing blind.
    useEffect(() => {
        if (post.media !== "video" || frame || strip) return undefined
        let live = true
        sampleFrames(videoSrc(post), 12).then((f) => { if (live) setStrip(f) }).catch(() => { if (live) setStrip([]) })
        return () => { live = false }
    }, [post, frame, strip])

    const seek = (t) => { const v = vid.current; if (v) { v.pause(); v.currentTime = Math.max(0, Math.min(v.duration || t, t)) } }
    const step = (dt) => { const v = vid.current; if (v) seek(v.currentTime + dt) }

    const grab = () => {
        const v = vid.current
        if (!v || !v.videoWidth) return
        const shot = captureFrame(v)
        if (shot) {
            setFrame(shot)
            setFrameNote(`frame at ${fmtT(v.currentTime)} of the video`)
        } else {
            setFrame(abs(post.thumb_url)); setFrameNote("the video could not be read — using the post's still")
        }
        setSegs({ object: null, shadow: null, motion: null })
    }

    const frameB64 = async () => {
        if (!frame) return null
        if (frame.startsWith("data:")) return frame
        const img = new Image()
        img.crossOrigin = "use-credentials"
        img.src = frame
        await img.decode()
        const c = document.createElement("canvas")
        c.width = img.naturalWidth; c.height = img.naturalHeight
        c.getContext("2d").drawImage(img, 0, 0)
        return c.toDataURL("image/jpeg", 0.92)
    }

    const suggest = async () => {
        setSugg({ loading: true })
        try {
            const image_b64 = await frameB64()
            const r = await fetch(`${API_BASE}/api/locate/suggest`, {
                method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image_b64, text: post.text || post.headline || "", country_code: post.country_code,
                                       place: post.place, lat: post.lat, lon: post.lon }),
            })
            const d = await r.json()
            setSugg(r.ok ? d : { error: d.detail || `HTTP ${r.status}` })
            if (r.ok && d.candidates?.[0]) setView({ center: d.candidates[0], zoom: 16 })
        } catch (e) {
            setSugg({ error: String(e.message || e) })
        }
    }

    // WHEN
    const elevation = segs.object && segs.shadow ? elevationFromShadow(segs.object, segs.shadow) : null
    const shadowBearing = arrows.shadow ? bearing(arrows.shadow.a, arrows.shadow.b) : null
    const where = pin || (Number.isFinite(post.lat) ? { lat: post.lat, lon: post.lon } : null)
    const postedMs = Date.parse(post.posted_at) || Date.now()
    const windows = useMemo(() => {
        if (elevation == null || !where) return []
        return sunWindows({ lat: where.lat, lon: where.lon, fromMs: postedMs - rangeDays * 86400_000, toMs: postedMs,
                            elevation, azimuth: shadowBearing == null ? null : norm360(shadowBearing + 180) })
            .reverse()                                     // latest first: footage is usually posted soon after
    }, [elevation, where?.lat, where?.lon, postedMs, rangeDays, shadowBearing]) // eslint-disable-line react-hooks/exhaustive-deps
    const chosen = windows[Math.min(pick, windows.length - 1)] || null

    // WHICH WAY
    const mapHeading = arrows.motion ? bearing(arrows.motion.a, arrows.motion.b) : null
    const shadowForFrame = shadowBearing ?? (chosen ? norm360(chosen.azimuth + 180) : null)
    const frameHeading = mapHeading == null && segs.motion && segs.shadow ? headingFromFrame(segs.motion, segs.shadow, shadowForFrame) : null
    const heading = mapHeading ?? frameHeading

    const save = async (clear = false) => {
        const located = clear ? null : {
            lat: pin.lat, lon: pin.lon,
            filmed_from: chosen ? new Date(chosen.from).toISOString() : null,
            filmed_to: chosen ? new Date(chosen.to).toISOString() : null,
            sun_elevation_deg: elevation != null ? Math.round(elevation * 10) / 10 : null,
            heading_deg: heading != null ? Math.round(heading) : null,
            heading_basis: mapHeading != null ? "road on the satellite view" : frameHeading != null ? "frame, through the shadow (rough)" : null,
            method: "locate workbench",
        }
        const r = await fetch(`${API_BASE}/api/telegram/located`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channel: post.channel, msg_id: post.msg_id, located }),
        })
        setSaved(r.ok ? (clear ? "cleared" : "saved") : `failed (HTTP ${r.status})`)
    }

    const toolBtn = (cur, set, k, label) => (
        <button onClick={() => set(cur === k ? null : k)} style={{ ...BTN, ...(cur === k ? ON : null) }}>
            {SEG[k] && <i style={{ display: "inline-block", width: 10, borderTop: `3px solid ${SEG[k]}`, marginRight: 6, verticalAlign: "middle" }} />}
            {label}
        </button>
    )

    return (
        <div role="dialog" aria-label="Locate footage" style={{
            position: "fixed", inset: 0, zIndex: 60, background: "var(--bg, #0b0f16)", color: "var(--txt)",
            display: "grid", gridTemplateRows: "auto 1fr", fontSize: 12.5,
        }}>
            <header style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "12px 18px", borderBottom: "1px solid var(--gline)" }}>
                <span style={EYE}>Locate</span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{post.headline || "Telegram post"}</span>
                <span style={{ color: "var(--txt3)" }}>
                    {[post.channel_title || post.channel, post.place, `posted ${dayLabel(postedMs)} ${utcClock(postedMs)} UTC`].filter(Boolean).join(" · ")}
                </span>
                <button onClick={onClose} style={{ ...BTN, marginLeft: "auto" }}>Close · Esc</button>
            </header>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr) 340px", gap: 0, minHeight: 0 }}>
                {/* FRAME */}
                <section style={{ padding: 16, overflow: "auto", borderRight: "1px solid var(--gline)", display: "flex", flexDirection: "column", gap: 10 }}>
                    <span style={EYE}>The frame</span>
                    {!frame && post.media === "video" && (
                        <>
                            <video ref={vid} src={videoSrc(post)} crossOrigin="use-credentials" controls playsInline muted
                                onTimeUpdate={(e) => setVt(e.currentTarget.currentTime)} onSeeked={(e) => setVt(e.currentTarget.currentTime)}
                                onLoadedMetadata={(e) => { if (post._frameAt) e.currentTarget.currentTime = post._frameAt }}
                                style={{ width: "100%", maxHeight: "50vh", background: "#000" }} />
                            <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                                <button onClick={() => step(-1)} style={BTN} title="Back one second">−1 s</button>
                                <button onClick={() => step(-1 / 25)} style={BTN} title="Back one frame">◂ frame</button>
                                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "var(--txt2)", minWidth: 52, textAlign: "center" }}>{fmtT(vt)}</span>
                                <button onClick={() => step(1 / 25)} style={BTN} title="Forward one frame">frame ▸</button>
                                <button onClick={() => step(1)} style={BTN} title="Forward one second">+1 s</button>
                                <button onClick={grab} style={{ ...BTN, ...ON, marginLeft: 8 }}>Use this frame</button>
                            </div>
                            <span style={{ color: "var(--txt3)" }}>Pick the frame where the place shows best — a sign, a skyline, a mosque, a road junction, a clear shadow.</span>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 4 }}>
                                {strip == null && <span style={{ color: "var(--txt4)" }}>Laying out the video…</span>}
                                {(strip || []).map((f) => (
                                    <button key={f.t} onClick={() => seek(f.t)} title={`Go to ${fmtT(f.t)}`}
                                        style={{ padding: 0, border: Math.abs(f.t - vt) < 0.3 ? "2px solid var(--acchi)" : "1px solid var(--gline2)",
                                                 background: "#000", cursor: "pointer", position: "relative", lineHeight: 0 }}>
                                        <img src={f.url} alt="" style={{ width: "100%", display: "block" }} />
                                        <span style={{ position: "absolute", right: 2, bottom: 2, font: "10px var(--mz-font-mono)", color: "#fff",
                                                       background: "rgba(0,0,0,.6)", padding: "0 3px", lineHeight: 1.4 }}>{fmtT(f.t)}</span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    {frame && (
                        <>
                            <Frame src={frame} segs={segs} tool={frameTool} onSeg={(k, s) => { setSegs((p) => ({ ...p, [k]: s })); setFrameTool(null) }} />
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                {toolBtn(frameTool, setFrameTool, "object", "Upright object")}
                                {toolBtn(frameTool, setFrameTool, "shadow", "Its shadow")}
                                {toolBtn(frameTool, setFrameTool, "motion", "Vehicle motion")}
                                <button onClick={() => setSegs({ object: null, shadow: null, motion: null })} style={BTN}>Clear</button>
                                {post.media === "video" && <button onClick={() => { setFrame(null); setFrameNote(null) }} style={BTN}>Another frame</button>}
                            </div>
                            <span style={{ color: "var(--txt3)", lineHeight: 1.45 }}>
                                {frameTool ? `Drag along the ${SEG_LABEL[frameTool]}: ` + (frameTool === "object" ? "foot to top of a pole, wall or person." :
                                    frameTool === "shadow" ? "from the same foot to the tip of its shadow." : "the way it is travelling.")
                                    : "Draw an upright object and its shadow (same foot) for the time; a vehicle's motion for its direction."}
                                {frameNote ? ` · ${frameNote}` : ""}
                            </span>
                        </>
                    )}
                    {!frame && post.media !== "video" && <span style={{ color: "var(--txt3)" }}>This post has no picture to work from.</span>}
                </section>

                {/* SATELLITE */}
                <section style={{ padding: 16, overflow: "auto", borderRight: "1px solid var(--gline)", display: "flex", flexDirection: "column", gap: 10 }}>
                    <span style={EYE}>The ground</span>
                    <SatView center={view.center} zoom={view.zoom} onView={setView} pin={pin}
                        candidates={sugg?.candidates || []} arrows={arrows} tool={mapTool} height={430}
                        onPin={(p) => { setPin(p); setSaved(null) }}
                        onArrow={(k, a) => { setArrows((p) => ({ ...p, [k]: a })); setMapTool("pin") }} />
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {toolBtn(mapTool, setMapTool, "pin", "Filming spot")}
                        <button onClick={() => setMapTool(mapTool === "shadow" ? "pin" : "shadow")} style={{ ...BTN, ...(mapTool === "shadow" ? ON : null) }}>
                            <i style={{ display: "inline-block", width: 10, borderTop: `3px solid ${SEG.shadow}`, marginRight: 6, verticalAlign: "middle" }} />Shadow direction
                        </button>
                        <button onClick={() => setMapTool(mapTool === "motion" ? "pin" : "motion")} style={{ ...BTN, ...(mapTool === "motion" ? ON : null) }}>
                            <i style={{ display: "inline-block", width: 10, borderTop: `3px solid ${SEG.motion}`, marginRight: 6, verticalAlign: "middle" }} />Road / motion
                        </button>
                        <button onClick={() => setArrows({ shadow: null, motion: null })} style={BTN}>Clear arrows</button>
                    </div>
                    <span style={{ color: "var(--txt3)", lineHeight: 1.45 }}>
                        {mapTool === "pin" ? "Click where the camera stood, once the scene matches. Drag to pan; wheel to zoom."
                            : mapTool === "shadow" ? "Drag the way the shadows fall, matched to a building or road you can see in both."
                            : "Drag along the road, in the direction the vehicle travels."}
                    </span>
                </section>

                {/* STEPS */}
                <aside style={{ padding: 16, overflow: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <span style={EYE}>1 · Where</span>
                        <button onClick={suggest} disabled={!frame || sugg?.loading} style={{ ...BTN, ...ON, opacity: frame ? 1 : 0.5, alignSelf: "flex-start" }}>
                            {sugg?.loading ? "Reading the frame…" : "Read the frame for places"}
                        </button>
                        {sugg?.error && <span style={{ color: "#FF6B6B" }}>{sugg.error}</span>}
                        {sugg?.clues?.length > 0 && (
                            <ul style={{ margin: 0, paddingLeft: 16, color: "var(--txt2)", lineHeight: 1.45 }}>
                                {sugg.clues.map((c, i) => <li key={i}><b style={{ fontWeight: 600 }}>{c.kind}</b> — {c.detail}{c.points_to ? ` → ${c.points_to}` : ""}</li>)}
                            </ul>
                        )}
                        {sugg?.candidates && (
                            sugg.candidates.length ? sugg.candidates.map((c, i) => (
                                <button key={i} onClick={() => setView({ center: c, zoom: 16 })}
                                    style={{ ...BTN, height: "auto", padding: "6px 8px", textAlign: "left", whiteSpace: "normal", display: "flex", flexDirection: "column", gap: 2 }}>
                                    <span style={{ color: "var(--txt)" }}>{i + 1}. {c.place}
                                        {c.confidence != null ? ` · ${Math.round(c.confidence * 100)}%` : ""}
                                        {c.km_from_post != null ? ` · ${c.km_from_post} km from the post's place` : ""}</span>
                                    <span style={{ color: "var(--txt3)" }}>{c.why}</span>
                                </button>
                            )) : <span style={{ color: "var(--txt3)" }}>No place the clues point to resolved inside the country.</span>
                        )}
                        {sugg?.unresolved?.length > 0 && <span style={{ color: "var(--txt4)" }}>Not found on the map: {sugg.unresolved.join("; ")}</span>}
                        {sugg?.setting && <span style={{ color: "var(--txt3)" }}>Scene: {sugg.setting}{sugg.shadows ? ` · shadows: ${sugg.shadows}` : ""}</span>}
                        <span style={{ color: pin ? "var(--txt)" : "var(--txt3)" }}>
                            {pin ? `Filming spot ${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}` : "No spot chosen yet — the post's own place is used for the sun."}
                        </span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <span style={EYE}>2 · When</span>
                        {elevation == null ? (
                            <span style={{ color: "var(--txt3)" }}>Draw an upright object and its shadow on the frame.</span>
                        ) : (
                            <>
                                <span>Sun {elevation.toFixed(1)}° above the horizon
                                    {shadowBearing != null ? `, shadows toward ${compass(shadowBearing)} (${Math.round(shadowBearing)}°)` : ""}.</span>
                                <label style={{ color: "var(--txt3)", display: "flex", gap: 6, alignItems: "center" }}>
                                    Search the
                                    <select value={rangeDays} onChange={(e) => { setRangeDays(Number(e.target.value)); setPick(0) }}
                                        style={{ background: "transparent", color: "var(--txt)", border: "1px solid var(--gline2)", font: "inherit" }}>
                                        {[1, 2, 3, 7].map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}
                                    </select>
                                    before it was posted
                                </label>
                                {windows.length ? windows.map((w, i) => (
                                    <button key={w.from} onClick={() => setPick(i)} style={{ ...BTN, ...(chosen === w ? ON : null), height: "auto", padding: "5px 8px", textAlign: "left", whiteSpace: "normal", lineHeight: 1.4 }}>
                                        {dayLabel(w.mid)} · {utcClock(w.from)}–{utcClock(w.to)} UTC · ≈ {solarClock(w.mid, where.lon)} local sun time · sun in the {compass(w.azimuth)}
                                    </button>
                                )) : <span style={{ color: "var(--txt3)" }}>The sun never stood at that height there in that span{shadowBearing != null ? " in that direction" : ""}.</span>}
                                {shadowBearing == null && windows.length > 1 && (
                                    <span style={{ color: "var(--txt3)" }}>Each day gives a morning and an afternoon time. Draw the shadow direction on the satellite view to tell them apart.</span>
                                )}
                                <span style={{ color: "var(--txt4)", lineHeight: 1.4 }}>Holds when the object stands upright on flat ground and its shadow runs across the view, at about the object's distance.</span>
                            </>
                        )}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <span style={EYE}>3 · Which way</span>
                        {heading != null ? (
                            <span>Heading {compass(heading)} ({Math.round(heading)}°){mapHeading != null ? " — along the road on the satellite view."
                                : " — from the frame through the shadow: exact from a drone looking down, rough (±45°) from the ground."}</span>
                        ) : (
                            <span style={{ color: "var(--txt3)" }}>Drag along the road on the satellite view; or draw the vehicle's motion and a shadow on the frame once the time or the shadow direction is known.</span>
                        )}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
                        <button onClick={() => save(false)} disabled={!pin} style={{ ...BTN, ...ON, height: 32, opacity: pin ? 1 : 0.5 }}>
                            Save — move the post's pin here
                        </button>
                        {post.located && <button onClick={() => save(true)} style={BTN}>Clear the saved placement</button>}
                        {saved && <span style={{ color: saved.startsWith("failed") ? "#FF6B6B" : "var(--txt2)" }}>
                            {saved === "saved" ? "Saved. The map moves the pin on its next refresh." : saved === "cleared" ? "Cleared." : saved}</span>}
                    </div>
                </aside>
            </div>
        </div>
    )
}
