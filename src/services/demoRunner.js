/**
 * demoRunner.js — Scene-based demo briefing playback engine.
 *
 * RULE 1  Country highlights via /geo/countries real GeoJSON
 * RULE 2  Submarine cables from /api/infrastructure/cables DB
 * RULE 3  POST /api/geo/validate-route (Shapely backend)
 * RULE 4  Troop routes via POST /route (OSRM), straight-line fallback
 * RULE 5  Real ML scan via /api/overwatch/detect; simulated progress bar
 * RULE 6  Ships/troops persist within a scenario (_persistentLayers)
 * RULE 7  map.stop() before every flyTo
 * RULE 8  Interactive choices in sidebar only
 * RULE 9  Unit icons ≥ 24 px (see demoIconUtils.js)
 * RULE 10 TODO: future interactive troop waypoint control
 */

import API_BASE from "../apiBase.js"
import ttsService from "./ttsService.js"
import { makeDemoIcon, makeDeployZoneIcon, updateMarkerHeading, _bearingDeg } from "./demoIconUtils.js"

const INTER_SCENE_MS = 800

// ── Line weight helpers ───────────────────────────────────────────────────────

function _lineWeight(zoom, base = 2) {
  if (zoom <= 6)  return Math.max(base - 1, 1)
  if (zoom <= 10) return base
  if (zoom <= 14) return base + 1
  return base + 2
}

// Speed-based animation: 1 real hour → 5 demo seconds, clamped to [minMs, maxMs]
function _calcAnimDurMs(path, speedKnots, speedKmh, minMs = 15000, maxMs = 35000) {
  if (!path || path.length < 2) return minMs
  let distKm = 0
  for (let i = 1; i < path.length; i++) {
    const dlat = (path[i][0] - path[i-1][0]) * 111.32
    const dlng = (path[i][1] - path[i-1][1]) * 111.32 * Math.cos(path[i-1][0] * Math.PI / 180)
    distKm += Math.sqrt(dlat * dlat + dlng * dlng)
  }
  const kmh       = speedKmh || (speedKnots ? speedKnots * 1.852 : null)
  if (!kmh) return minMs
  const realHours = distKm / kmh
  return Math.max(minMs, Math.min(maxMs, realHours * 5000))
}

export class DemoRunner {
  constructor({
    mapRef,
    onNarrate           = () => {},
    onStateChange       = () => {},
    onInteractiveChoice = () => {},
    onComplete          = () => {},
    onImage             = () => {},
    onCallouts          = () => {},
    onClearScene        = () => {},
    onChart             = () => {},
    onScanPrompt        = () => {},
    onScanProgress      = () => {},
    onScene             = () => {},
  } = {}) {
    this.mapRef              = mapRef
    this.onNarrate           = onNarrate
    this.onStateChange       = onStateChange
    this.onInteractiveChoice = onInteractiveChoice
    this.onComplete          = onComplete
    this.onImage             = onImage
    this.onCallouts          = onCallouts
    this.onClearScene        = onClearScene
    this.onChart             = onChart
    this.onScanPrompt        = onScanPrompt
    this.onScanProgress      = onScanProgress
    this.onScene             = onScene

    this._scenes           = []
    this._sceneById        = {}
    this._total            = 0
    this._sceneIdx         = 0
    this._aborted          = false
    this._isPaused         = false
    this._isWaitingChoice  = false
    this._resolveChoice    = null

    // RULE 6: persistent layers survive scene transitions within a scenario
    this._layers           = []
    this._persistentLayers = []
    this._currentScenario  = null

    this._animFrames       = []
    this._intervals        = []
    this._timeouts         = []
    this._cameraLeader     = null
    this._cameraInterval   = null
    this._cameraTimer      = null
    this._imageCache       = new Map()

    // RULE 1: GeoJSON country cache
    this._countriesCache        = null
    this._countriesFetchPromise = null

    // Chokepoint DB cache: name → feature (shared across scenes)
    this._chokepointCache = new Map()

    // RULE 5: ML detection results consumed by detection_boxes renderer
    this._latestMLDetections = null
  }

  load(briefing) {
    this._scenes = briefing.scenes || []
    this._total  = this._scenes.length
    this._sceneById = {}
    this._scenes.forEach((s, i) => { this._sceneById[s.id] = i })
  }

  async play() {
    if (this._isPaused) {
      this._isPaused = false
      ttsService.resume()
      this.onStateChange({ isPlaying: true, currentIndex: this._sceneIdx, total: this._total })
      return
    }
    this._aborted = false
    this._sceneIdx = 0
    this.onStateChange({ isPlaying: true, currentIndex: 0, total: this._total })
    await this._playFromIndex(0)
  }

  pause() {
    if (this._aborted || this._isPaused) return
    this._isPaused = true
    ttsService.pause()
    this.onStateChange({ isPlaying: false, currentIndex: this._sceneIdx, total: this._total })
  }

  resolveChoice(sceneId) {
    if (!this._isWaitingChoice || !this._resolveChoice) return
    this._resolveChoice(sceneId)
  }

  // TODO (RULE 10): stepForward/stepBackward could advance active troop units
  // to their next waypoint, enabling mid-scenario order issuing.
  stepForward()  {}
  stepBackward() {}
  jumpToStart()  {}
  jumpToEnd()    {}

