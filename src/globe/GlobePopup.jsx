import { useState, useEffect, useRef } from "react"
import { ScreenSpaceEventHandler, ScreenSpaceEventType, defined, SceneTransforms } from "cesium"
import { getEntity } from "./entityStore.js"
import GlobeAircraftPopup from "./GlobeAircraftPopup.jsx"
import GlobeVesselPopup from "./GlobeVesselPopup.jsx"

export default function GlobePopup({ viewerRef }) {
    const [popup, setPopup] = useState(null)
    const handlerRef = useRef(null)

    useEffect(() => {
        let attempts = 0
        function tryMount() {
            const viewer = viewerRef.current?.cesiumElement
            if (!viewer) {
                if (attempts++ < 15) setTimeout(tryMount, 200)
                return
            }

            const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
            handler.setInputAction((click) => {
                const picked = viewer.scene.pick(click.position)
                if (defined(picked) && picked.id) {
                    const entity   = picked.id
                    const entityId = entity.id
                    const pos = entity.position?.getValue(viewer.clock.currentTime)
                    const sp  = pos ? SceneTransforms.worldToWindowCoordinates(viewer.scene, pos) : null
                    const x   = sp ? sp.x : click.position.x
                    const y   = sp ? sp.y : click.position.y

                    // Prefer typed popup from entity store
                    const stored = getEntity(entityId)
                    if (stored) {
                        setPopup({ type: stored.type, data: stored.data, x, y, entityId })
                        return
                    }

                    // Fall back to description HTML
                    const rawDesc = entity.description
                    if (rawDesc) {
                        const html = typeof rawDesc.getValue === "function"
                            ? rawDesc.getValue(viewer.clock.currentTime)
                            : rawDesc
                        if (html) {
                            setPopup({ type: "html", html, x, y, entityId })
                            return
                        }
                    }
                }
                setPopup(null)
            }, ScreenSpaceEventType.LEFT_CLICK)

            handlerRef.current = handler
        }
        tryMount()
        return () => { handlerRef.current?.destroy(); handlerRef.current = null }
    }, [viewerRef])

    // Keep popup anchored as camera moves
    useEffect(() => {
        if (!popup) return
        const viewer = viewerRef.current?.cesiumElement
        if (!viewer) return
        const entity = viewer.entities.getById(popup.entityId)
        if (!entity) return

        const update = () => {
            const pos = entity.position?.getValue(viewer.clock.currentTime)
            if (pos) {
                const sp = SceneTransforms.worldToWindowCoordinates(viewer.scene, pos)
                if (sp) setPopup(p => p ? { ...p, x: sp.x, y: sp.y } : null)
            }
        }
        viewer.scene.postRender.addEventListener(update)
        return () => viewer.scene.postRender.removeEventListener(update)
    }, [popup?.entityId, viewerRef])

    if (!popup) return null

    const left = Math.min(popup.x + 14, (window.innerWidth || 1200) - 310)
    const top  = Math.max(popup.y - 80, 56)

    const handleClose = () => setPopup(null)
    const handleFollow = () => {
        const viewer = viewerRef.current?.cesiumElement
        if (!viewer) return
        const entity = viewer.entities.getById(popup.entityId)
        if (entity) viewer.trackedEntity = entity
        setPopup(null)
    }

    return (
        <div
            style={{
                position:      "absolute",
                left,
                top,
                zIndex:        10000,
                width:         300,
                maxHeight:     520,
                overflowY:     "auto",
                background:    "#0F1721",
                border:        "1px solid #2C3645",
                borderRadius:  8,
                boxShadow:     "0 8px 32px rgba(0,0,0,0.7)",
                pointerEvents: "auto",
            }}
        >
            {popup.type === "aircraft" ? (
                <GlobeAircraftPopup data={popup.data} onClose={handleClose} onFollow={handleFollow} />
            ) : popup.type === "vessel" ? (
                <GlobeVesselPopup data={popup.data} onClose={handleClose} onFollow={handleFollow} />
            ) : (
                <>
                    <button
                        onClick={handleClose}
                        style={{
                            position:   "absolute",
                            top:        6,
                            right:      8,
                            background: "transparent",
                            border:     "none",
                            color:      "#9AA4B5",
                            cursor:     "pointer",
                            fontSize:   18,
                            lineHeight: 1,
                            zIndex:     1,
                            padding:    0,
                        }}
                    >×</button>
                    {/* eslint-disable-next-line react/no-danger */}
                    <div dangerouslySetInnerHTML={{ __html: popup.html }} />
                </>
            )}
        </div>
    )
}
