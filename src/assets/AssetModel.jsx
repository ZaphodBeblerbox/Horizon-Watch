/**
 * AssetModel.jsx — an asset kind's 3D model, turning slowly; drag to look
 * round it, scroll to come closer. One live WebGL view: use it for the one
 * asset in focus, and AssetThumb for lists (browsers allow ~16 live views).
 */
import { useEffect, useRef } from "react"

export default function AssetModel({ kind, height = 420, autoRotate = true }) {
    const box = useRef(null)
    useEffect(() => {
        const el = box.current
        if (!el || !kind) return undefined
        let stage = null, ro = null, alive = true
        Promise.all([import("./three/stage.js"), import("./three/index.js")]).then(([{ createStage }, { build }]) => {
            if (!alive) return
            const built = build(kind)
            if (!built) return
            stage = createStage(el, { autoRotate })
            const fit = () => stage.resize(el.clientWidth, el.clientHeight)
            fit()
            stage.setModel(built)
            stage.start()
            ro = new ResizeObserver(fit)
            ro.observe(el)
        })
        return () => { alive = false; ro?.disconnect(); stage?.dispose() }
    }, [kind, autoRotate])
    return <div ref={box} style={{ width: "100%", height, cursor: "grab", touchAction: "none" }} aria-label="3D model — drag to turn it" />
}