  stop() {
    this._aborted  = true
    this._isPaused = false
    this._isWaitingChoice = false
    if (this._resolveChoice) { this._resolveChoice(null); this._resolveChoice = null }
    this._cancelAnimations()
    this._clearLayers()
    this._clearPersistentLayers()
    ttsService.stop()
    this.onScene(null)
    this.onInteractiveChoice([])
    this.onCallouts([])
    this.onClearScene()
    this.onScanProgress(null)
    this.onStateChange({ isPlaying: false, currentIndex: -1, total: this._total })
  }

  destroy() {
    this.stop()
    this._scenes = []
    this._sceneById = {}
  }

  // ── Playback loop ─────────────────────────────────────────────────────────────

  async _playFromIndex(startIdx) {
    let idx = startIdx
    while (idx < this._scenes.length && !this._aborted) {
      await this._waitWhilePaused()
      if (this._aborted) break

      this._sceneIdx = idx
      this.onStateChange({ isPlaying: true, currentIndex: idx, total: this._total })
      const nextId = await this._playScene(this._scenes[idx])
      if (this._aborted) break

      await this._pauseAwareSleep(INTER_SCENE_MS)
      idx = nextId && this._sceneById[nextId] !== undefined
        ? this._sceneById[nextId]
        : idx + 1
    }
    if (!this._aborted) {
      this.onStateChange({ isPlaying: false, currentIndex: this._sceneIdx, total: this._total })
      this.onComplete()
    }
  }

  async _playScene(scene) {
    // Fire onScene so GlobeDirectorLayer can render elements in 3D
    this.onScene(scene)

    // RULE 6: clear persistent layers on scenario change
    if (scene.scenario && scene.scenario !== this._currentScenario) {
      this._clearPersistentLayers()
      this._currentScenario = scene.scenario
    }

    this._clearLayers()
    this.onClearScene()
    this.onCallouts([])
    this._cameraLeader = null

    const map = this.mapRef?.current
    const zoom = scene.zoom || 6
    const flyDuration = Math.min((scene.duration || 2000) / 1000, 3)

    // RULE 7: smooth camera
    if (map && scene.center) this._flyTo(scene.center, zoom, flyDuration)

    const wordCount = (scene.narration || "").split(/\s+/).filter(Boolean).length
    const animDurMs = Math.max((wordCount / 2.5) * 1000, 6000)
    const floorMs   = 3000 + Math.max((wordCount / 150) * 60000, 5000) + (scene.post_delay || 0)

    // Separate special elements from regular ones
    const callouts  = []
    const deployEls = []
    const _addEl = (el) => {
      if (el.type === "data_callout") {
        callouts.push(el)
      } else if (el.type === "troop_deploy_interactive") {
        deployEls.push(el)
        this._renderDeployZones(el)
      } else if (el.type === "combined_ops") {
        // Fire all sub-elements simultaneously
        for (const sub of (el.elements || [])) _addEl(sub)
      } else {
        this._renderElement(el, animDurMs, zoom)
      }
    }
    for (const el of (scene.scene_elements || [])) _addEl(el)
    if (callouts.length) this.onCallouts(callouts)

    this._startCameraFollow(flyDuration * 1000 + 400)

    // Narration
    if (scene.narration || scene.title) {
      const bullets = scene.interactive && scene.choices
        ? scene.choices.map(c => `${c.icon || "◉"}  ${c.label}`)
        : this._buildBullets(scene)
      this.onNarrate({ action: "narrate", heading: scene.title || "", text: scene.narration || "", bullets })
    }

    // Image
    const imgSrc = this._findImageSource(scene)
    if (imgSrc) {
      this.onImage({ loading: true, url: null, caption: imgSrc.caption })
      this._fetchImage(imgSrc.query).then(url => {
        if (this._aborted) return
        this.onImage(url
          ? { loading: false, url, caption: imgSrc.caption }
          : { loading: false, url: null, caption: imgSrc.caption, gradient: imgSrc.caption })
      })
    } else {
      this.onImage(null)
    }

    const floorP = this._pauseAwareSleep(floorMs)
    const ttsP   = scene.narration ? ttsService.speak(scene.narration).catch(() => {}) : Promise.resolve()

    // Preload tiles for next scene while current scene narrates (fire-and-forget)
    const nextScene = this._scenes[this._sceneIdx + 1]
    if (nextScene?.center) this._preloadSceneTiles(nextScene)

    // Interactive strategy choice
    if (scene.interactive) {
      await Promise.all([floorP, ttsP])
      if (this._aborted) return null
      this.onInteractiveChoice(scene.choices || [])
      const chosen = await new Promise(res => {
        this._isWaitingChoice = true
        this._resolveChoice   = res
      })
      this._isWaitingChoice = false
      this._resolveChoice   = null
      this.onInteractiveChoice([])
      if (chosen) {
        const lbl = (scene.choices || []).find(c => (c.id || c.next_scene) === chosen)?.label || chosen
        this.onNarrate({ action: "narrate", heading: "DECISION", text: "", bullets: [`✓  ${lbl}`] })
      }
      return chosen || null
    }

    await Promise.all([floorP, ttsP])
    if (this._aborted) return null

    // Interactive troop deploy sequence (runs after narration, before next scene)
    for (const el of deployEls) {
      if (this._aborted) break
      await this._runInteractiveDeploy(el)
    }

    return scene.next_scene || null
  }

