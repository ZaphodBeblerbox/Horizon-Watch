import { useState, useEffect, useRef } from "react"
import * as Cesium from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { FORGE_EXPLANATIONS } from "../constants/alertIcons.js"

const DOMAIN_SIGNAL_COLORS = {
    AIS:      "#3366CC",
    ADSB:     "#6644AA",
    NEWS:     "#885522",
    SENTINEL: "#226644",
    SURGE:    "#AA5500",
    FUSION:   "#4433AA",
}

function useFusionSignals(fusion, viewerRef) {
    const entitiesRef = useRef([])

    const clearEntities = () => {
        const viewer = viewerRef?.current?.cesiumElement
        if (!viewer) return
        entitiesRef.current.forEach(e => { try { viewer.entities.remove(e) } catch {} })
        entitiesRef.current = []
    }

    useEffect(() => {
        const viewer = viewerRef?.current?.cesiumElement
        if (!viewer || !fusion?.fusion_id) return

        const fid = fusion.fusion_id
        const fLat = fusion.lat
        const fLon = fusion.lon

        fetch(`${API_BASE}/api/fusions/${fid}/signals`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data?.signals?.length) return
                const fusionPos = fLat != null && fLon != null
                    ? Cesium.Cartesian3.fromDegrees(fLon, fLat)
                    : null

                data.signals.forEach(sig => {
                    if (!sig.lat || !sig.lon) return
                    const sigPos = Cesium.Cartesian3.fromDegrees(sig.lon, sig.lat)
                    const hexColor = DOMAIN_SIGNAL_COLORS[sig.domain] || "#336699"
                    const color = Cesium.Color.fromCssColorString(hexColor)

                    // Connecting line from signal to fusion centroid
                    if (fusionPos) {
                        entitiesRef.current.push(viewer.entities.add({
                            polyline: {
                                positions: [sigPos, fusionPos],
                                width: 1,
                                material: new Cesium.ColorMaterialProperty(color.withAlpha(0.35)),
                                clampToGround: false,
                            },
                        }))
                    }

                    // Signal point
                    entitiesRef.current.push(viewer.entities.add({
                        position: sigPos,
                        point: {
                            pixelSize: 6,
                            color: color.withAlpha(0.85),
                            outlineColor: Cesium.Color.BLACK.withAlpha(0.5),
                            outlineWidth: 1,
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        },
                        label: {
                            text: sig.domain || "",
                            font: '500 9px "IBM Plex Mono", monospace',
                            fillColor: color.withAlpha(0.9),
                            outlineColor: Cesium.Color.BLACK,
                            outlineWidth: 2,
                            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                            pixelOffset: new Cesium.Cartesian2(0, -10),
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2_000_000),
                        },
                    }))
                })

                // Fusion centroid marker
                if (fusionPos) {
                    entitiesRef.current.push(viewer.entities.add({
                        position: fusionPos,
                        point: {
                            pixelSize: 10,
                            color: Cesium.Color.fromCssColorString("#BF5AF2").withAlpha(0.9),
                            outlineColor: Cesium.Color.WHITE.withAlpha(0.4),
                            outlineWidth: 1.5,
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        },
                    }))
                }
            })
            .catch(e => console.warn("[fusion] signal fetch failed:", e))

        return clearEntities
    }, [fusion?.fusion_id]) // eslint-disable-line react-hooks/exhaustive-deps

    return clearEntities
}

const SEV_COLOR = {
    critical: "#f87171",
    high:     "#fb923c",
    medium:   "#fbbf24",
    info:     "#60a5fa",
}

const DOMAIN_COLOR = {
    AIS:      "#34AADC",
    NEWS:     "#FF9500",
    SENTINEL: "#30D158",
    ADSB:     "#5856D6",
    FUSION:   "#BF5AF2",
}

