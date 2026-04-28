/**
 * demoRunner.js — Playback engine for hardcoded scene-based demo briefings.
 *
 * Rules implemented:
 *   RULE 1  Country highlights from real /geo/countries GeoJSON (not hardcoded polygons)
 *   RULE 2  Cables from /api/infrastructure/cables database (cable_from_db element)
 *   RULE 3  POST /api/geo/validate-route backend endpoint (created in main.py)
 *   RULE 4  Troop routes via POST /route (OSRM), fallback to straight line
 *   RULE 5  Real ML scan via /api/overwatch/detect, fallback to scene detections
 *   RULE 6  Ships / troops persist across scenes within the same scenario
 *   RULE 7  map.stop() before every flyTo for smooth camera
 *   RULE 8  Interactive choices in sidebar only (sidebar receives choices via onInteractiveChoice)
 *   RULE 9  Troop/aircraft icons at least 24×24 px (see demoIconUtils.js)
 *   RULE 10 TODO: Future interactive troop control via resolveChoice + scene branching
 */

import API_BASE from "../apiBase.js"
import ttsService from "./ttsService.js"
import { makeDemoIcon, updateMarkerHeading, _bearingDeg } from "./demoIconUtils.js"

const INTER_SCENE_MS = 1000

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

    this._scenes           = []
    this._sceneById        = {}
    this._total            = 0
    this._sceneIdx         = 0
    this._aborted          = false
    this._isPaused         = false
    this._isWaitingChoice  = false
    this._resolveChoice    = null

    // RULE 6: persistent layers (ships/troops) survive scene transitions within same scenario
    this._layers           = []       // cleared every scene
    this._persistentLayers = []       // cleared only when scenario changes
    this._currentScenario  = null

    this._animFrames       = []
    this._intervals        = []
    this._timeouts         = []
    this._cameraLeader     = null
    this._cameraInterval   = null
    this._cameraTimer      = null
    this._imageCache       = new Map()

    // RULE 1: countries GeoJSON cache
    this._countriesCache        = null
    this._countriesFetchPromise = null

    // RULE 5: last ML detection results (used by detection_boxes renderer)
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

  // TODO (RULE 10): future interactive troop control — stepForward/stepBackward could
  // advance to the next troop_movement waypoint, enabling the user to issue orders
  // mid-scenario by selecting a unit and clicking a map position.
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
    this.onInteractiveChoice([])
    this.onCallouts([])
    this.onClearScene()
    this.onStateChange({ isPlaying: false, currentIndex: -1, total: this._total })
  }

  destroy() {
    this.stop()
    this._scenes = []
    this._sceneById = {}
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  async _playFromIndex(startIdx) {
    let idx = startIdx
    while (idx < this._scenes.length && !this._aborted) {
      await this._waitWhilePaused()
      if (this._aborted) break

      this._sceneIdx = idx
      this.onStateChange({ isPlaying: true, currentIndex: idx, total: this._total })
      const scene = this._scenes[idx]
      const nextIdOverride = await this._playScene(scene)
      if (this._aborted) break

      await this._pauseAwareSleep(INTER_SCENE_MS)
      if (nextIdOverride && this._sceneById[nextIdOverride] !== undefined) {
        idx = this._sceneById[nextIdOverride]
      } else {
        idx++
      }
    }
    if (!this._aborted) {
      this.onStateChange({ isPlaying: false, currentIndex: this._sceneIdx, total: this._total })
      this.onComplete()
    }
  }

  async _playScene(scene) {
    // RULE 6: clear persistent layers when scenario changes
    if (scene.scenario && scene.scenario !== this._currentScenario) {
      this._clearPersistentLayers()
      this._currentScenario = scene.scenario
    }

    this._clearLayers()
    this.onClearScene()
    this.onCallouts([])
    this._cameraLeader = null

    const map = this.mapRef?.current
    const flyDuration = Math.min((scene.duration || 2000) / 1000, 3)

    // RULE 7: stop any ongoing map animation before flying
    if (map && scene.center && scene.zoom) {
      this._flyTo(scene.center, scene.zoom, flyDuration)
    }

    const wordCount = (scene.narration || "").split(/\s+/).filter(Boolean).length
    const animDurMs = Math.max((wordCount / 2.5) * 1000, 8000)
    const floorMs   = 3200 + Math.max((wordCount / 150) * 60000, 5000) + (scene.post_delay || 0)

    const callouts = []
    for (const el of (scene.scene_elements || [])) {
      if (el.type === "data_callout") {
        callouts.push(el)
      } else {
        this._renderElement(el, animDurMs)
      }
    }
    if (callouts.length) this.onCallouts(callouts)

    this._startCameraFollow(flyDuration * 1000 + 400)

    if (scene.narration || scene.title) {
      const bullets = scene.interactive && scene.choices
        ? scene.choices.map(c => `${c.icon || "◉"}  ${c.label}`)
        : this._buildBullets(scene)
      this.onNarrate({
        action:  "narrate",
        heading: scene.title || "",
        text:    scene.narration || "",
        bullets,
      })
    }

    const imgSrc = this._findImageSource(scene)
    if (imgSrc) {
      this.onImage({ loading: true, url: null, caption: imgSrc.caption })
      this._fetchImage(imgSrc.query).then(url => {
        if (this._aborted) return
        this.onImage(url
          ? { loading: false, url, caption: imgSrc.caption }
          : { loading: false, url: null, caption: imgSrc.caption, gradient: imgSrc.caption }
        )
      })
    } else {
      this.onImage(null)
    }

    const floorP = this._pauseAwareSleep(floorMs)
    const ttsP   = scene.narration ? ttsService.speak(scene.narration).catch(() => {}) : Promise.resolve()

    if (scene.interactive) {
      await Promise.all([floorP, ttsP])
      if (this._aborted) return null

      // RULE 8: choices go to sidebar via onInteractiveChoice (not a centered overlay)
      this.onInteractiveChoice(scene.choices || [])
      const chosen = await new Promise(res => {
        this._isWaitingChoice = true
        this._resolveChoice   = res
      })
      this._isWaitingChoice = false
      this._resolveChoice   = null
      this.onInteractiveChoice([])

      if (chosen) {
        const chosenLabel = (scene.choices || []).find(c => (c.id || c.next_scene) === chosen)?.label || chosen
        this.onNarrate({
          action:  "narrate",
          heading: "DECISION",
          text:    "",
          bullets: [`✓  ${chosenLabel}`],
        })
      }
      return chosen || null
    }

    await Promise.all([floorP, ttsP])
    return scene.next_scene || null
  }

  // RULE 7: stop map before flying for smooth camera transitions
  _flyTo(center, zoom, duration) {
    const map = this.mapRef?.current
    if (!map || !center || !zoom) return
    try { map.stop() } catch (_) {}
    map.flyTo([center[0], center[1]], zoom, {
      duration:      duration,
      easeLinearity: 0.35,
    })
  }

  _findImageSource(scene) {
    const els = scene.scene_elements || []
    for (const el of els) {
      if (el.type === "facility_marker" && el.image_query)
        return { query: el.image_query, caption: el.name || scene.title || "" }
    }
    for (const el of els) {
      if (el.image_query)
        return { query: el.image_query, caption: el.name || scene.title || "" }
    }
    for (const el of els) {
      if (el.type === "flight_animation" && el.aircraft?.[0]?.name) {
        const name = el.aircraft[0].name
        if (!name.match(/^(Mirage|Viper|IRGCN|Triton)/))
          return { query: name, caption: name }
      }
    }
    if (scene.title) {
      const q = scene.title
        .replace(/^\s*(THEATRE SHIFT|THEATRE|SHIFT|ACTIVATED|DETECTED|IN PROGRESS|ASSESSMENT|REQUIRED|DEPLOYED)\s*[—\-–]\s*/i, '')
        .trim()
      if (q && q.length > 3) return { query: q, caption: scene.title }
    }
    return null
  }

  _startCameraFollow(delayMs) {
    if (this._cameraTimer)    { clearTimeout(this._cameraTimer);     this._cameraTimer = null }
    if (this._cameraInterval) { clearInterval(this._cameraInterval); this._cameraInterval = null }

    this._cameraTimer = setTimeout(() => {
      if (this._aborted || !this._cameraLeader) return
      this._cameraInterval = setInterval(() => {
        if (this._aborted || !this._cameraLeader || this._isPaused) return
        try {
          const pos = this._cameraLeader.getLatLng()
          this.mapRef?.current?.panTo(pos, { animate: true, duration: 0.45 })
        } catch (_) {}
      }, 500)
      this._intervals.push(this._cameraInterval)
    }, delayMs)
    this._timeouts.push(this._cameraTimer)
  }

  _buildBullets(scene) {
    const bullets = []
    for (const el of (scene.scene_elements || [])) {
      if (el.type === "facility_marker" && el.name)
        bullets.push(`${el.name}${el.description ? ` — ${el.description}` : ""}`)
      if (el.type === "ship_animation")
        for (const v of (el.vessels || [])) { if (v.name) bullets.push(v.name) }
      if (el.type === "troop_movement")
        for (const u of (el.units || []))
          if (u.name) bullets.push(`${u.name}${u.strength ? ` (${u.strength})` : ""}`)
      if (el.type === "detection_boxes") {
        const types = {}
        for (const d of (el.detections || []))
          if (d.label) types[d.label] = (types[d.label] || 0) + 1
        for (const [label, count] of Object.entries(types)) bullets.push(`${count}× ${label}`)
      }
      if ((el.type === "cable_route" || el.type === "cable_from_db") && el.label)
        bullets.push(el.label)
    }
    return bullets.slice(0, 6)
  }

  _renderElement(el, animDurMs = 8000) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return

    switch (el.type) {

      case "chokepoint_poly": {
        const poly = L.polygon(el.coords, {
          color: el.color || "#ef4444", fillColor: el.color || "#ef4444",
          fillOpacity: 0.07, weight: 2, dashArray: "6 4",
        }).addTo(map)
        this._layers.push(poly)
        break
      }

      // RULE 1: real country borders from /geo/countries GeoJSON
      case "country_highlight": {
        this._renderCountryHighlightAsync(el)
        break
      }

      case "perimeter": {
        const poly = L.polygon(el.points, {
          color: el.color || "#3b82f6", fillColor: el.color || "#3b82f6",
          fillOpacity: 0.06, weight: 2, dashArray: el.dashed ? "8 5" : null,
        }).addTo(map)
        if (el.label) poly.bindTooltip(el.label, { permanent: true, className: "demo-runner-tooltip" })
        this._layers.push(poly)
        break
      }

      case "zone_overlay": {
        const poly = L.polygon(el.polygon || el.coords || [], {
          color: el.color || "#3b82f6", fillColor: el.color || "#3b82f6",
          fillOpacity: 0.18, weight: 2, opacity: 0.8,
        }).addTo(map)
        this._layers.push(poly)
        if (el.label) {
          try {
            const center = poly.getBounds().getCenter()
            const html = `<div style="font-size:10px;font-weight:700;color:${el.color || "#3b82f6"};background:rgba(0,0,0,0.72);padding:2px 7px;border-radius:4px;white-space:nowrap;font-family:system-ui;letter-spacing:0.05em;">${el.label}</div>`
            const lbl = L.marker(center, {
              icon: L.divIcon({ html, className: "", iconSize: [100, 18], iconAnchor: [50, 9] }),
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
            try { if (marker.getTooltip()) marker.setTooltipContent(this._tooltipHtml(url, el.name, el.description)) } catch (_) {}
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
        const line = L.polyline([el.from, el.to], {
          color: el.color || "#ef4444", weight: 2, dashArray: el.dashed ? "8 5" : null,
        }).addTo(map)
        if (el.label) line.bindTooltip(el.label, { permanent: true, className: "demo-runner-tooltip" })
        this._layers.push(line)
        break
      }

      case "radius_circle": {
        const c = el.color || "#3b82f6"
        const circle = L.circle([el.lat, el.lng], {
          radius: (el.radius_nm || 100) * 1852, color: c, fillColor: c,
          fillOpacity: 0.04, weight: 1, dashArray: "6 4",
        }).addTo(map)
        if (el.label) circle.bindTooltip(el.label, { permanent: true, direction: "center", className: "demo-runner-tooltip" })
        this._layers.push(circle)
        break
      }

      case "cable_route": {
        const line = L.polyline(el.path, {
          color: el.color || "#a855f7", weight: el.weight || 3,
          opacity: 0.8, dashArray: el.dashed ? "8 5" : null,
        }).addTo(map)
        if (el.label) {
          const midIdx = Math.floor(el.path.length / 2)
          const midPt  = el.path[midIdx] || el.path[0]
          const lbl = L.marker(midPt, {
            icon: L.divIcon({
              html: `<div style="font-size:9px;font-weight:700;color:${el.color || "#a855f7"};background:rgba(0,0,0,0.78);padding:2px 7px;border-radius:4px;white-space:nowrap;font-family:system-ui;letter-spacing:0.06em;">${el.label}</div>`,
              className: "", iconSize: [140, 16], iconAnchor: [70, 8],
            }),
          }).addTo(map)
          this._layers.push(lbl)
        }
        this._layers.push(line)
        break
      }

      // RULE 2: submarine cable from database
      case "cable_from_db": {
        this._renderCableFromDBAsync(el)
        break
      }

      case "flow_arrows": {
        for (const flow of (el.flows || [])) {
          const line = L.polyline([flow.from, flow.to], {
            color:   flow.color || "#f59e0b",
            weight:  flow.width || 2,
            opacity: 0.72,
            dashArray: "12 4",
          }).addTo(map)
          this._layers.push(line)
          const bearing  = _bearingDeg(flow.from, flow.to)
          const arrowHtml = `<div style="font-size:14px;color:${flow.color || "#f59e0b"};transform:rotate(${bearing}deg);line-height:1;filter:drop-shadow(0 0 3px ${flow.color || "#f59e0b"}80)">▲</div>`
          const arrowMkr = L.marker(flow.to, {
            icon: L.divIcon({ html: arrowHtml, className: "", iconSize: [18, 18], iconAnchor: [9, 9] }),
          }).addTo(map)
          this._layers.push(arrowMkr)
          if (flow.label) {
            const mid = [(flow.from[0] + flow.to[0]) / 2, (flow.from[1] + flow.to[1]) / 2]
            const lblHtml = `<div style="font-size:10px;font-weight:700;color:${flow.color || "#f59e0b"};background:rgba(0,0,0,0.72);padding:2px 7px;border-radius:4px;white-space:nowrap;font-family:system-ui;">${flow.label}</div>`
            const lblMkr  = L.marker(mid, {
              icon: L.divIcon({ html: lblHtml, className: "", iconSize: [130, 18], iconAnchor: [65, 9] }),
            }).addTo(map)
            this._layers.push(lblMkr)
          }
        }
        break
      }

      case "ship_animation": {
        for (const vessel of (el.vessels || [])) this._spawnVessel(vessel, animDurMs)
        break
      }

      case "flight_animation": {
        for (const ac of (el.aircraft || [])) this._spawnVessel(ac, animDurMs)
        break
      }

      // RULE 4: troop movement uses OSRM road routing
      case "troop_movement": {
        for (const unit of (el.units || []))
          this._spawnTroopWithRoute(unit, animDurMs)
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

  // ── RULE 1: real country GeoJSON ─────────────────────────────────────────────

  async _getCountriesGeoJSON() {
    if (this._countriesCache) return this._countriesCache
    if (this._countriesFetchPromise) return this._countriesFetchPromise
    this._countriesFetchPromise = (async () => {
      try {
        const r = await fetch(`${API_BASE}/geo/countries`)
        if (r.ok) {
          const data = await r.json()
          this._countriesCache = data
          return data
        }
      } catch (err) {
        console.warn("[DemoRunner] countries GeoJSON fetch error:", err.message)
      }
      return null
    })()
    return this._countriesFetchPromise
  }

  async _renderCountryHighlightAsync(el) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return
    try {
      const geoJSON = await this._getCountriesGeoJSON()
      if (!geoJSON || this._aborted) return
      const name = (el.name || el.country || "").toLowerCase().trim()
      const feature = geoJSON.features?.find(f => {
        const n = (f.properties?.name || f.properties?.NAME || f.properties?.ADMIN || "").toLowerCase()
        return n === name
      })
      if (!feature) {
        console.warn(`[DemoRunner] country_highlight: no GeoJSON feature for "${name}"`)
        return
      }
      const layer = L.geoJSON(feature, {
        style: {
          color:       el.color || "#ef4444",
          fillColor:   el.color || "#ef4444",
          fillOpacity: 0.25,
          weight:      3,
          opacity:     0.8,
        },
      }).addTo(map)
      this._layers.push(layer)
    } catch (err) {
      console.warn("[DemoRunner] country_highlight error:", err.message)
    }
  }

  // ── RULE 2: cable from database ──────────────────────────────────────────────

  async _renderCableFromDBAsync(el) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return
    try {
      const name = el.cable_name || el.name || ""
      const r    = await fetch(`${API_BASE}/api/infrastructure/cables?name=${encodeURIComponent(name)}`)
      if (!r.ok || this._aborted) return
      const data    = await r.json()
      const feature = data.cables?.[0]
      if (!feature?.geometry) {
        console.warn(`[DemoRunner] cable_from_db: no feature found for "${name}"`)
        return
      }
      const layer = L.geoJSON(feature, {
        style: {
          color:     el.color || "#a855f7",
          weight:    el.weight || 3,
          opacity:   0.85,
          dashArray: el.dashed ? "8 5" : null,
        },
      }).addTo(map)
      this._layers.push(layer)
      if (el.label) {
        try {
          const bounds = layer.getBounds()
          const center = bounds.getCenter()
          const lbl = L.marker(center, {
            icon: L.divIcon({
              html: `<div style="font-size:9px;font-weight:700;color:${el.color || "#a855f7"};background:rgba(0,0,0,0.78);padding:2px 7px;border-radius:4px;white-space:nowrap;font-family:system-ui;letter-spacing:0.06em;">${el.label}</div>`,
              className: "", iconSize: [140, 16], iconAnchor: [70, 8],
            }),
          }).addTo(map)
          this._layers.push(lbl)
        } catch (_) {}
      }
    } catch (err) {
      console.warn("[DemoRunner] cable_from_db error:", err.message)
    }
  }

  // ── RULE 4: OSRM road routing for troops ─────────────────────────────────────

  async _getTroopRoute(start, end) {
    try {
      const tok = localStorage.getItem("hw-auth-token")
      const r   = await fetch(`${API_BASE}/route`, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: JSON.stringify({ points: [start, end], mode: "driving" }),
      })
      if (r.ok) {
        const data = await r.json()
        // OSRM returns [lon, lat] — swap to [lat, lon] for Leaflet
        const path = (data.coordinates || []).map(c => [c[1], c[0]])
        if (path.length >= 2) return path
      }
    } catch (_) {}
    return null
  }

  async _spawnTroopWithRoute(unit, animDurMs) {
    let path = await this._getTroopRoute(unit.start, unit.end)
    if (!path) path = [unit.start, unit.end]
    if (this._aborted) return
    this._spawnVessel({
      name:  unit.name,
      color: unit.color || "#ef4444",
      icon:  unit.icon  || "troops",
      path,
    }, animDurMs)
  }

  // ── Vessel / aircraft spawning ────────────────────────────────────────────────

  _spawnVessel(vessel, animDurMs) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return

    const path = vessel.path || []
    if (path.length < 2) return

    const icon = makeDemoIcon(vessel, path)
    if (!icon) return

    const marker = L.marker(path[0], { icon }).addTo(map)
    if (vessel.name) marker.bindTooltip(vessel.name, { direction: "top", className: "demo-runner-tooltip" })

    const trail = L.polyline([path[0]], { color: vessel.color || "#3b82f6", weight: 1.5, opacity: 0.35 }).addTo(map)

    // RULE 6: push to persistent layers so they survive scene transitions
    this._persistentLayers.push(marker, trail)

    if (!this._cameraLeader) this._cameraLeader = marker

    this._animateAlongPath(marker, trail, path, animDurMs)
  }

  _animateAlongPath(marker, trail, path, durationMs) {
    const totalPoints = path.length
    let   startTime   = null
    let   pausedAt    = null
    let   lastSegIdx  = -1

    const step = (currentTime) => {
      if (this._aborted) return
      if (startTime === null) startTime = currentTime

      if (this._isPaused) {
        if (pausedAt === null) pausedAt = currentTime
        this._animFrames.push(requestAnimationFrame(step))
        return
      }
      if (pausedAt !== null) {
        startTime += currentTime - pausedAt
        pausedAt = null
      }

      const elapsed  = currentTime - startTime
      const progress = Math.min(elapsed / durationMs, 1)

      if (progress >= 1) {
        try { marker.setLatLng(path[totalPoints - 1]) } catch (_) {}
        return
      }

      const segFloat    = progress * (totalPoints - 1)
      const segIdx      = Math.min(Math.floor(segFloat), totalPoints - 2)
      const segProgress = segFloat - segIdx

      const lat = path[segIdx][0] + (path[segIdx + 1][0] - path[segIdx][0]) * segProgress
      const lng = path[segIdx][1] + (path[segIdx + 1][1] - path[segIdx][1]) * segProgress

      try { marker.setLatLng([lat, lng]) } catch (_) { return }

      if (segIdx !== lastSegIdx) {
        lastSegIdx = segIdx
        updateMarkerHeading(marker, _bearingDeg(path[segIdx], path[segIdx + 1]))
      }

      if (Math.round(elapsed) % 100 < 16) {
        try {
          const pts = trail.getLatLngs()
          pts.push(window.L.latLng(lat, lng))
          trail.setLatLngs(pts)
        } catch (_) {}
      }

      this._animFrames.push(requestAnimationFrame(step))
    }

    this._animFrames.push(requestAnimationFrame(step))
  }

  // ── Overwatch scan ────────────────────────────────────────────────────────────

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

    const rect = L.rectangle([[south, west], [north, east]], {
      color: el.color || "#38bdf8", fillColor: el.color || "#38bdf8",
      fillOpacity: 0.05, weight: 1.5, dashArray: "4 4",
    }).addTo(map)
    if (el.label) rect.bindTooltip(el.label, { permanent: true, direction: "center", className: "demo-runner-tooltip" })
    this._layers.push(rect)

    const doScan = () => {
      const scanLine = L.polyline([[south, west], [north, west]], {
        color: el.color || "#38bdf8", weight: 2, opacity: 0.95,
      }).addTo(map)
      const scanGlow = L.polyline([[south, west], [north, west]], {
        color: el.color || "#38bdf8", weight: 10, opacity: 0.18,
      }).addTo(map)
      this._layers.push(scanLine, scanGlow)

      const totalMs = el.scan_duration || 4000
      let   elapsed = 0

      const id = setInterval(() => {
        if (this._aborted) { clearInterval(id); return }
        if (this._isPaused) return
        elapsed += 40
        const p   = Math.min(elapsed / totalMs, 1)
        const lng = west + (east - west) * p
        try {
          scanLine.setLatLngs([[south, lng], [north, lng]])
          scanGlow.setLatLngs([[south, lng], [north, lng]])
        } catch (_) {}
        if (p >= 1) clearInterval(id)
      }, 40)
      this._intervals.push(id)

      // RULE 5: try real ML detection, store results for detection_boxes renderer
      this._tryMLDetect({ north, south, east, west }, el.zoom || 17, el.confidence || 0.3)
    }

    if (el.interactive) {
      this.onScanPrompt(doScan)
    } else {
      doScan()
    }
  }

  // RULE 5: real ML scan with fallback
  async _tryMLDetect(bounds, zoom, confidence) {
    try {
      const tok = localStorage.getItem("hw-auth-token")
      const r   = await fetch(`${API_BASE}/api/overwatch/detect`, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: JSON.stringify({ bounds, zoom, confidence }),
      })
      if (r.ok) {
        const data = await r.json()
        if (data.count > 0) {
          console.log(`[DemoRunner] ML detect: ${data.count} real objects found`)
          // Convert ML detection format → demo detection box format
          this._latestMLDetections = (data.detections || []).map(d => {
            const lats = d.corners.map(c => c[0])
            const lngs = d.corners.map(c => c[1])
            const h = Math.max(...lats) - Math.min(...lats)
            const w = Math.max(...lngs) - Math.min(...lngs)
            return {
              lat:        d.center[0],
              lng:        d.center[1],
              h,
              w,
              label:      (d.specific_type || d.class || "object").toUpperCase(),
              confidence: Math.round((d.confidence || 0) * 100),
              color:      "#38bdf8",
            }
          })
          return
        }
      }
    } catch (err) {
      console.warn("[DemoRunner] ML detect error:", err.message)
    }
    // No real results — leave _latestMLDetections null so hardcoded detections are used
    console.log("[DemoRunner] ML detect: no results, using scene fallback detections")
  }

  _renderDetectionBoxes(el) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return

    // RULE 5: use real ML detections if available, else scene detections
    const detections  = this._latestMLDetections || el.detections || []
    this._latestMLDetections = null  // consume after use
    const revealDelay = el.reveal_delay || 150

    detections.forEach((d, i) => {
      const tid = setTimeout(() => {
        if (this._aborted) return
        const half_h = (d.h ?? d.height ?? 0.001) / 2
        const half_w = (d.w ?? d.width  ?? 0.001) / 2
        const rect = L.rectangle(
          [[d.lat - half_h, d.lng - half_w], [d.lat + half_h, d.lng + half_w]],
          { color: d.color || "#38bdf8", fillColor: d.color || "#38bdf8", fillOpacity: 0.1, weight: 2 }
        ).addTo(map)
        this._layers.push(rect)

        if (d.label) {
          const conf = Math.round(d.confidence || 0)
          const html = `<div style="font-size:9px;color:${d.color || "#38bdf8"};background:rgba(0,0,0,0.82);padding:1px 5px;white-space:nowrap;font-weight:700;font-family:system-ui;border-left:2px solid ${d.color || "#38bdf8"};line-height:1.5;">${d.label} ${conf}%</div>`
          const lbl = L.marker([d.lat + half_h, d.lng - half_w], {
            icon: L.divIcon({ html, className: "", iconSize: [130, 14], iconAnchor: [0, 14] }),
          }).addTo(map)
          this._layers.push(lbl)
        }
      }, i * revealDelay)
      this._timeouts.push(tid)
    })
  }

  _tooltipHtml(imgUrl, name, description) {
    const img  = imgUrl ? `<img src="${imgUrl}" style="width:100%;height:80px;object-fit:cover;border-radius:5px 5px 0 0;display:block;" loading="lazy"/>` : ""
    const body = (name || description)
      ? `<div style="padding:5px 8px;">`
        + (name        ? `<div style="font-size:11px;font-weight:700;color:#e0eaff;letter-spacing:0.03em;">${name}</div>` : "")
        + (description ? `<div style="font-size:10px;color:rgba(160,180,220,0.6);margin-top:2px;line-height:1.3;">${description}</div>` : "")
        + `</div>`
      : ""
    return `<div style="min-width:130px;max-width:160px;">${img}${body}</div>`
  }

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
    if (map) {
      for (const layer of this._layers) {
        try { map.removeLayer(layer) } catch (_) {}
      }
    }
    this._layers = []
    // NOTE: _persistentLayers intentionally NOT cleared here (RULE 6)
  }

  // RULE 6: clear persistent layers (ships/troops) — called on scenario change and stop()
  _clearPersistentLayers() {
    const map = this.mapRef?.current
    if (map) {
      for (const layer of this._persistentLayers) {
        try { map.removeLayer(layer) } catch (_) {}
      }
    }
    this._persistentLayers = []
    this._currentScenario  = null
  }

  _cancelAnimations() {
    for (const id of this._animFrames) cancelAnimationFrame(id)
    this._animFrames = []
  }

  async _pauseAwareSleep(ms) {
    let remaining = ms
    while (remaining > 0) {
      if (this._aborted) return
      if (this._isPaused) {
        await new Promise(r => setTimeout(r, 100))
        continue
      }
      const tick = Math.min(100, remaining)
      await new Promise(r => setTimeout(r, tick))
      remaining -= tick
    }
  }

  async _waitWhilePaused() {
    while (this._isPaused && !this._aborted) {
      await new Promise(r => setTimeout(r, 200))
    }
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

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
}