  // ── RULE 7: smooth camera ─────────────────────────────────────────────────────

  _flyTo(center, zoom, duration) {
    const map = this.mapRef?.current
    if (!map) return
    try { map.stop() } catch (_) {}
    map.flyTo([center[0], center[1]], zoom, { duration, easeLinearity: 0.1, animate: true })
  }

  // ── Tile preloading for next scene ────────────────────────────────────────────

  _preloadSceneTiles(scene) {
    if (!scene?.center) return
    const [lat, lng] = scene.center
    const zoom = Math.min(Math.round(scene.zoom || 8), 16)
    const n = Math.pow(2, zoom)
    const tileX = Math.floor((lng + 180) / 360 * n)
    const tileY = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n)
    const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const url = ESRI.replace("{z}", zoom).replace("{y}", tileY + dy).replace("{x}", tileX + dx)
        const img = new Image()
        img.src = url
      }
    }
  }

  // ── Element renderer ──────────────────────────────────────────────────────────

  _renderElement(el, animDurMs = 8000, sceneZoom = 6) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return
    const lw = z => _lineWeight(sceneZoom, z)

    switch (el.type) {

      case "chokepoint_poly": {
        const poly = L.polygon(el.coords, {
          color: el.color || "#ef4444", fillColor: el.color || "#ef4444",
          fillOpacity: 0.07, weight: lw(2), dashArray: "6 4",
          smoothFactor: 0, noClip: true,
        }).addTo(map)
        this._layers.push(poly)
        break
      }

      case "chokepoint_from_db": {
        this._renderChokepointFromDBAsync(el)
        break
      }

      // RULE 1: real GeoJSON borders
      case "country_highlight": {
        this._renderCountryHighlightAsync(el)
        break
      }

      case "perimeter": {
        const poly = L.polygon(el.points, {
          color: el.color || "#3b82f6", fillColor: el.color || "#3b82f6",
          fillOpacity: 0.06, weight: lw(2), dashArray: el.dashed ? "8 5" : null,
          smoothFactor: 0, noClip: true,
        }).addTo(map)
        if (el.label) poly.bindTooltip(el.label, { permanent: true, className: "demo-runner-tooltip" })
        this._layers.push(poly)
        break
      }

      case "zone_overlay": {
        const poly = L.polygon(el.polygon || el.coords || [], {
          color: el.color || "#3b82f6", fillColor: el.color || "#3b82f6",
          fillOpacity: 0.18, weight: lw(2), opacity: 0.8,
        }).addTo(map)
        this._layers.push(poly)
        if (el.label) {
          try {
            const center = poly.getBounds().getCenter()
            const lbl = L.marker(center, {
              icon: L.divIcon({
                html: `<div style="font-size:10px;font-weight:700;color:${el.color||"#3b82f6"};background:rgba(0,0,0,0.72);padding:2px 7px;border-radius:4px;white-space:nowrap;font-family:system-ui;">${el.label}</div>`,
                className: "", iconSize: [100, 18], iconAnchor: [50, 9],
              }),
            }).addTo(map)
            this._layers.push(lbl)
          } catch (_) {}
        }
        break
      }

      case "facility_marker": {
        const c    = el.color || "#f59e0b"
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:11px;height:11px;border-radius:50%;background:${c};border:2px solid rgba(255,255,255,0.55);box-shadow:0 0 8px ${c}80"></div>`,
          iconSize: [11, 11], iconAnchor: [5, 5],
        })
        const marker = L.marker([el.lat, el.lng], { icon }).addTo(map)
        this._layers.push(marker)
        if (el.name) {
          marker.bindTooltip(this._tooltipHtml(null, el.name, el.description), {
            permanent: true, direction: "top", className: "demo-runner-rich-tooltip", offset: [0, -8],
          })
        }
        if (el.image_query) {
          this._fetchImage(el.image_query).then(url => {
            if (this._aborted || !url) return
            try { marker.setTooltipContent?.(this._tooltipHtml(url, el.name, el.description)) } catch (_) {}
          })
        }
        break
      }

      case "spotlight": {
        const c = el.color || "#ef4444"
        const circle = L.circle([el.lat, el.lng], {
          radius: el.radius || 10000, color: c, fillColor: c,
          fillOpacity: 0.09, weight: 1.5, dashArray: "5 4",
        }).addTo(map)
        this._layers.push(circle)
        break
      }

      case "intercept_line": {
        const pts = el.path || (el.from && el.to ? [el.from, el.to] : [])
        if (pts.length < 2) break
        const line = L.polyline(pts, {
          color: el.color || "#ef4444", weight: lw(el.weight || 2),
          dashArray: el.dashed ? (el.dashArray || "8 5") : null,
          smoothFactor: 0, noClip: true,
        }).addTo(map)
        this._layers.push(line)
        if (el.label) {
          const mid = pts[Math.floor(pts.length / 2)]
          this._layers.push(L.marker(mid, {
            icon: L.divIcon({
              html: `<div style="font-size:10px;font-weight:700;color:${el.color||"#ef4444"};background:rgba(0,0,0,0.82);padding:2px 8px;border-radius:4px;white-space:nowrap;font-family:system-ui;">${el.label}</div>`,
              className: "", iconSize: [200, 16], iconAnchor: [100, 26],
            }),
          }).addTo(map))
        }
        if (el.labelWest || el.labelEast) {
          const mid    = pts[Math.floor(pts.length / 2)]
          const lngOff = el.labelOffset != null ? el.labelOffset : 0.04
          if (el.labelWest) {
            this._layers.push(L.marker([mid[0], mid[1] - lngOff], {
              icon: L.divIcon({
                html: `<div style="font-size:10px;font-weight:800;color:${el.colorWest||"#ef4444"};background:rgba(0,0,0,0.82);padding:3px 10px;border-radius:4px;white-space:nowrap;font-family:system-ui;">${el.labelWest}</div>`,
                className: "", iconSize: [80, 20], iconAnchor: [40, 10],
              }),
            }).addTo(map))
          }
          if (el.labelEast) {
            this._layers.push(L.marker([mid[0], mid[1] + lngOff], {
              icon: L.divIcon({
                html: `<div style="font-size:10px;font-weight:800;color:${el.colorEast||"#3b82f6"};background:rgba(0,0,0,0.82);padding:3px 10px;border-radius:4px;white-space:nowrap;font-family:system-ui;">${el.labelEast}</div>`,
                className: "", iconSize: [80, 20], iconAnchor: [40, 10],
              }),
            }).addTo(map))
          }
        }
        break
      }

      case "radius_circle": {
        const c = el.color || "#3b82f6"
        const circle = L.circle([el.lat, el.lng], {
          radius: (el.radius_nm || 100) * 1852, color: c, fillColor: c,
          fillOpacity: 0.04, weight: lw(1), dashArray: "6 4",
        }).addTo(map)
        if (el.label) circle.bindTooltip(el.label, { permanent: true, direction: "center", className: "demo-runner-tooltip" })
        this._layers.push(circle)
        break
      }

      case "cable_route": {
        const line = L.polyline(el.path, {
          color: el.color || "#a855f7", weight: lw(el.weight || 3), opacity: 0.85,
          dashArray: el.dashed ? "8 5" : null,
          smoothFactor: 0, noClip: true,
        }).addTo(map)
        if (el.label) {
          const mid = el.path[Math.floor(el.path.length / 2)] || el.path[0]
          this._layers.push(L.marker(mid, {
            icon: L.divIcon({
              html: `<div style="font-size:9px;font-weight:700;color:${el.color||"#a855f7"};background:rgba(0,0,0,0.78);padding:2px 7px;border-radius:4px;white-space:nowrap;font-family:system-ui;">${el.label}</div>`,
              className: "", iconSize: [140, 16], iconAnchor: [70, 8],
            }),
          }).addTo(map))
        }
        this._layers.push(line)
        break
      }

      // RULE 2: cable from database
      case "cable_from_db": {
        this._renderCableFromDBAsync(el, sceneZoom)
        break
      }

      case "flow_arrows": {
        for (const flow of (el.flows || [])) {
          const line = L.polyline([flow.from, flow.to], {
            color: flow.color || "#f59e0b", weight: flow.width || lw(2),
            opacity: 0.75, dashArray: "12 4",
            smoothFactor: 0, noClip: true,
          }).addTo(map)
          this._layers.push(line)
          const bearing  = _bearingDeg(flow.from, flow.to)
          this._layers.push(L.marker(flow.to, {
            icon: L.divIcon({
              html: `<div style="font-size:14px;color:${flow.color||"#f59e0b"};transform:rotate(${bearing}deg);line-height:1;filter:drop-shadow(0 0 3px ${flow.color||"#f59e0b"}80)">▲</div>`,
              className: "", iconSize: [18, 18], iconAnchor: [9, 9],
            }),
          }).addTo(map))
          if (flow.label) {
            const mid = [(flow.from[0]+flow.to[0])/2, (flow.from[1]+flow.to[1])/2]
            this._layers.push(L.marker(mid, {
              icon: L.divIcon({
                html: `<div style="font-size:10px;font-weight:700;color:${flow.color||"#f59e0b"};background:rgba(0,0,0,0.72);padding:2px 7px;border-radius:4px;white-space:nowrap;font-family:system-ui;">${flow.label}</div>`,
                className: "", iconSize: [130, 18], iconAnchor: [65, 9],
              }),
            }).addTo(map))
          }
        }
        break
      }

      case "ship_animation": {
        for (const v of (el.vessels || [])) this._spawnVessel(v, animDurMs)
        break
      }

      case "flight_animation": {
        for (const ac of (el.aircraft || [])) this._spawnVessel(ac, animDurMs)
        break
      }

      // RULE 4: OSRM road routing
      case "troop_movement": {
        for (const u of (el.units || []))
          this._spawnTroopWithRoute(u, animDurMs)
        break
      }

      case "overwatch_scan": {
        this._renderOverwatchScan(el)
        break
      }

      case "detection_boxes": {
        this._renderDetectionBoxes(el)
        break
      }

      case "chart": {
        const bars = el.bars || (el.data || []).map(d => ({
          label: d.label, value: d.current ?? d.value ?? 0, color: d.color || "#3b82f6",
        }))
        this.onChart({ ...el, bars })
        break
      }

      default:
        break
    }
  }

  // ── RULE 1: real country GeoJSON ──────────────────────────────────────────────

  async _getCountriesGeoJSON() {
    if (this._countriesCache)        return this._countriesCache
    if (this._countriesFetchPromise) return this._countriesFetchPromise
    this._countriesFetchPromise = (async () => {
      try {
        const r = await fetch(`${API_BASE}/geo/countries`)
        if (r.ok) { this._countriesCache = await r.json(); return this._countriesCache }
      } catch (e) { console.warn("[DemoRunner] countries fetch:", e.message) }
      return null
    })()
    return this._countriesFetchPromise
  }

  async _renderCountryHighlightAsync(el) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return
    try {
      const geo  = await this._getCountriesGeoJSON()
      if (!geo || this._aborted) return
      const name = (el.name || el.country || "").toLowerCase().trim()
      const feat = geo.features?.find(f =>
        (f.properties?.name || f.properties?.NAME || f.properties?.ADMIN || "").toLowerCase() === name
      )
      if (!feat) { console.warn(`[DemoRunner] no GeoJSON feature for "${name}"`); return }
      const layer = L.geoJSON(feat, {
        style: { color: el.color||"#ef4444", fillColor: el.color||"#ef4444", fillOpacity: 0.25, weight: 3, opacity: 0.8 },
      }).addTo(map)
      this._layers.push(layer)
    } catch (e) { console.warn("[DemoRunner] country_highlight:", e.message) }
  }

  // ── RULE 2: cable from DB ─────────────────────────────────────────────────────

  async _renderCableFromDBAsync(el, sceneZoom = 6) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return
    try {
      const r = await fetch(`${API_BASE}/api/infrastructure/cables?name=${encodeURIComponent(el.cable_name || el.name || "")}`)
      if (!r.ok || this._aborted) return
      const data    = await r.json()
      const feature = data.cables?.[0]
      if (!feature?.geometry) return
      const layer = L.geoJSON(feature, {
        style: { color: el.color||"#a855f7", weight: _lineWeight(sceneZoom, el.weight||3), opacity: 0.85, smoothFactor: 0 },
      }).addTo(map)
      this._layers.push(layer)
      if (el.label) {
        try {
          const c = layer.getBounds().getCenter()
          this._layers.push(L.marker(c, {
            icon: L.divIcon({
              html: `<div style="font-size:9px;font-weight:700;color:${el.color||"#a855f7"};background:rgba(0,0,0,0.78);padding:2px 7px;border-radius:4px;white-space:nowrap;font-family:system-ui;">${el.label}</div>`,
              className: "", iconSize: [140, 16], iconAnchor: [70, 8],
            }),
          }).addTo(map))
        } catch (_) {}
      }
    } catch (e) { console.warn("[DemoRunner] cable_from_db:", e.message) }
  }

  // ── Chokepoint from DB ────────────────────────────────────────────────────────

  async _renderChokepointFromDBAsync(el) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return
    try {
      const rawName = el.name || el.chokepoint_name || ""
      let feat = this._chokepointCache.get(rawName)
      if (!feat) {
        const r = await fetch(`${API_BASE}/api/infrastructure/chokepoints?name=${encodeURIComponent(rawName)}`)
        if (!r.ok || this._aborted) return
        const data = await r.json()
        feat = (data.chokepoints || data.items || data.features || [])[0]
        if (feat) this._chokepointCache.set(rawName, feat)
      }
      if (!feat?.geometry || this._aborted) return
      const layer = L.geoJSON(feat, {
        style: { color: el.color||"#ef4444", fillColor: el.color||"#ef4444", fillOpacity: 0.08, weight: 2, dashArray: "6 4", smoothFactor: 0 },
      }).addTo(map)
      this._layers.push(layer)
      if (el.label) {
        try {
          const c = layer.getBounds().getCenter()
          this._layers.push(L.marker(c, {
            icon: L.divIcon({
              html: `<div style="font-size:10px;font-weight:700;color:${el.color||"#ef4444"};background:rgba(0,0,0,0.82);padding:2px 9px;border-radius:4px;white-space:nowrap;font-family:system-ui;">${el.label}</div>`,
              className: "", iconSize: [200, 18], iconAnchor: [100, 9],
            }),
          }).addTo(map))
        } catch (_) {}
      }
    } catch (e) { console.warn("[DemoRunner] chokepoint_from_db:", e.message) }
  }

  // ── RULE 4: OSRM routing ──────────────────────────────────────────────────────

  async _getTroopRoute(start, end) {
    try {
      const tok = localStorage.getItem("hw-auth-token")
      const r   = await fetch(`${API_BASE}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ points: [start, end], mode: "driving" }),
      })
      if (r.ok) {
        const d    = await r.json()
        const path = (d.coordinates || []).map(c => [c[1], c[0]])   // lon,lat → lat,lon
        if (path.length >= 2) return path
      }
    } catch (_) {}
    return null
  }

  async _spawnTroopWithRoute(unit, animDurMs) {
    let path = await this._getTroopRoute(unit.start, unit.end)
    if (!path) path = [unit.start, unit.end]
    if (this._aborted) return
    this._spawnVessel({ name: unit.name, strength: unit.strength, color: unit.color||"#ef4444", icon: unit.icon||"infantry", path }, animDurMs)
  }

  // ── RULE 6: vessel spawning → persistent layers ───────────────────────────────

  _spawnVessel(vessel, animDurMs) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L || (vessel.path || []).length < 2) return
    const dur  = (vessel.speed_knots || vessel.speed_kmh)
      ? _calcAnimDurMs(vessel.path, vessel.speed_knots, vessel.speed_kmh)
      : animDurMs
    const icon = makeDemoIcon(vessel, vessel.path)
    if (!icon) return
    const marker = L.marker(vessel.path[0], { icon }).addTo(map)
    const trail  = L.polyline([vessel.path[0]], { color: vessel.color||"#3b82f6", weight: 1.5, opacity: 0.35, smoothFactor: 0, noClip: true }).addTo(map)
    this._persistentLayers.push(marker, trail)
    if (!this._cameraLeader) this._cameraLeader = marker
    this._animateAlongPath(marker, trail, vessel.path, dur)
  }

  _animateAlongPath(marker, trail, path, durationMs) {
    const n = path.length
    let startTime = null, pausedAt = null, lastSeg = -1

    const step = (t) => {
      if (this._aborted) return
      if (startTime === null) startTime = t
      if (this._isPaused) {
        if (pausedAt === null) pausedAt = t
        this._animFrames.push(requestAnimationFrame(step)); return
      }
      if (pausedAt !== null) { startTime += t - pausedAt; pausedAt = null }

      const p   = Math.min((t - startTime) / durationMs, 1)
      if (p >= 1) { try { marker.setLatLng(path[n-1]) } catch (_) {}; return }

      const sf  = p * (n - 1)
      const si  = Math.min(Math.floor(sf), n - 2)
      const sp  = sf - si
      const lat = path[si][0] + (path[si+1][0] - path[si][0]) * sp
      const lng = path[si][1] + (path[si+1][1] - path[si][1]) * sp
      try { marker.setLatLng([lat, lng]) } catch (_) { return }

      if (si !== lastSeg) {
        lastSeg = si
        updateMarkerHeading(marker, _bearingDeg(path[si], path[si+1]))
      }

      if (Math.round(t - startTime) % 100 < 20) {
        try { const pts = trail.getLatLngs(); pts.push(window.L.latLng(lat,lng)); trail.setLatLngs(pts) } catch (_) {}
      }

      this._animFrames.push(requestAnimationFrame(step))
    }
    this._animFrames.push(requestAnimationFrame(step))
  }

  // ── Overwatch scan (RULE 5: real ML + progress bar) ───────────────────────────

  _renderOverwatchScan(el) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L || !el.bounds) return

    let south, west, north, east
    if (Array.isArray(el.bounds)) {
      south = el.bounds[0][0]; west  = el.bounds[0][1]
      north = el.bounds[1][0]; east  = el.bounds[1][1]
    } else {
      ;({ south, west, north, east } = el.bounds)
    }

    const rect = L.rectangle([[south,west],[north,east]], {
      color: el.color||"#38bdf8", fillColor: el.color||"#38bdf8", fillOpacity: 0.05, weight: 1.5, dashArray: "4 4",
    }).addTo(map)
    if (el.label) rect.bindTooltip(el.label, { permanent: true, direction: "center", className: "demo-runner-tooltip" })
    this._layers.push(rect)

    const doScan = () => {
      const scanLine = L.polyline([[south,west],[north,west]], { color: el.color||"#38bdf8", weight: 2, opacity: 0.95 }).addTo(map)
      const scanGlow = L.polyline([[south,west],[north,west]], { color: el.color||"#38bdf8", weight: 10, opacity: 0.18 }).addTo(map)
      this._layers.push(scanLine, scanGlow)

      const totalMs = el.scan_duration || 4000
      let elapsed = 0
      const id = setInterval(() => {
        if (this._aborted) { clearInterval(id); return }
        if (this._isPaused) return
        elapsed += 40
        const p   = Math.min(elapsed / totalMs, 1)
        const lng = west + (east - west) * p
        try { scanLine.setLatLngs([[south,lng],[north,lng]]); scanGlow.setLatLngs([[south,lng],[north,lng]]) } catch (_) {}
        if (p >= 1) clearInterval(id)
      }, 40)
      this._intervals.push(id)

      // RULE 5: simulate progress + try real ML
      let pct = 0
      this.onScanProgress({ percent: 0, message: "Overwatch scanning…" })
      const progId = setInterval(() => {
        if (this._aborted) { clearInterval(progId); return }
        pct = Math.min(pct + Math.random() * 7 + 2, 91)
        this.onScanProgress({ percent: Math.round(pct), message: "Overwatch scanning…" })
      }, 280)
      this._intervals.push(progId)

      this._tryMLDetect({ north, south, east, west }, el.zoom || 17, el.confidence || 0.3).then(count => {
        clearInterval(progId)
        if (!this._aborted) {
          this.onScanProgress({ percent: 100, message: `${count} objects detected`, complete: true })
          const tid = setTimeout(() => { if (!this._aborted) this.onScanProgress(null) }, 3200)
          this._timeouts.push(tid)
        }
      })
    }

    if (el.interactive) {
      this.onScanPrompt(doScan)
    } else {
      doScan()
    }
  }

  async _tryMLDetect(bounds, zoom, confidence) {
    try {
      const tok = localStorage.getItem("hw-auth-token")
      const r   = await fetch(`${API_BASE}/api/overwatch/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ bounds, zoom, confidence }),
      })
      if (r.ok) {
        const data = await r.json()
        if (data.count > 0) {
          this._latestMLDetections = (data.detections || []).map(d => {
            const lats = d.corners.map(c => c[0]), lngs = d.corners.map(c => c[1])
            return {
              lat: d.center[0], lng: d.center[1],
              h:   Math.max(...lats) - Math.min(...lats),
              w:   Math.max(...lngs) - Math.min(...lngs),
              label:      (d.specific_type || d.class || "object").toUpperCase(),
              confidence: Math.round((d.confidence || 0) * 100),
              color:      "#38bdf8",
            }
          })
          console.log(`[DemoRunner] ML: ${data.count} detections`)
          return data.count
        }
      }
    } catch (e) { console.warn("[DemoRunner] ML detect:", e.message) }
    return 0
  }

  _renderDetectionBoxes(el) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return

    // RULE 5: use real ML detections if available
    const dets = this._latestMLDetections || el.detections || []
    this._latestMLDetections = null
    const rev = el.reveal_delay || 150

    dets.forEach((d, i) => {
      const tid = setTimeout(() => {
        if (this._aborted) return
        const hh = (d.h ?? d.height ?? 0.001) / 2
        const hw = (d.w ?? d.width  ?? 0.001) / 2
        const rect = L.rectangle(
          [[d.lat-hh, d.lng-hw],[d.lat+hh, d.lng+hw]],
          { color: d.color||"#38bdf8", fillColor: d.color||"#38bdf8", fillOpacity: 0.1, weight: 2 }
        ).addTo(map)
        this._layers.push(rect)
        if (d.label) {
          const conf = Math.round(d.confidence || 0)
          const lbl  = L.marker([d.lat+hh, d.lng-hw], {
            icon: L.divIcon({
              html: `<div style="font-size:9px;color:${d.color||"#38bdf8"};background:rgba(0,0,0,0.82);padding:1px 5px;white-space:nowrap;font-weight:700;font-family:system-ui;border-left:2px solid ${d.color||"#38bdf8"};line-height:1.5;">${d.label} ${conf}%</div>`,
              className: "", iconSize: [130, 14], iconAnchor: [0, 14],
            }),
          }).addTo(map)
          this._layers.push(lbl)
        }
      }, i * rev)
      this._timeouts.push(tid)
    })
  }

  // ── Interactive troop deployment (Part 2J) ────────────────────────────────────

  _renderDeployZones(el) {
    // Render pulsing zone circles immediately when scene starts
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L || !el.zones) return
    for (const z of el.zones) {
      if (!z.position) continue
      const m = L.marker(z.position, { icon: makeDeployZoneIcon(z.name) }).addTo(map)
      this._layers.push(m)
      z._marker = m   // save reference for removal
    }
  }

  async _runInteractiveDeploy(el) {
    if (!el.companies || !el.zones) return
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return

    const remaining = el.zones.map((z, i) => ({ ...z, _origIdx: i }))

    for (let ci = 0; ci < el.companies.length && !this._aborted; ci++) {
      const company = el.companies[ci]
      if (remaining.length === 0) break

      // Narration prompt
      this.onNarrate({
        action:  "narrate",
        heading: `DEPLOY ${company.name.toUpperCase()}`,
        text:    `Select a position to deploy ${company.name}. ${company.strength || ""}`,
        bullets: remaining.map(z => `📍 ${z.name}`),
      })

      // Show sidebar choices
      const choices = remaining.map((z, i) => ({ id: `zone-${i}`, label: z.name, icon: "📍" }))
      this.onInteractiveChoice(choices)

      const chosen = await new Promise(res => {
        this._isWaitingChoice = true
        this._resolveChoice   = res
      })
      this._isWaitingChoice = false
      this._resolveChoice   = null
      this.onInteractiveChoice([])

      if (!chosen || this._aborted) break
      const chosenLocalIdx = parseInt(chosen.replace("zone-", ""), 10)
      if (isNaN(chosenLocalIdx)) continue
      const zone = remaining[chosenLocalIdx]
      if (!zone) continue

      // Remove zone circle from map
      if (zone._marker) {
        try { map.removeLayer(zone._marker) } catch (_) {}
        this._layers = this._layers.filter(l => l !== zone._marker)
      }
      remaining.splice(chosenLocalIdx, 1)

      // Deploy company via OSRM road route (animation runs concurrently)
      this._spawnTroopWithRoute({
        name:     company.name,
        strength: company.strength,
        color:    company.color || "#3b82f6",
        icon:     company.icon  || "infantry",
        start:    el.garrison,
        end:      zone.position,
      }, 7000)   // 7s animation
    }

    // Clear any leftover zone circles
    for (const z of remaining) {
      if (z._marker) {
        try { map.removeLayer(z._marker) } catch (_) {}
        this._layers = this._layers.filter(l => l !== z._marker)
      }
    }
  }

  // ── Camera follow ─────────────────────────────────────────────────────────────

  _startCameraFollow(delayMs) {
    if (this._cameraTimer)    { clearTimeout(this._cameraTimer);     this._cameraTimer    = null }
    if (this._cameraInterval) { clearInterval(this._cameraInterval); this._cameraInterval = null }

    this._cameraTimer = setTimeout(() => {
      if (this._aborted || !this._cameraLeader) return
      this._cameraInterval = setInterval(() => {
        if (this._aborted || !this._cameraLeader || this._isPaused) return
        try { this.mapRef?.current?.panTo(this._cameraLeader.getLatLng(), { animate: true, duration: 0.45 }) } catch (_) {}
      }, 500)
      this._intervals.push(this._cameraInterval)
    }, delayMs)
    this._timeouts.push(this._cameraTimer)
  }

  // ── Bullets / image helpers ───────────────────────────────────────────────────

  _buildBullets(scene) {
    const out = []
    for (const el of (scene.scene_elements || [])) {
      if (el.type === "facility_marker" && el.name)
        out.push(`${el.name}${el.description ? ` — ${el.description}` : ""}`)
      if (el.type === "ship_animation")
        for (const v of (el.vessels || [])) if (v.name) out.push(v.name)
      if (el.type === "troop_movement")
        for (const u of (el.units || [])) if (u.name) out.push(`${u.name}${u.strength ? ` (${u.strength})` : ""}`)
      if (el.type === "detection_boxes") {
        const t = {}
        for (const d of (el.detections || [])) if (d.label) t[d.label] = (t[d.label]||0)+1
        for (const [k,v] of Object.entries(t)) out.push(`${v}× ${k}`)
      }
      if ((el.type === "cable_route" || el.type === "cable_from_db") && el.label) out.push(el.label)
      if (el.type === "troop_deploy_interactive")
        for (const c of (el.companies||[])) out.push(`${c.name}${c.strength ? ` — ${c.strength}` : ""}`)
    }
    return out.slice(0, 6)
  }

  _findImageSource(scene) {
    const els = scene.scene_elements || []
    for (const el of els) if (el.type === "facility_marker" && el.image_query)
      return { query: el.image_query, caption: el.name || scene.title || "" }
    for (const el of els) if (el.image_query)
      return { query: el.image_query, caption: el.name || scene.title || "" }
    for (const el of els) if (el.type === "flight_animation" && el.aircraft?.[0]?.name) {
      const n = el.aircraft[0].name
      if (!n.match(/^(Mirage|Viper|IRGCN|Triton|FAMa)/))
        return { query: n, caption: n }
    }
    if (scene.title) {
      const q = scene.title
        .replace(/^\s*(THEATRE SHIFT|THEATRE|SHIFT|ACTIVATED|DETECTED|IN PROGRESS|ASSESSMENT|REQUIRED|DEPLOYED)\s*[—\-–]\s*/i, "")
        .trim()
      if (q.length > 3) return { query: q, caption: scene.title }
    }
    return null
  }

  _tooltipHtml(imgUrl, name, description) {
    const img  = imgUrl ? `<img src="${imgUrl}" style="width:100%;height:80px;object-fit:cover;border-radius:5px 5px 0 0;display:block;" loading="lazy"/>` : ""
    const body = (name||description)
      ? `<div style="padding:5px 8px;">`
        + (name        ? `<div style="font-size:11px;font-weight:700;color:#e0eaff;">${name}</div>` : "")
        + (description ? `<div style="font-size:10px;color:rgba(160,180,220,.6);margin-top:2px;line-height:1.3;">${description}</div>` : "")
        + `</div>`
      : ""
    return `<div style="min-width:130px;max-width:160px;">${img}${body}</div>`
  }

  // ── Layer management ──────────────────────────────────────────────────────────

  _clearLayers() {
    this._cancelAnimations()
    if (this._cameraInterval) { clearInterval(this._cameraInterval); this._cameraInterval = null }
    if (this._cameraTimer)    { clearTimeout(this._cameraTimer);     this._cameraTimer    = null }
    this._cameraLeader = null
    for (const id of this._intervals) clearInterval(id)
    this._intervals = []
    for (const id of this._timeouts)  clearTimeout(id)
    this._timeouts = []
    const map = this.mapRef?.current
    if (map) for (const l of this._layers) { try { map.removeLayer(l) } catch (_) {} }
    this._layers = []
    // NOTE: _persistentLayers intentionally preserved (RULE 6)
  }

  _clearPersistentLayers() {
    const map = this.mapRef?.current
    if (map) for (const l of this._persistentLayers) { try { map.removeLayer(l) } catch (_) {} }
    this._persistentLayers = []
    this._currentScenario  = null
  }

  _cancelAnimations() {
    for (const id of this._animFrames) cancelAnimationFrame(id)
    this._animFrames = []
  }

  // ── Timing helpers ────────────────────────────────────────────────────────────

  async _pauseAwareSleep(ms) {
    let rem = ms
    while (rem > 0) {
      if (this._aborted) return
      if (this._isPaused) { await new Promise(r => setTimeout(r, 100)); continue }
      const tick = Math.min(100, rem)
      await new Promise(r => setTimeout(r, tick))
      rem -= tick
    }
  }

  async _waitWhilePaused() {
    while (this._isPaused && !this._aborted) await new Promise(r => setTimeout(r, 200))
  }

  async _fetchImage(query) {
    if (!query) return null
    const key = query.trim().toLowerCase()
    if (this._imageCache.has(key)) return this._imageCache.get(key)
    try {
      const r = await fetch(`${API_BASE}/api/image/wiki?q=${encodeURIComponent(query)}`)
      if (r.ok) {
        const d = await r.json()
        if (d?.image) { this._imageCache.set(key, d.image); return d.image }
      }
    } catch (_) {}
    this._imageCache.set(key, null)
    return null
  }
}