function forgeHeaders() {
    return {
        Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}`,
        "X-Forge-Passcode": localStorage.getItem("forge_passcode") || "",
        "Content-Type": "application/json",
    }
}

function ConfidenceBar({ value, color }) {
    const pct = Math.round((value || 0) * 100)
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
                flex: 1, height: 4, borderRadius: 2,
                background: "rgba(255,255,255,0.08)",
                overflow: "hidden",
            }}>
                <div style={{
                    width: `${pct}%`, height: "100%",
                    background: color, borderRadius: 2,
                    transition: "width 0.3s ease",
                }} />
            </div>
            <span style={{ fontSize: 10, color, fontWeight: 700, minWidth: 28, textAlign: "right" }}>
                {pct}%
            </span>
        </div>
    )
}

export default function GlobeFusionPopup({ data, onClose, viewerRef }) {
    const f = data || {}
    const [showSignals,  setShowSignals]  = useState(false)
    useFusionSignals(f, viewerRef)
    const [noteOpen,     setNoteOpen]     = useState(false)
    const [noteText,     setNoteText]     = useState(f.analyst_notes || "")
    const [noteSaving,   setNoteSaving]   = useState(false)
    const [resolved,     setResolved]     = useState(f.status === "resolved")

    const sev       = f.severity || "medium"
    const sevColor  = SEV_COLOR[sev] || "#60a5fa"
    const fusColor  = "#BF5AF2"

    const domains           = safeArray(f.domains)
    const keySignals        = safeArray(f.key_signals)
    const threatIndicators  = safeArray(f.threat_indicators)
    const contribSignals    = safeArray(f.resolved_signals)
    const explanation       = FORGE_EXPLANATIONS[f.icon_type || f.pattern_type || "FUSION_EVENT"] || FORGE_EXPLANATIONS.FUSION_EVENT

    const handleSaveNote = async () => {
        setNoteSaving(true)
        try {
            await fetch(`${API_BASE}/api/fusions/${f.fusion_id}`, {
                method:  "PUT",
                headers: forgeHeaders(),
                body:    JSON.stringify({ analyst_notes: noteText }),
            })
        } catch { /* silent */ }
        setNoteSaving(false)
        setNoteOpen(false)
    }

    const handleResolve = async () => {
        try {
            await fetch(`${API_BASE}/api/fusions/${f.fusion_id}`, {
                method:  "DELETE",
                headers: forgeHeaders(),
            })
            setResolved(true)
        } catch { /* silent */ }
    }

    const handleBriefDirector = () => {
        window.dispatchEvent(new CustomEvent("brief-director-fusion", {
            detail: { fusion_id: f.fusion_id, title: f.title },
        }))
        onClose()
    }

    return (
        <div style={{ width: 340, background: 'rgba(5,10,20,0.96)', border: `1px solid ${sevColor}33`, borderTop: `2px solid ${sevColor}`, fontFamily: '"IBM Plex Mono", monospace', overflow: 'hidden' }}>

          {/* Header */}
          <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1 }}>
              {/* Domain pills */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                {domains.map(d => {
                  const dc = { AIS:'#34AADC',ADSB:'#9B8FE0',NEWS:'#E8A838',SENTINEL:'#3DAD6E',FUSION:'#7B6FD4' }[d] || '#aaa'
                  return <span key={d} style={{ fontSize:7, fontWeight:700, letterSpacing:1.5, color:dc, border:`1px solid ${dc}44`, background:`${dc}10`, padding:'1px 6px' }}>{d}</span>
                })}
                <span style={{ fontSize:7, fontWeight:700, letterSpacing:1.5, color:sevColor, border:`1px solid ${sevColor}44`, background:`${sevColor}10`, padding:'1px 6px' }}>{(f.severity||'MEDIUM').toUpperCase()}</span>
                {resolved && <span style={{ fontSize:7, padding:'1px 6px', color:'rgba(255,255,255,0.3)', border:'1px solid rgba(255,255,255,0.15)' }}>RESOLVED</span>}
              </div>
              <div style={{ fontSize:13, fontWeight:700, color:'rgba(255,255,255,0.92)', lineHeight:1.35 }}>{f.title||'Intelligence Fusion'}</div>
            </div>
            <button onClick={onClose} style={{ background:'none',border:'none',color:'rgba(255,255,255,0.25)',cursor:'pointer',fontSize:14,lineHeight:1,padding:'2px 4px',flexShrink:0 }}>×</button>
          </div>

          {/* Confidence bar */}
          <div style={{ padding:'8px 14px', borderBottom:'1px solid rgba(255,255,255,0.06)', display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ fontSize:8,color:'rgba(255,255,255,0.30)',letterSpacing:1.5,width:70,flexShrink:0 }}>CONFIDENCE</div>
            <div style={{ flex:1, height:2, background:'rgba(255,255,255,0.08)' }}>
              <div style={{ width:`${(f.confidence||0)*100}%`, height:'100%', background:sevColor }}/>
            </div>
            <div style={{ fontSize:11, fontWeight:700, color:sevColor, minWidth:32, textAlign:'right' }}>{Math.round((f.confidence||0)*100)}%</div>
            <div style={{ fontSize:9, color:'rgba(255,255,255,0.25)', minWidth:40, textAlign:'right' }}>
              {f.created_at ? (() => { const m=Math.floor((Date.now()-new Date(f.created_at))/60000); return m<60?`${m}m ago`:`${Math.floor(m/60)}h ago` })() : ''}
            </div>
          </div>

          {/* Narrative */}
          <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize:8,fontWeight:700,color:'rgba(255,255,255,0.25)',letterSpacing:2,marginBottom:6 }}>ASSESSMENT</div>
            <div style={{ fontSize:11,color:'rgba(255,255,255,0.65)',lineHeight:1.7 }}>{f.narrative||f.subtitle}</div>
          </div>

          {/* Contributing signals */}
          {keySignals.length > 0 && (
            <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize:8,fontWeight:700,color:'rgba(255,255,255,0.25)',letterSpacing:2,marginBottom:6 }}>
                CONTRIBUTING SIGNALS <span style={{ color:'#7B6FD4', marginLeft:6 }}>{f.signal_count||keySignals.length}</span>
              </div>
              {keySignals.slice(0,4).map((s,i)=>(
                <div key={i} style={{ display:'flex',alignItems:'flex-start',gap:6,marginBottom:4 }}>
                  <div style={{ width:2,minHeight:14,background:'#7B6FD455',flexShrink:0,marginTop:3 }}/>
                  <div style={{ fontSize:10,color:'rgba(255,255,255,0.50)',lineHeight:1.5 }}>{s}</div>
                </div>
              ))}
            </div>
          )}

          {/* Watch items */}
          {threatIndicators.filter(Boolean).length > 0 && (
            <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.02)' }}>
              <div style={{ fontSize:8,fontWeight:700,color:'rgba(255,255,255,0.25)',letterSpacing:2,marginBottom:6 }}>WATCH</div>
              {threatIndicators.filter(Boolean).map((ind,i)=>(
                <div key={i} style={{ fontSize:10,color:sevColor,opacity:0.8,lineHeight:1.5,marginBottom:3,paddingLeft:8,borderLeft:`1px solid ${sevColor}44` }}>{ind}</div>
              ))}
            </div>
          )}

          {/* Analyst notes */}
          {noteOpen && (
            <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <textarea value={noteText} onChange={e=>setNoteText(e.target.value)}
                placeholder="Add analyst notes..."
                style={{ width:'100%',boxSizing:'border-box',minHeight:56,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',color:'#e2e8f0',fontSize:11,padding:'6px 8px',resize:'vertical',fontFamily:'inherit' }}
              />
              <div style={{ display:'flex',gap:6,marginTop:4 }}>
                <button onClick={handleSaveNote} disabled={noteSaving}
                  style={{ flex:1,padding:'4px 8px',fontSize:10,fontWeight:600,background:`${fusColor}33`,border:`1px solid ${fusColor}66`,color:fusColor,cursor:'pointer' }}>
                  {noteSaving?'Saving…':'Save Note'}
                </button>
                <button onClick={()=>setNoteOpen(false)}
                  style={{ padding:'4px 8px',fontSize:10,background:'none',border:'1px solid rgba(255,255,255,0.08)',color:'rgba(255,255,255,0.35)',cursor:'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ padding:'8px 14px', display:'flex',gap:5,flexWrap:'wrap' }}>
            {!resolved && (
              <button onClick={handleResolve}
                style={{ padding:'4px 9px',fontSize:10,fontWeight:600,background:'rgba(224,58,58,0.10)',border:'1px solid rgba(224,58,58,0.30)',color:'#E03A3A',cursor:'pointer' }}>
                Resolve
              </button>
            )}
            <button onClick={()=>setNoteOpen(v=>!v)}
              style={{ padding:'4px 9px',fontSize:10,fontWeight:600,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.10)',color:'rgba(255,255,255,0.45)',cursor:'pointer' }}>
              Add Note
            </button>
            <button onClick={handleBriefDirector}
              style={{ padding:'4px 9px',fontSize:10,fontWeight:600,background:`${fusColor}22`,border:`1px solid ${fusColor}44`,color:fusColor,cursor:'pointer' }}>
              Brief Director
            </button>
          </div>

          {/* Location footer */}
          {(f.location_name||f.location_country) && (
            <div style={{ padding:'4px 14px 8px',fontSize:9,color:'rgba(255,255,255,0.15)',letterSpacing:0.5 }}>
              {[f.location_name,f.location_country].filter(Boolean).join(' · ')}
              {f.lat!=null&&` · ${Number(f.lat).toFixed(2)}, ${Number(f.lon??0).toFixed(2)}`}
            </div>
          )}
        </div>
    )
}
