/**
 * AssetThumb.jsx — a still render of an asset kind's model, for lists and
 * pickers. One shared offscreen renderer draws each kind once (in the
 * idle time after the page settles) and the image is kept for the session.
 */
import { useEffect, useState } from "react"
import AssetFigure from "./AssetFigure.jsx"

const cache = new Map()            // kind -> data URL
const waiting = new Map()          // kind -> [resolve]
let queue = Promise.resolve()
let stage = null

function render(kind) {
    if (cache.has(kind)) return Promise.resolve(cache.get(kind))
    if (waiting.has(kind)) return new Promise((r) => waiting.get(kind).push(r))
    waiting.set(kind, [])
    queue = queue.then(async () => {
        const [{ createStage }, { build }] = await Promise.all([import("./three/stage.js"), import("./three/index.js")])
        const built = build(kind)
        let url = null
        if (built) {
            if (!stage) { stage = createStage(null, { interactive: false, preserve: true, pixelRatio: 1 }); stage.resize(480, 300) }
            stage.setModel(built)
            stage.render()
            url = stage.renderer.domElement.toDataURL("image/png")
        }
        cache.set(kind, url)
        for (const r of waiting.get(kind) || []) r(url)
        waiting.delete(kind)
        await new Promise((r) => setTimeout(r, 0))          // let the page breathe between renders
        return url
    })
    return queue.then(() => cache.get(kind))
}

export default function AssetThumb({ kind, group, width = 96, height = 60 }) {
    const [url, setUrl] = useState(() => cache.get(kind) || null)
    useEffect(() => {
        let live = true
        if (!kind) return undefined
        if (cache.has(kind)) { setUrl(cache.get(kind)); return undefined }
        render(kind).then((u) => { if (live) setUrl(u) }).catch(() => {})
        return () => { live = false }
    }, [kind])
    if (!url) return <span style={{ width, height, display: "grid", placeItems: "center", flex: "none" }}><AssetFigure group={group} size={Math.min(width, height) * 0.6} /></span>
    return <img src={url} alt="" width={width} height={height} style={{ width, height, objectFit: "contain", flex: "none" }} />
}
