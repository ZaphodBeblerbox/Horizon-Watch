/**
 * PlaceModel.jsx — an endangered place's 3D model, turning slowly in the
 * sidebar (owner, 2026-10-12: "all we want is the 3D model slowly rotating
 * in the sidebar"): the desktop inspector card and the phone's place sheet.
 *
 * The model is the place's TYPE (placeModels.js modelTypeOf — a town square,
 * a prefecture, a refinery), a .glb from tools/make_place_models.py, shown
 * on the asset models' stage (three/stage.js): studio light, soft shadow.
 *
 *   one turn in TURN_SECONDS (20 s), driven by time, not frames;
 *   the turn stops while it is touched or dragged, and comes back after;
 *   no turn at all with prefers-reduced-motion (drag still works);
 *   a FIXED-HEIGHT box with a skeleton while loading, so nothing moves.
 *
 * three.js and its GLTFLoader are imported only when the box mounts (their
 * own chunks): the phone app's first load does not carry them. The loaded
 * file is kept per URL, so reopening a place does not fetch it again.
 */
import { useEffect, useRef, useState } from "react"
import { modelTypeOf, modelLabelOf, modelUrl, TURN_SECONDS } from "../globe/placeModels.js"

const gltfCache = new Map()           // url → Promise<THREE.Group> (cloned per use)

function loadGlb(url) {
    if (!gltfCache.has(url)) {
        const p = import("three/examples/jsm/loaders/GLTFLoader.js").then(({ GLTFLoader }) => new Promise((res, rej) => {
            new GLTFLoader().load(url, (g) => res(g.scene), undefined, rej)
        }))
        p.catch(() => gltfCache.delete(url))       // a failed fetch is retried next time
        gltfCache.set(url, p)
    }
    return gltfCache.get(url)
}

export function prefersReducedMotion() {
    try { return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches } catch { return false }
}

export default function PlaceModel({ place, height = 220, label = true, radius = 8 }) {
    const box = useRef(null)
    const type = modelTypeOf(place)
    const url = modelUrl(type)
    const [state, setState] = useState("loading")         // loading | ready | failed
    const [tries, setTries] = useState(0)
    useEffect(() => {
        const el = box.current
        if (!el) return undefined
        let stage = null, ro = null, alive = true
        setState("loading")
        Promise.all([import("./three/stage.js"), loadGlb(url)]).then(([{ createStage }, scene]) => {
            if (!alive) return
            const group = scene.clone(true)
            group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
            stage = createStage(el, { autoRotate: !prefersReducedMotion(), turnSeconds: TURN_SECONDS })
            stage.renderer.domElement.dataset.testid = "place-model-canvas"
            const fit = () => stage.resize(el.clientWidth, el.clientHeight)
            fit()
            stage.setModel({ group, setting: "land" }, { elevation: 0.5, fill: 0.95 })
            stage.start()
            ro = new ResizeObserver(fit)
            ro.observe(el)
            setState("ready")
        }).catch(() => { if (alive) setState("failed") })
        return () => { alive = false; ro?.disconnect(); stage?.dispose() }
    }, [url, tries])
    return (
        <div data-testid="place-model" data-model-type={type} data-state={state}
             style={{ position: "relative", height, borderRadius: radius, overflow: "hidden", border: "1px solid var(--gline, rgba(255,255,255,.08))",
                      background: "radial-gradient(ellipse at 50% 62%, rgba(122,167,255,.10), transparent 72%)" }}>
            <div ref={box} style={{ position: "absolute", inset: 0, cursor: "grab", touchAction: "none" }}
                 aria-label={`3D model: ${modelLabelOf(place)} — drag to turn it`} role="img" />
            {state === "loading" && (
                <div aria-hidden="true" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
                    <div className="place-model-skel" style={{ width: "46%", height: "38%", borderRadius: 10,
                        background: "linear-gradient(100deg, rgba(255,255,255,.04) 30%, rgba(255,255,255,.10) 50%, rgba(255,255,255,.04) 70%)",
                        backgroundSize: "200% 100%", animation: prefersReducedMotion() ? "none" : "placeModelShimmer 1.4s linear infinite" }} />
                    <style>{"@keyframes placeModelShimmer { from { background-position: 100% 0 } to { background-position: -100% 0 } }"}</style>
                </div>
            )}
            {state === "failed" && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center",
                              fontSize: 12.5, color: "var(--txt3, #9aa3ad)", padding: 12 }}>
                    <div>
                        The 3D model could not be loaded.
                        <div><button type="button" onClick={() => setTries((n) => n + 1)}
                                     style={{ marginTop: 8, height: 28, padding: "0 12px", borderRadius: 6, border: "1px solid var(--gline2, rgba(255,255,255,.18))",
                                              background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" }}>Retry</button></div>
                    </div>
                </div>
            )}
            {label && (
                <span style={{ position: "absolute", left: 10, right: 10, bottom: 8, fontSize: 11, color: "var(--txt4, #7d8590)",
                               whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>
                    {modelLabelOf(place)} · generic model, drag to turn
                </span>
            )}
        </div>
    )
}
