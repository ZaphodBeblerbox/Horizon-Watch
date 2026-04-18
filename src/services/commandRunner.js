/**
 * commandRunner.js — Director Mode action sequence playback engine.
 *
 * Usage:
 *   const runner = new CommandRunner({ mapRef, setDirectorItems, ... })
 *   runner.load(sequence)
 *   runner.play()
 *   runner.pause()
 *   runner.stepForward()
 *   runner.stepBackward()
 *   runner.jumpTo(index)
 *   runner.stop()
 *   runner.destroy()
 *
 * Callbacks:
 *   onAction(action, index)
 *   onProgress(index, total)
 *   onComplete()
 *   onNarrate(action)           — narrate / summary actions
 *   onIndicator(action)         — show_indicator actions
 *   onContextCard(action)       — show_context_card actions
 *   onStateChange(state)
 *
 * NOTE: All Leaflet L.* objects are created INSIDE handler methods only,
 * never at module level.
 */

import API_BASE from "../apiBase.js"
import ttsService from "./ttsService.js"

const AUTH_KEY = "hw-auth-token"

function _authHeaders() {
  const tok = localStorage.getItem(AUTH_KEY)
  return tok ? { Authorization: `Bearer ${tok}` } : {}
}

// ── Bearing helper for draw_arrow ─────────────────────────────────────────────
function _bearing(from, to) {
  const toRad = (d) => (d * Math.PI) / 180
  const toDeg = (r) => (r * 180) / Math.PI
  const dLon = toRad(to[1] - from[1])
  const lat1 = toRad(from[0])
  const lat2 = toRad(to[0])
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

export class CommandRunner {
  constructor({
    mapRef,
    setDirectorItems,
    setLayerOverrides,      // kept for legacy toggle_layer compat
    setHighlights,          // kept for legacy highlight_event compat
    surfaceItems = [],
    onAction      = () => {},
    onProgress    = () => {},
    onComplete    = () => {},
    onNarrate     = () => {},
    onIndicator   = () => {},
    onContextCard = () => {},
    onStateChange = () => {},
    onDetailPanel  = () => {},  // (panelState: {type,id}|null) => void
    onImage        = () => {},  // ({url, caption, attribution, loading}) => void
    onOpenDetail   = () => {},  // (type, id) => void — opens the real UI detail panel
    onCloseDetail  = () => {},  // () => void — closes the real UI detail panel
    onChart        = null,      // ({svg, title, duration}) => void — optional chart receiver
  } = {}) {
    this.mapRef            = mapRef
    this.setDirectorItems  = setDirectorItems
    this.setLayerOverrides = setLayerOverrides
    this.setHighlights     = setHighlights || (() => {})
    this.surfaceItems      = surfaceItems
    this.onAction          = onAction
    this.onProgress        = onProgress
    this.onComplete        = onComplete
    this.onNarrate         = onNarrate
    this.onIndicator       = onIndicator
    this.onContextCard     = onContextCard
    this.onStateChange     = onStateChange
    this.onDetailPanel     = onDetailPanel
    this.onImage           = onImage
    this.onOpenDetail      = onOpenDetail
    this.onCloseDetail     = onCloseDetail
    this.onChart           = onChart

    this.actions      = []
    this.currentIndex = -1
    this.isPlaying    = false
    this._timer       = null
    this._aborted     = false

    // Drawing layers stored here (Leaflet refs), added imperatively to map
    this._drawings    = []

    // Pending satellite observations to inject into next narrate
    this._pendingSatObservations = null

    // Pending image for current segment: set by show_image/show_aircraft/show_vessel
    // Delivered to onImage at next narrate action
    this._pendingImage = null

    // Local mirror of placed events for click_event lookups (title → evData)
    this._placedEvents = new Map()

    // Local mirror of placed locations for click_location lookups (name → locData)
    this._placedLocations = new Map()

    // Person dossier markers (name → Leaflet marker)
    this._personMarkers = {}
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  load(sequence) {
    this.stop()
    const rawActions = Array.isArray(sequence?.actions) ? sequence.actions : []
    // Flatten scene objects: { scene_id, actions: [...], fly_to? } → sub-actions
    this.actions = []
    for (const item of rawActions) {
      if (item && Array.isArray(item.actions) && (item.scene_id != null)) {
        if (item.fly_to) this.actions.push({ action: "fly_to", ...item.fly_to })
        this.actions.push(...item.actions)
      } else {
        this.actions.push(item)
      }
    }
    // Pre-build scene groups for synchronized playback
    this._scenes = this._groupActionsIntoScenes(this.actions)
    this._sceneIndex = -1

    this.currentIndex = -1
    this._aborted     = false
    this._pendingSatObservations = null
    this._pendingImage           = null
    this._placedEvents           = new Map()
    this._placedLocations        = new Map()
    this._notifyState()
  }

  /**
   * Group flat actions into { visuals: Action[], narration: Action|null } scenes.
   * Each scene ends at a narrate/summary action.
   */
  _groupActionsIntoScenes(actions) {
    const scenes = []
    let visuals  = []
    for (const action of actions) {
      const act = action?.action
      if (act === "narrate" || act === "summary") {
        scenes.push({ visuals, narration: action })
        visuals = []
      } else {
        visuals.push(action)
      }
    }
    if (visuals.length > 0) {
      scenes.push({ visuals, narration: null })
    }
    return scenes
  }

  play() {
    if (this.isPlaying) return
    if (this.currentIndex >= this.actions.length - 1) {
      this.currentIndex = -1
      this._sceneIndex  = -1
      this.setHighlights([])
      if (this.setLayerOverrides) this.setLayerOverrides({})
    }
    this.isPlaying = true
    this._aborted  = false
    this._notifyState()
    // Use scene-based synchronized play loop
    this._playSceneLoop()
  }

  // ── Synchronized scene-based play loop ────────────────────────────────────

  async _playSceneLoop() {
    const scenes = this._scenes || []
    // Resume from current scene if mid-way
    const startScene = Math.max(this._sceneIndex + 1, 0)

    for (let si = startScene; si < scenes.length; si++) {
      if (!this.isPlaying || this._aborted) break
      this._sceneIndex = si
      const scene = scenes[si]

      // Map scene index back to the last action index for progress tracking
      // (the narration action's position in the flat actions array)
      const narIdx = scene.narration
        ? this.actions.lastIndexOf(scene.narration)
        : (scene.visuals.length > 0 ? this.actions.lastIndexOf(scene.visuals[scene.visuals.length - 1]) : si)
      this.currentIndex = Math.max(narIdx, si)
      this.onProgress(this.currentIndex, this.actions.length)

      // ── Fire visual actions with staggered 300ms delays ──
      const STAGGER = 300
      const visualPromises = scene.visuals.map((action, idx) =>
        new Promise(resolve => {
          setTimeout(async () => {
            if (!this.isPlaying || this._aborted) { resolve(); return }
            this.onAction(action, this.actions.indexOf(action))
            await this._dispatchAction(action)
            resolve()
          }, idx * STAGGER)
        })
      )

      // ── Start narration 500ms after visuals begin (let first visuals land) ──
      let ttsPromise = Promise.resolve()
      if (scene.narration) {
        const narAction = scene.narration
        // Deliver pending image + fire onNarrate callback
        setTimeout(() => {
          if (!this.isPlaying || this._aborted) return
          this.onAction(narAction, this.actions.indexOf(narAction))
          // deliver pending image
          if (this._pendingImage) { this.onImage(this._pendingImage); this._pendingImage = null }
          else { this.onImage(null) }
          // prepend satellite observations if pending
          const narAct2 = { ...narAction }
          if (this._pendingSatObservations) {
            narAct2.text = `[Satellite Analysis] ${this._pendingSatObservations}\n\n${narAction.text || ""}`
            this._pendingSatObservations = null
          }
          this.onNarrate(narAct2)
        }, 500)

        // TTS starts 800ms after scene begins
        ttsPromise = new Promise(resolve => {
          setTimeout(async () => {
            if (!this.isPlaying || this._aborted) { resolve(); return }
            const narAct2 = { ...narAction }
            if (narAction.action === "summary") {
              await ttsService.speak(narAction.title || "")
              for (const sec of narAction.sections || []) {
                if (this._aborted || !this.isPlaying) break
                await ttsService.speak(sec.text || "")
              }
            } else {
              await ttsService.speak(narAct2.text || "")
            }
            resolve()
          }, 800)
        })
      }

      // Wait for both visuals and TTS
      await Promise.all([...visualPromises, ttsPromise])

      // Brief inter-scene pause
      if (this.isPlaying && !this._aborted) {
        await new Promise(r => { this._timer = setTimeout(r, 900) })
      }
    }

    if (this.isPlaying && !this._aborted) {
      this.isPlaying = false
      this._notifyState()
      this.onComplete()
    }
  }

  pause() {
    this.isPlaying = false
    clearTimeout(this._timer)
    this._timer = null
    ttsService.stop()
    this._notifyState()
  }

  stepForward() {
    ttsService.stop()
    this.pause()
    if (this.currentIndex < this.actions.length - 1) {
      this._executeIndex(this.currentIndex + 1)
    }
  }

  stepBackward() {
    ttsService.stop()
    this.pause()
    if (this.currentIndex > 0) {
      this._executeIndex(this.currentIndex - 1)
    }
  }

  jumpTo(index) {
    this.pause()
    const i = Math.max(0, Math.min(index, this.actions.length - 1))
    this._executeIndex(i)
  }

  jumpToStart() {
    this.pause()
    this.currentIndex = -1
    this.setHighlights([])
    if (this.setLayerOverrides) this.setLayerOverrides({})
    this._notifyState()
  }

  jumpToEnd() {
    this.pause()
    this._executeIndex(this.actions.length - 1)
  }

  stop() {
    this.isPlaying = false
    this._aborted  = true
    clearTimeout(this._timer)
    this._timer       = null
    this.currentIndex = -1
    this._sceneIndex  = -1
    this._clearAllDrawings()
    ttsService.stop()
    this._notifyState()
  }

  destroy() {
    this.stop()
  }

  get total()   { return this.actions.length }
  get index()   { return this.currentIndex }
  get playing() { return this.isPlaying }

  /** Return a copy of the full action list (for save). */
  getActions() { return [...this.actions] }

  // ── Internal playback ───────────────────────────────────────────────────────

  _advance() {
    if (!this.isPlaying || this._aborted) return
    const next = this.currentIndex + 1
    if (next >= this.actions.length) {
      this.isPlaying = false
      this._notifyState()
      this.onComplete()
      return
    }
    this._executeIndex(next)
  }

  async _executeIndex(index) {
    this.currentIndex = index
    const action = this.actions[index]
    if (!action) return

    this.onAction(action, index)
    this.onProgress(index, this.actions.length)

    // Async actions — handle separately (do not go through _dispatchAction)
    if (action.action === "analyse_satellite") {
      this._handleAnalyseSatelliteAsync(action)
      return
    }
    if (action.action === "narrate" || action.action === "summary") {
      this._handleNarrateAsync(action)
      return
    }

    const delay = await this._dispatchAction(action)
    if (this.isPlaying) {
      this._timer = setTimeout(() => this._advance(), delay)
    }
  }

  /**
   * Dispatch a single action. Returns ms to wait before next action.
   */
  async _dispatchAction(action) {
    const act = action.action
    const defaultDelay = 800

    switch (act) {

      // ── Camera ────────────────────────────────────────────────────────────

      case "fly_to": {
        const map = this.mapRef?.current
        if (map && typeof map.flyTo === "function") {
          const zoom     = action.zoom ?? 5
          const rawDur   = action.duration ?? 3000
          const duration = Math.max(rawDur, 2500) / 1000  // min 2.5s, Leaflet uses seconds
          map.flyTo([action.lat, action.lon], zoom, {
            animate:      true,
            duration,
            easeLinearity: 0.1,  // low = more cinematic, less linear
          })
          // After flyTo completes, we need tiles to settle. Use moveend + 500ms.
          // We return the raw duration + 600ms buffer to the timer so the runner
          // waits for the map to finish animating before the next action.
        }
        return Math.max(action.duration ?? 3000, 2500) + 600
      }

      case "pause": {
        return action.duration ?? 2000
      }

      // ── Narration ─────────────────────────────────────────────────────────

      case "narrate": {
        const act2 = { ...action }
        // Prepend any pending satellite observations
        if (this._pendingSatObservations) {
          act2.text = `[Satellite Analysis] ${this._pendingSatObservations}\n\n${action.text || ""}`
          this._pendingSatObservations = null
        }
        // Deliver any pending image for this segment
        if (this._pendingImage) {
          this.onImage(this._pendingImage)
          this._pendingImage = null
        } else {
          this.onImage(null)
        }
        this.onNarrate(act2)
        return 300
      }

      case "show_indicator": {
        this.onIndicator(action)
        return defaultDelay
      }

      case "show_context_card": {
        this.onContextCard(action)
        return defaultDelay
      }

      case "show_image": {
        const query   = action.query || ""
        const caption = action.caption || query
        console.log("[Director] show_image:", query)
        if (query) {
          // Set loading state immediately, fetch async
          this._pendingImage = { loading: true, url: null, caption, attribution: null }
          const tok = localStorage.getItem("hw-auth-token")
          const headers = tok ? { Authorization: `Bearer ${tok}` } : {}
          const imgUrl = `${API_BASE}/api/director/image-search?q=${encodeURIComponent(query)}${action.location ? `&location=${encodeURIComponent(action.location)}` : ""}`
          fetch(imgUrl, { headers })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data?.image_url) {
                this._pendingImage = {
                  url:         data.image_url,
                  caption:     caption || data.caption || query,
                  attribution: data.attribution || null,
                  loading:     false,
                }
              } else {
                this._pendingImage = null
              }
            })
            .catch(() => { this._pendingImage = null })
        }
        return defaultDelay
      }

      case "show_video": {
        const vQuery   = action.query || ""
        const vCaption = action.caption || vQuery
        if (vQuery) {
          this._pendingImage = { loading: true, url: null, caption: vCaption, isVideo: false }
          const tok = localStorage.getItem("hw-auth-token")
          const headers = tok ? { Authorization: `Bearer ${tok}` } : {}
          fetch(`${API_BASE}/api/director/video-search?q=${encodeURIComponent(vQuery)}`, { headers })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data?.video_url) {
                this._pendingImage = { url: data.video_url, caption: vCaption, isVideo: true, mime: data.mime, loading: false }
              } else {
                // Fall back to image search
                return fetch(`${API_BASE}/api/director/image-search?q=${encodeURIComponent(vQuery)}`, { headers })
                  .then(r => r.ok ? r.json() : null)
                  .then(imgData => {
                    if (imgData?.image_url) {
                      this._pendingImage = { url: imgData.image_url, caption: vCaption, isVideo: false, loading: false }
                    } else {
                      this._pendingImage = null
                    }
                  })
              }
            })
            .catch(() => { this._pendingImage = null })
        }
        return defaultDelay
      }

      // ── Individual data points ─────────────────────────────────────────────

      case "show_chokepoint": {
        const name = action.name
        if (name && this.setDirectorItems) {
          this.setDirectorItems(prev => {
            const next = new Set([...prev.chokepoints, name])
            console.log("[Director] show_chokepoint:", name, "| chokepoints now:", [...next])
            return { ...prev, chokepoints: next }
          })
        }
        return defaultDelay
      }

      case "hide_chokepoint": {
        const name = action.name
        if (name && this.setDirectorItems) {
          this.setDirectorItems(prev => {
            const next = new Set(prev.chokepoints)
            next.delete(name)
            return { ...prev, chokepoints: next }
          })
        }
        return defaultDelay
      }

      case "show_event": {
        const id = action.event_id
        if (id && this.setDirectorItems) {
          this.setDirectorItems(prev => {
            const next = new Set([...prev.events, id])
            console.log("[Director] show_event:", id, "| events now:", [...next])
            return { ...prev, events: next }
          })
        }
        return defaultDelay
      }

      case "hide_event": {
        const id = action.event_id
        if (id && this.setDirectorItems) {
          this.setDirectorItems(prev => {
            const next = new Set(prev.events)
            next.delete(id)
            return { ...prev, events: next }
          })
        }
        return defaultDelay
      }

      case "show_infrastructure": {
        const infId = action.id
        console.log("[Director] show_infrastructure:", infId, action.name, action.type, action.lat, action.lon)
        if (infId && this.setDirectorItems) {
          this.setDirectorItems(prev => {
            const next = new Map(prev.infrastructure)
            next.set(infId, {
              type: action.type || "other",
              name: action.name || "",
              lat:  action.lat,
              lon:  action.lon,
            })
            return { ...prev, infrastructure: next }
          })
        }
        return defaultDelay
      }

      case "hide_infrastructure": {
        const infId = action.id
        if (infId && this.setDirectorItems) {
          this.setDirectorItems(prev => {
            const next = new Map(prev.infrastructure)
            next.delete(infId)
            return { ...prev, infrastructure: next }
          })
        }
        return defaultDelay
      }

      case "show_vessel": {
        const mmsi = String(action.mmsi || "")
        console.log("[Director] show_vessel:", mmsi)
        if (mmsi && this.setDirectorItems) {
          this.setDirectorItems(prev => ({
            ...prev,
            vessels: new Set([...prev.vessels, mmsi]),
          }))
        }
        // Fetch vessel photo asynchronously if no image already pending
        if (mmsi && !this._pendingImage) {
          this._pendingImage = { loading: true, url: null, caption: null }
          const tok = localStorage.getItem("hw-auth-token")
          const headers = tok ? { Authorization: `Bearer ${tok}` } : {}
          fetch(`${API_BASE}/api/vessel/photo/${mmsi}`, { headers })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data?.thumbnail_url || data?.photo_url) {
                const caption = [action.name, action.flag].filter(Boolean).join(" · ") || `MMSI ${mmsi}`
                this._pendingImage = { url: data.thumbnail_url || data.photo_url, caption, attribution: null, loading: false }
              } else {
                this._pendingImage = null
              }
            })
            .catch(() => { this._pendingImage = null })
        }
        return defaultDelay
      }

      case "hide_vessel": {
        const mmsi = String(action.mmsi || "")
        if (mmsi && this.setDirectorItems) {
          this.setDirectorItems(prev => {
            const next = new Set(prev.vessels)
            next.delete(mmsi)
            return { ...prev, vessels: next }
          })
        }
        return defaultDelay
      }

      case "show_aircraft": {
        const icao = String(action.icao24 || "").toLowerCase()
        console.log("[Director] show_aircraft:", icao)
        if (icao && this.setDirectorItems) {
          this.setDirectorItems(prev => ({
            ...prev,
            aircraft: new Set([...prev.aircraft, icao]),
          }))
        }
        // Fetch photo asynchronously — don't block playback
        if (icao && !this._pendingImage) {
          this._pendingImage = { loading: true, url: null, caption: null }
          const tok = localStorage.getItem("hw-auth-token")
          const headers = tok ? { Authorization: `Bearer ${tok}` } : {}
          fetch(`${API_BASE}/api/aviation/photo/${icao}`, { headers })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data?.thumbnail_url) {
                const caption = [action.callsign, action.aircraft_type].filter(Boolean).join(" ") || icao.toUpperCase()
                this._pendingImage = { url: data.thumbnail_url, caption, attribution: data.photographer ? `© ${data.photographer}` : null, loading: false }
              } else {
                this._pendingImage = null
              }
            })
            .catch(() => { this._pendingImage = null })
        }
        return defaultDelay
      }

      case "hide_aircraft": {
        const icao = String(action.icao24 || "").toLowerCase()
        if (icao && this.setDirectorItems) {
          this.setDirectorItems(prev => {
            const next = new Set(prev.aircraft)
            next.delete(icao)
            return { ...prev, aircraft: next }
          })
        }
        return defaultDelay
      }

      case "clear_all": {
        console.log("[Director] clear_all executed")
        this._clearAllDrawings()
        this._placedEvents    = new Map()
        this._placedLocations = new Map()
        // Remove person dossier markers
        const mapCA = this.mapRef?.current
        if (this._personMarkers) {
          Object.values(this._personMarkers).forEach(m => {
            try { if (mapCA) mapCA.removeLayer(m) } catch (_) {}
          })
          this._personMarkers = {}
        }
        // Close any open Leaflet popups
        if (mapCA && typeof mapCA.closePopup === "function") mapCA.closePopup()
        if (this.setDirectorItems) {
          this.setDirectorItems({
            chokepoints:          new Set(),
            events:               new Set(),
            infrastructure:       new Map(),
            vessels:              new Set(),
            aircraft:             new Set(),
            satellite:            false,
            detailPanel:          null,
            highlightedCountries: new Map(),
            placedEvents:         new Map(),
            placedLocations:      new Map(),
          })
        }
        this.setHighlights([])
        this.onDetailPanel(null)
        return defaultDelay
      }

      // ── Placed events (self-geocoded by Claude) ───────────────────────────

      case "place_event": {
        const { title, lat, lon, type, severity, source, summary: evSummary, timestamp } = action
        if (title && lat != null && lon != null && this.setDirectorItems) {
          const evData = {
            title,
            lat,
            lon,
            type:      type      || "general",
            severity:  severity  || "elevated",
            source:    source    || "",
            summary:   evSummary || "",
            timestamp: timestamp || null,
          }
          this._placedEvents.set(title, evData)
          this.setDirectorItems(prev => {
            const m = new Map(prev.placedEvents || new Map())
            m.set(title, evData)
            return { ...prev, placedEvents: m }
          })
          console.log("[Director] place_event:", title, lat, lon, type, severity)
        }
        return defaultDelay
      }

      case "remove_event": {
        const title = action.title
        if (title && this.setDirectorItems) {
          this._placedEvents.delete(title)
          this.setDirectorItems(prev => {
            const m = new Map(prev.placedEvents || new Map())
            m.delete(title)
            return { ...prev, placedEvents: m }
          })
        }
        return defaultDelay
      }

      case "click_event": {
        const map = this.mapRef?.current
        const L   = window.L
        if (!map || !L) return defaultDelay
        const ev = this._placedEvents.get(action.title)
        if (!ev) return defaultDelay
        const SEVERITY_COLOR = { critical: "#ef4444", significant: "#f59e0b", elevated: "#3b82f6", low: "#6b7280" }
        const color    = SEVERITY_COLOR[ev.severity] || "#3b82f6"
        const imgId    = `dir-ev-img-${Date.now()}`
        const timeAgo  = ev.timestamp ? this._formatTimeAgo(ev.timestamp) : ""
        const absTime  = ev.timestamp ? (() => { try { return new Date(ev.timestamp).toLocaleString() } catch { return "" } })() : ""
        const html = `<div class="director-event-popup">
          <div class="director-event-popup-header" style="border-left:3px solid ${color};padding-left:8px;display:flex;justify-content:space-between;align-items:center">
            <span>
              <span class="director-event-popup-type">${(ev.type || "event").toUpperCase()}</span>
              <span class="director-event-popup-severity" style="color:${color};margin-left:6px">${(ev.severity || "").toUpperCase()}</span>
            </span>
            ${timeAgo ? `<span style="font-size:10px;color:rgba(255,180,0,0.9);flex-shrink:0" title="${absTime}">${timeAgo}</span>` : ""}
          </div>
          <div class="director-event-popup-title">${ev.title}</div>
          ${ev.summary ? `<div class="director-event-popup-summary">${ev.summary}</div>` : ""}
          ${ev.source || absTime ? `<div class="director-event-popup-source">${ev.source || ""}${ev.source && absTime ? " · " : ""}${absTime}</div>` : ""}
          <div id="${imgId}" class="director-event-popup-img"></div>
        </div>`
        const popup = L.popup({ className: "director-event-leaflet-popup", maxWidth: 300, closeButton: true })
          .setLatLng([ev.lat, ev.lon])
          .setContent(html)
          .openOn(map)
        this._drawings.push(popup)
        // Async: fetch image and inject into popup
        const q = `${ev.title} ${ev.source || ""}`.trim()
        const tok = localStorage.getItem("hw-auth-token")
        const hdrs = tok ? { Authorization: `Bearer ${tok}` } : {}
        fetch(`${API_BASE}/api/director/image-search?q=${encodeURIComponent(q)}`, { headers: hdrs })
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.image_url) {
              const el = document.getElementById(imgId)
              if (el) el.innerHTML = `<img src="${data.image_url}" style="width:100%;border-radius:4px;margin-top:6px"/>${data.attribution ? `<div style="font-size:10px;opacity:0.5;margin-top:2px">${data.attribution}</div>` : ""}`
            }
          })
          .catch(() => {})
        return 1000
      }

      // ── Click handlers (open real detail panels) ──────────────────────────

      case "click_chokepoint": {
        this.onOpenDetail("chokepoint", action.name)
        return 600
      }

      case "click_vessel": {
        this.onOpenDetail("vessel", String(action.mmsi || ""))
        return 600
      }

      case "click_aircraft": {
        this.onOpenDetail("aircraft", String(action.icao24 || "").toLowerCase())
        return 600
      }

      case "click_infrastructure": {
        this.onOpenDetail("infrastructure", action.name || action.id || "")
        return 600
      }

      // ── Location placement ────────────────────────────────────────────────

      case "place_location": {
        const { name, lat, lon, type, description } = action
        if (name && lat != null && lon != null && this.setDirectorItems) {
          const locData = {
            name,
            lat,
            lon,
            type:        type        || "city",
            description: description || "",
          }
          this._placedLocations.set(name, locData)
          this.setDirectorItems(prev => {
            const m = new Map(prev.placedLocations || new Map())
            m.set(name, locData)
            return { ...prev, placedLocations: m }
          })
          console.log("[Director] place_location:", name, lat, lon, type)
        }
        return defaultDelay
      }

      case "remove_location": {
        const name = action.name
        if (name && this.setDirectorItems) {
          this._placedLocations.delete(name)
          this.setDirectorItems(prev => {
            const m = new Map(prev.placedLocations || new Map())
            m.delete(name)
            return { ...prev, placedLocations: m }
          })
        }
        return defaultDelay
      }

      case "click_location": {
        const map = this.mapRef?.current
        const L   = window.L
        if (!map || !L) return defaultDelay
        const loc = this._placedLocations.get(action.name)
        if (!loc) return defaultDelay

        const TYPE_ICONS  = { city: "🏙", base: "⚔", port: "⚓", facility: "⚙", landmark: "◆", target: "🎯" }
        const TYPE_LABELS = { city: "CITY", base: "MILITARY BASE", port: "PORT", facility: "FACILITY", landmark: "LANDMARK", target: "STRIKE TARGET" }
        const icon  = TYPE_ICONS[loc.type]  || "📍"
        const label = TYPE_LABELS[loc.type] || "LOCATION"
        const imgId = `dir-loc-img-${Date.now()}`

        const html = `<div class="director-location-popup-content">
          <div id="${imgId}" class="director-popup-image"></div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.5);margin-bottom:4px;">${icon} ${label}</div>
          <div style="font-size:15px;font-weight:700;color:white;margin-bottom:6px;">${loc.name}</div>
          ${loc.description ? `<div style="font-size:13px;color:rgba(255,255,255,0.8);line-height:1.5;">${loc.description}</div>` : ""}
        </div>`

        const popup = L.popup({ className: "director-location-popup", maxWidth: 300, closeButton: true, autoPan: false })
          .setLatLng([loc.lat, loc.lon])
          .setContent(html)
          .openOn(map)
        this._drawings.push(popup)

        // Async: fetch image and inject
        const tok  = localStorage.getItem("hw-auth-token")
        const hdrs = tok ? { Authorization: `Bearer ${tok}` } : {}
        fetch(`${API_BASE}/api/director/image-search?q=${encodeURIComponent(loc.name)}`, { headers: hdrs })
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.image_url) {
              const el = document.getElementById(imgId)
              if (el) el.innerHTML = `<img src="${data.image_url}" alt="${loc.name}" style="width:100%;border-radius:6px;margin-bottom:8px;"/>${data.attribution ? `<div style="font-size:10px;opacity:0.4;margin-bottom:6px;">${data.attribution}</div>` : ""}`
            }
          })
          .catch(() => {})
        return 1200
      }

      // ── Country click (open country news panel) ───────────────────────────

      case "click_country": {
        const name = action.name
        if (name) {
          this.onOpenDetail("country", name)
          console.log("[Director] click_country:", name)
        }
        return 500
      }

      // ── Country highlights ────────────────────────────────────────────────

      case "highlight_country": {
        const name = action.name
        if (name && this.setDirectorItems) {
          this.setDirectorItems(prev => {
            const next = new Map(prev.highlightedCountries || new Map())
            next.set(name, { context: action.context || "focus", label: action.label || "" })
            console.log("[Director] highlight_country:", name, action.context)
            return { ...prev, highlightedCountries: next }
          })
        }
        return defaultDelay
      }

      case "unhighlight_country": {
        const name = action.name
        if (name && this.setDirectorItems) {
          this.setDirectorItems(prev => {
            const next = new Map(prev.highlightedCountries || new Map())
            next.delete(name)
            return { ...prev, highlightedCountries: next }
          })
        }
        return defaultDelay
      }

      case "clear_country_highlights": {
        if (this.setDirectorItems) {
          this.setDirectorItems(prev => ({ ...prev, highlightedCountries: new Map() }))
          console.log("[Director] clear_country_highlights")
        }
        return defaultDelay
      }

      // ── Drawing ───────────────────────────────────────────────────────────

      case "draw_line": {
        const map = this.mapRef?.current
        if (!map) return defaultDelay
        // L.* created inside handler — never at module level
        const L = window.L
        if (!L) return defaultDelay
        const pts   = (action.points || []).map(p => [p[0], p[1]])
        const color = action.color || "#56cfff"
        const opts  = {
          color,
          weight:    2,
          opacity:   0.85,
          dashArray: action.dashed ? "10 5" : null,
          className: "director-drawing-line",
        }
        const layer = L.polyline(pts, opts).addTo(map)
        if (action.label) layer.bindTooltip(action.label, { permanent: false, sticky: true })

        // Ship animation for routing/shipping/transit lines
        const isRoute = /route|shipping|transit|lane|movement/i.test(action.label || "")
        if (isRoute && pts.length >= 2) {
          const shipIcon = L.divIcon({
            className: "",
            html: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" style="filter:drop-shadow(0 0 4px rgba(86,207,255,0.9)) drop-shadow(0 0 8px rgba(56,139,255,0.6))"><polygon points="12,2 22,20 2,20" fill="#56cfff" opacity="0.95"/><line x1="12" y1="2" x2="12" y2="10" stroke="#93e8ff" stroke-width="1.5"/></svg>`,
            iconSize:   [18, 18],
            iconAnchor: [9, 9],
          })
          const shipMarker = L.marker(pts[0], { icon: shipIcon, interactive: false, zIndexOffset: 700 }).addTo(map)

          // Compute cumulative distances for interpolation
          const dists = [0]
          for (let i = 1; i < pts.length; i++) {
            const a = map.latLngToLayerPoint(L.latLng(pts[i - 1]))
            const b = map.latLngToLayerPoint(L.latLng(pts[i]))
            dists.push(dists[i - 1] + Math.hypot(b.x - a.x, b.y - a.y))
          }
          const totalDist = dists[dists.length - 1]
          const DURATION  = 12000  // ms for one full traversal
          let startTime   = null
          let animFrame   = null
          let stopped     = false

          const animate = (ts) => {
            if (stopped) return
            if (!startTime) startTime = ts
            const elapsed = (ts - startTime) % DURATION
            const progress = elapsed / DURATION
            const target   = progress * totalDist

            // Find segment
            let seg = 0
            for (let i = 1; i < dists.length; i++) {
              if (dists[i] >= target) { seg = i - 1; break }
              seg = i - 1
            }
            const segDist  = dists[seg + 1] - dists[seg]
            const segProg  = segDist > 0 ? (target - dists[seg]) / segDist : 0
            const from     = pts[seg]
            const to       = pts[Math.min(seg + 1, pts.length - 1)]
            const interpLat = from[0] + (to[0] - from[0]) * segProg
            const interpLon = from[1] + (to[1] - from[1]) * segProg
            try { shipMarker.setLatLng([interpLat, interpLon]) } catch (_) {}
            animFrame = requestAnimationFrame(animate)
          }
          animFrame = requestAnimationFrame(animate)

          // Store as object so _clearAllDrawings can cancel the frame and remove both
          this._drawings.push({ layer: shipMarker, animFrame: () => { stopped = true; if (animFrame) cancelAnimationFrame(animFrame) } })
        }

        this._drawings.push(layer)
        return 600 + (pts.length * 20)  // brief draw animation
      }

      case "draw_circle": {
        const map = this.mapRef?.current
        if (!map) return defaultDelay
        const L = window.L
        if (!L) return defaultDelay
        const center = action.center || [action.lat, action.lon]
        const color  = action.color || "#f59e0b"
        const layer  = L.circle([center[0], center[1]], {
          radius:      (action.radius_km || 10) * 1000,
          color,
          weight:      2,
          fillColor:   color,
          fill:        action.fill !== false,
          fillOpacity: 0.12,
          className:   "director-drawing-fill",
        }).addTo(map)
        if (action.label) layer.bindTooltip(action.label, { permanent: false, sticky: true })
        this._drawings.push(layer)
        return 600
      }

      case "draw_arrow": {
        const map = this.mapRef?.current
        if (!map) return defaultDelay
        const L = window.L
        if (!L) return defaultDelay
        this._drawCurvedArrow(action)
        return 2800
      }

      case "_draw_arrow_straight": {
        // kept as internal fallback — not exposed to Claude
        const map = this.mapRef?.current
        if (!map) return defaultDelay
        const L     = window.L
        if (!L) return defaultDelay
        const from  = action.from
        const to    = action.to
        const color = action.color || "#ef4444"
        const isStrike = /strike|missile|attack|launch|trajectory|vector|rocket|bomb/i.test(action.label || "")

        // Line — thicker, glowing
        const line  = L.polyline([from, to], {
          color,
          weight:    isStrike ? 2 : 3,
          opacity:   0.9,
          dashArray: isStrike ? "8 6" : null,
          className: "director-drawing-line",
        }).addTo(map)
        if (action.label) line.bindTooltip(action.label, { permanent: false, sticky: true })

        // Arrowhead
        const bearing = _bearing(from, to)
        const arrowIcon = L.divIcon({
          className: "",
          html: `<div style="
            width: 0; height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-bottom: 12px solid ${color};
            transform: rotate(${bearing}deg);
            transform-origin: center bottom;
            opacity: 0.9;
          "></div>`,
          iconSize:   [12, 12],
          iconAnchor: [6, 6],
        })
        const arrowHead = L.marker(to, { icon: arrowIcon, interactive: false }).addTo(map)
        this._drawings.push(line, arrowHead)

        // Missile / projectile animation for strike trajectories
        if (isStrike) {
          const fromLL = L.latLng(from[0], from[1])
          const toLL   = L.latLng(to[0],   to[1])
          const projectileIcon = L.divIcon({
            className: "",
            html: `<div style="
              width:14px; height:14px;
              background: radial-gradient(circle, ${color} 20%, transparent 70%);
              border-radius:50%;
              box-shadow: 0 0 16px ${color}, 0 0 32px ${color}88;
              filter: brightness(1.5);
            "></div>`,
            iconSize:   [14, 14],
            iconAnchor: [7, 7],
          })
          const projectile = L.marker([from[0], from[1]], { icon: projectileIcon, interactive: false, zIndexOffset: 900 }).addTo(map)
          this._drawings.push({ layer: projectile, animFrame: null })
          const projEntry = this._drawings[this._drawings.length - 1]

          const trail = []
          const DURATION = 2200
          const startTime = Date.now()
          let stopped = false
          let rafId = null

          const animateProjectile = () => {
            if (stopped) return
            const elapsed  = Date.now() - startTime
            const progress = Math.min(elapsed / DURATION, 1)
            const eased    = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2
            const lat = fromLL.lat + (toLL.lat - fromLL.lat) * eased
            const lng = fromLL.lng + (toLL.lng - fromLL.lng) * eased
            try { projectile.setLatLng([lat, lng]) } catch (_) {}

            // Fade trail
            trail.forEach(t => {
              t.opacity *= 0.88
              try { t.marker.setStyle({ fillOpacity: t.opacity }) } catch (_) {}
            })
            // Add new trail dot occasionally
            if (Math.random() < 0.25) {
              try {
                const tm = L.circleMarker([lat, lng], {
                  radius: 3, color, fillColor: color, fillOpacity: 0.55, weight: 0,
                }).addTo(map)
                trail.push({ marker: tm, opacity: 0.55 })
                this._drawings.push({ layer: tm, animFrame: null })
              } catch (_) {}
            }

            if (progress < 1) {
              rafId = requestAnimationFrame(animateProjectile)
              projEntry.animFrame = () => { stopped = true; if (rafId) cancelAnimationFrame(rafId) }
            } else {
              stopped = true
              try { map.removeLayer(projectile) } catch (_) {}
              this._createImpactAnimation(toLL.lat, toLL.lng, color)
              setTimeout(() => {
                trail.forEach(t => { try { map.removeLayer(t.marker) } catch (_) {} })
              }, 1500)
            }
          }
          rafId = requestAnimationFrame(animateProjectile)
          projEntry.animFrame = () => { stopped = true; if (rafId) cancelAnimationFrame(rafId) }
          return 3000
        }

        return 800
      }

      case "draw_polygon": {
        const map = this.mapRef?.current
        if (!map) return defaultDelay
        const L     = window.L
        if (!L) return defaultDelay
        const pts   = (action.points || []).map(p => [p[0], p[1]])
        const color = action.color || "#ef4444"
        const layer = L.polygon(pts, {
          color,
          weight:      2,
          fillColor:   color,
          fill:        action.fill !== false,
          fillOpacity: 0.12,
          className:   "director-drawing-fill",
        }).addTo(map)
        if (action.label) layer.bindTooltip(action.label, { permanent: false, sticky: true })
        this._drawings.push(layer)
        return 600
      }

      case "clear_drawings": {
        this._clearAllDrawings()
        return defaultDelay
      }

      // ── Person dossier ────────────────────────────────────────────────────

      case "show_person": {
        const map = this.mapRef?.current
        const L   = window.L
        if (!map || !L || !action.name) break
        const position = action.position || [0, 0]
        const tok = localStorage.getItem("hw-auth-token")
        const headers = tok ? { Authorization: `Bearer ${tok}` } : {}
        try {
          const resp = await fetch(
            `${API_BASE}/api/director/person/${encodeURIComponent(action.name)}`,
            { headers }
          )
          if (resp.ok) {
            const person = await resp.json()
            if (person.found) {
              const cardHtml = `<div style="
                display:flex;gap:10px;padding:10px 12px;
                background:rgba(8,14,28,0.93);
                backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
                border:1px solid rgba(255,255,255,0.14);border-radius:10px;
                max-width:270px;box-shadow:0 8px 32px rgba(0,0,0,0.55);
                animation:director-marker-arrive 600ms cubic-bezier(0.34,1.56,0.64,1) forwards;
              ">${person.image ? `<img src="${person.image}" alt="${person.name}" style="
                width:64px;height:64px;object-fit:cover;border-radius:6px;
                border:2px solid rgba(255,255,255,0.18);flex-shrink:0;" />` : ""}
              <div style="min-width:0;">
                <div style="font-size:13px;font-weight:700;color:white;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${person.name}</div>
                <div style="font-size:10px;color:rgba(0,170,255,0.9);margin-bottom:4px;">${action.role || person.description || ""}</div>
                <div style="font-size:10px;color:rgba(255,255,255,0.6);line-height:1.4;">${action.context || ""}</div>
              </div></div>`
              const marker = L.marker(position, {
                icon: L.divIcon({ className: "director-person-marker", html: cardHtml, iconSize: [270, 90], iconAnchor: [135, 100] }),
                interactive: false,
                pane: "tooltipPane",
              }).addTo(map)
              if (!this._personMarkers) this._personMarkers = {}
              this._personMarkers[action.name] = marker
              this._drawings.push({ layer: marker, animFrame: null })
            }
          }
        } catch (e) {
          console.warn("[Director] show_person failed:", e)
        }
        return 800
      }

      case "hide_person": {
        if (this._personMarkers && action.name) {
          const map = this.mapRef?.current
          const m = this._personMarkers[action.name]
          if (m && map) { try { map.removeLayer(m) } catch (_) {} }
          delete this._personMarkers[action.name]
        }
        return defaultDelay
      }

      // ── Pinned multi-images at a map location ─────────────────────────────

      case "pin_images": {
        const map = this.mapRef?.current
        const L   = window.L
        if (!map || !L || !action.location || !action.images?.length) break
        const [lat, lon] = action.location
        const tok = localStorage.getItem("hw-auth-token")
        const headers = tok ? { Authorization: `Bearer ${tok}` } : {}

        // Red dot at exact location
        const dot = L.circleMarker([lat, lon], {
          radius: 6, color: "#ff3030", fillColor: "#ff3030", fillOpacity: 1, weight: 2,
        }).addTo(map)
        this._drawings.push({ layer: dot, animFrame: null })

        // Label
        if (action.label) {
          const lm = L.marker([lat, lon], {
            icon: L.divIcon({
              className: "",
              html: `<div style="color:white;font-size:13px;font-weight:700;text-shadow:0 0 8px rgba(255,48,48,0.8),0 2px 4px rgba(0,0,0,0.9);white-space:nowrap;pointer-events:none;margin-top:10px;">${action.label}</div>`,
              iconSize: [0, 0], iconAnchor: [0, -14],
            }),
            interactive: false, pane: "tooltipPane",
          }).addTo(map)
          this._drawings.push({ layer: lm, animFrame: null })
        }

        // Fetch images in parallel
        const fetched = await Promise.all(
          (action.images || []).slice(0, 4).map(async (img) => {
            try {
              const r = await fetch(
                `${API_BASE}/api/director/image-search?q=${encodeURIComponent(img.query)}`,
                { headers }
              )
              if (r.ok) {
                const d = await r.json()
                return d.image_url ? { url: d.image_url, caption: img.caption, attribution: d.attribution } : null
              }
            } catch (_) {}
            return null
          })
        )
        const imgs = fetched.filter(Boolean)

        imgs.forEach((img, i) => {
          const angle     = (i / Math.max(imgs.length, 1)) * Math.PI * 2 - Math.PI / 2
          const offsetLat = lat + Math.cos(angle) * 0.07
          const offsetLon = lon + Math.sin(angle) * 0.11
          const cardHtml  = `<div style="position:relative;animation:director-marker-arrive 600ms cubic-bezier(0.34,1.56,0.64,1) forwards;animation-delay:${i * 180}ms;opacity:0;">
            <div style="width:170px;background:rgba(8,14,28,0.93);border:1px solid rgba(255,255,255,0.14);border-radius:8px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.6);">
              <img src="${img.url}" alt="" style="width:100%;height:96px;object-fit:cover;display:block;" onerror="this.style.display='none'" />
              ${action.timestamp ? `<div style="position:absolute;top:6px;right:6px;padding:2px 7px;background:rgba(220,30,30,0.9);color:white;font-size:9px;font-weight:700;border-radius:3px;letter-spacing:0.5px;">${action.timestamp}</div>` : ""}
              <div style="padding:5px 8px;">
                <div style="font-size:10px;color:rgba(255,255,255,0.8);line-height:1.3;">${img.caption}</div>
                ${img.attribution ? `<div style="font-size:8px;color:rgba(255,255,255,0.3);margin-top:1px;">© ${img.attribution}</div>` : ""}
              </div>
            </div></div>`
          const im = L.marker([offsetLat, offsetLon], {
            icon: L.divIcon({ className: "director-pinned-image", html: cardHtml, iconSize: [170, 130], iconAnchor: [85, 135] }),
            interactive: false, pane: "tooltipPane",
          }).addTo(map)
          this._drawings.push({ layer: im, animFrame: null })
        })
        return 800
      }

      // ── Detail panels ─────────────────────────────────────────────────────

      case "open_detail": {
        this.onDetailPanel({ type: action.type, id: action.id })
        this.onOpenDetail(action.type, action.id)
        if (this.setDirectorItems) {
          this.setDirectorItems(prev => ({
            ...prev,
            detailPanel: { type: action.type, id: action.id },
          }))
        }
        return 600  // let panel animate in before next action
      }

      case "close_detail": {
        this.onDetailPanel(null)
        this.onCloseDetail()
        if (this.setDirectorItems) {
          this.setDirectorItems(prev => ({ ...prev, detailPanel: null }))
        }
        return 400  // let panel animate out
      }

      // ── Satellite ─────────────────────────────────────────────────────────

      case "show_satellite": {
        if (this.setDirectorItems) {
          this.setDirectorItems(prev => ({ ...prev, satellite: true }))
        }
        // Also fly to location
        const map = this.mapRef?.current
        if (map && action.lat != null && action.lon != null) {
          const zoom     = action.zoom ?? 13
          const duration = 3000 / 1000
          map.flyTo([action.lat, action.lon], zoom, { animate: true, duration, easeLinearity: 0.1 })
        }
        return 3600
      }

      case "hide_satellite": {
        if (this.setDirectorItems) {
          this.setDirectorItems(prev => ({ ...prev, satellite: false }))
        }
        return defaultDelay
      }

      // ── Summary ───────────────────────────────────────────────────────────

      case "summary": {
        // Deliver any pending image then clear
        if (this._pendingImage) {
          this.onImage(this._pendingImage)
          this._pendingImage = null
        } else {
          this.onImage(null)
        }
        this.onNarrate(action)
        return 300
      }

      // ── Formation (multi-unit tactical animation) ────────────────────────

      case "formation": {
        const map = this.mapRef?.current
        const L   = window.L
        if (!map || !L) return defaultDelay
        const factionColors = { hostile: "#ff3030", allied: "#30ff80", neutral: "#ffffff", subject: "#3080ff" }
        const unitMarkers = []

        const getUnitSvg = (type, color) => {
          if (type === "aircraft") return `<svg width="24" height="24" viewBox="0 0 24 24"><path d="M12 2 L13 9 L22 12 L22 14 L13 13 L13 18 L16 20 L16 21 L12 20 L8 21 L8 20 L11 18 L11 13 L2 14 L2 12 L11 9 Z" fill="${color}"/></svg>`
          if (type === "ground") return `<svg width="24" height="24" viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="8" rx="1" fill="${color}" stroke="white" stroke-width="0.5"/><rect x="8" y="6" width="8" height="6" fill="${color}"/></svg>`
          return `<svg width="24" height="24" viewBox="0 0 24 24"><polygon points="12,4 18,16 15,15 12,18 9,15 6,16" fill="${color}" stroke="white" stroke-width="0.5"/></svg>`
        }

        action.units.forEach((unit) => {
          const color = factionColors[unit.faction] || "#ffffff"
          const icon = L.divIcon({
            className: "director-formation-unit",
            html: `<div style="position:relative;filter:drop-shadow(0 0 8px ${color})">
              ${getUnitSvg(unit.type, color)}
              <div style="position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:3px;
                padding:2px 6px;background:rgba(0,0,0,0.85);color:${color};font-size:9px;font-weight:700;
                white-space:nowrap;border-radius:3px;border:1px solid ${color}44;letter-spacing:0.05em;">
                ${unit.label || ""}
              </div>
            </div>`,
            iconSize:   [24, 24],
            iconAnchor: [12, 12],
          })
          const marker = L.marker([unit.lat, unit.lon], { icon, interactive: false, zIndexOffset: 800 }).addTo(map)
          unitMarkers.push({ marker, unit, startPos: [unit.lat, unit.lon] })
          this._drawings.push({ layer: marker, animFrame: null })
        })

        // Animate formation after brief entrance delay
        setTimeout(() => {
          const targetLL  = action.target
          const hostileCount = unitMarkers.filter(u => u.unit.faction !== "subject").length
          const finalPositions = unitMarkers.map((u, idx) => {
            if (u.unit.faction === "subject") return targetLL
            if (action.pattern === "surround") {
              const angle  = (idx / Math.max(hostileCount, 1)) * Math.PI * 2
              const radius = 0.045
              return [targetLL[0] + Math.cos(angle) * radius, targetLL[1] + Math.sin(angle) * radius]
            }
            if (action.pattern === "converge") return targetLL
            return [u.startPos[0] + (targetLL[0] - u.startPos[0]) * 0.7, u.startPos[1] + (targetLL[1] - u.startPos[1]) * 0.7]
          })

          const DURATION  = 4000
          const startTime = Date.now()
          let stopped     = false
          let rafId       = null
          const animate = () => {
            if (stopped) return
            const elapsed  = Date.now() - startTime
            const progress = Math.min(elapsed / DURATION, 1)
            const eased    = 1 - Math.pow(1 - progress, 3)
            unitMarkers.forEach((u, idx) => {
              const s = u.startPos, e = finalPositions[idx]
              try { u.marker.setLatLng([s[0] + (e[0] - s[0]) * eased, s[1] + (e[1] - s[1]) * eased]) } catch (_) {}
            })
            if (progress < 1) {
              rafId = requestAnimationFrame(animate)
            } else {
              stopped = true
            }
          }
          rafId = requestAnimationFrame(animate)
          // Store cancel fn on first unit's drawing entry
          const firstEntry = this._drawings.find(d => d.layer === unitMarkers[0]?.marker)
          if (firstEntry) firstEntry.animFrame = () => { stopped = true; if (rafId) cancelAnimationFrame(rafId) }
        }, 700)

        return 5000
      }

      // ── Animated unit movements ───────────────────────────────────────────

      case "animate_movement": {
        const map = this.mapRef?.current
        const L   = window.L
        if (!map || !L) return defaultDelay
        this._animateUnits(action)
        return (action.duration ?? 8000) + 1200
      }

      // ── Impact / explosion effect ──────────────────────────────────────────

      case "impact": {
        const map = this.mapRef?.current
        const L   = window.L
        if (!map || !L) return defaultDelay
        this._createImpact(action.lat, action.lon, action.color || "#ff5500", action.label)
        return 3500
      }

      // ── Animated line drawing ──────────────────────────────────────────────

      case "draw_animated_line": {
        const map = this.mapRef?.current
        const L   = window.L
        if (!map || !L) return defaultDelay
        this._drawAnimatedLine(action)
        return (action.duration ?? 3000) + 800
      }

      // ── Data callout card (DOM overlay) ───────────────────────────────────

      case "data_callout": {
        this._showDataCallout(action)
        return 800 + (action.duration ?? 5000)
      }

      // ── Pulse hotspot ──────────────────────────────────────────────────────

      case "pulse_hotspot": {
        const map = this.mapRef?.current
        const L   = window.L
        if (!map || !L || action.lat == null || action.lon == null) return defaultDelay
        const baseRadius = (action.radius_km || 20) * 1000
        const color      = action.color || "#56cfff"
        const ring = L.circle([action.lat, action.lon], {
          radius: baseRadius, color, fillColor: color,
          fillOpacity: 0.08, weight: 2, opacity: 0.6,
          className: "director-drawing-fill",
        }).addTo(map)
        let t = 0
        const interval = setInterval(() => {
          t += 0.06
          try {
            ring.setRadius(baseRadius * (1 + 0.22 * Math.sin(t)))
            ring.setStyle({
              opacity:     0.4 + 0.3 * Math.sin(t),
              fillOpacity: 0.04 + 0.07 * Math.sin(t),
            })
          } catch (_) {}
        }, 60)
        this._drawings.push({ layer: ring, animFrame: () => clearInterval(interval) })
        if (action.label) {
          const lm = L.marker([action.lat, action.lon], {
            icon: L.divIcon({
              className: "",
              html: `<div style="color:${color};font-size:11px;font-weight:700;text-shadow:0 0 8px ${color};white-space:nowrap;pointer-events:none;">${action.label}</div>`,
              iconSize: [0, 0], iconAnchor: [0, -20],
            }),
            interactive: false, pane: "tooltipPane",
          }).addTo(map)
          this._drawings.push({ layer: lm, animFrame: null })
        }
        return action.duration ?? 5000
      }

      // ── Recap overview ─────────────────────────────────────────────────────

      case "recap_overview": {
        this._executeRecapOverview(action)
        return (action.duration ?? 7000) + 2000
      }

      // ── Spotlight / vignette ──────────────────────────────────────────────

      case "spotlight": {
        this._createSpotlight(action)
        return action.duration ?? 5000
      }

      // ── Country info overlay ───────────────────────────────────────────────

      case "country_info_overlay": {
        this._showCountryInfoOverlay(action)
        return 800
      }

      // ── Animated chart ─────────────────────────────────────────────────────

      case "show_chart": {
        this._renderChart(action)
        return 800
      }

      // ── Legacy (backward-compat with saved sequences) ──────────────────

      case "toggle_layer": {
        const layer   = action.layer
        const enabled = Boolean(action.enabled)
        if (layer && this.setLayerOverrides) {
          this.setLayerOverrides(prev => ({ ...prev, [layer]: enabled }))
        }
        return defaultDelay
      }

      case "highlight_event": {
        const eventId = action.event_id
        const style   = action.style ?? "pulse"
        const item    = this.surfaceItems.find(
          s => s.id === eventId || s.url === eventId
        )
        if (item?.lat != null && item?.lon != null) {
          this.setHighlights(prev => {
            const filtered = prev.filter(h => h.id !== eventId)
            return [...filtered, { id: eventId, lat: item.lat, lon: item.lon, style }]
          })
        }
        return defaultDelay
      }

      case "clear_highlights": {
        this.setHighlights([])
        return defaultDelay
      }

      default:
        return defaultDelay
    }
  }

  // ── Async narrate/summary (waits for TTS before advancing) ───────────────

  async _handleNarrateAsync(action) {
    if (action.action === "narrate") {
      const act2 = { ...action }
      // Prepend any pending satellite observations
      if (this._pendingSatObservations) {
        act2.text = `[Satellite Analysis] ${this._pendingSatObservations}\n\n${action.text || ""}`
        this._pendingSatObservations = null
      }
      // Deliver pending image
      if (this._pendingImage) {
        this.onImage(this._pendingImage)
        this._pendingImage = null
      } else {
        this.onImage(null)
      }
      this.onNarrate(act2)
      // Speak narration text — awaits completion before advancing
      await ttsService.speak(act2.text || "")
    } else {
      // summary
      if (this._pendingImage) {
        this.onImage(this._pendingImage)
        this._pendingImage = null
      } else {
        this.onImage(null)
      }
      this.onNarrate(action)
      // Speak summary sequentially
      if (!this._aborted) await ttsService.speak(action.title || "")
      for (const section of action.sections || []) {
        if (this._aborted) break
        await ttsService.speak(section.text || "")
      }
      if (!this._aborted && (action.predictions || []).length > 0) {
        await ttsService.speak("Predictions.")
        for (const pred of action.predictions) {
          if (this._aborted) break
          await ttsService.speak(`${pred.confidence} confidence: ${pred.prediction}`)
        }
      }
    }

    // Advance only if still auto-playing and not aborted
    if (this.isPlaying && !this._aborted) {
      this._timer = setTimeout(() => this._advance(), 300)
    }
  }

  // ── Async satellite analysis ───────────────────────────────────────────────

  async _handleAnalyseSatelliteAsync(action) {
    try {
      const res = await fetch(`${API_BASE}/api/director/analyse-satellite`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", ..._authHeaders() },
        body:    JSON.stringify({
          lat:       action.lat,
          lon:       action.lon,
          radius_km: action.radius_km || 5,
          label:     action.label || "",
        }),
      })
      if (res.ok) {
        const data = await res.json()
        // Store observations to be prepended to the next narrate action
        this._pendingSatObservations = data.observations || ""
      }
    } catch (err) {
      console.warn("[Director] satellite analysis failed:", err)
    }
    // Continue playback regardless of success/failure
    if (this.isPlaying) {
      this._timer = setTimeout(() => this._advance(), 1000)
    }
  }

  // ── Drawing helpers ───────────────────────────────────────────────────────

  _clearAllDrawings() {
    const map = this.mapRef?.current
    for (const entry of this._drawings) {
      try {
        if (entry && typeof entry === "object") {
          // DOM overlay (data_callout)
          if ("domEl" in entry) {
            if (typeof entry.animFrame === "function") entry.animFrame()
            try { document.body.removeChild(entry.domEl) } catch (_) {}
            continue
          }
          // Animated marker { layer, animFrame }
          if ("animFrame" in entry) {
            if (typeof entry.animFrame === "function") entry.animFrame()
            if (map && entry.layer) map.removeLayer(entry.layer)
          } else {
            if (map && entry) map.removeLayer(entry)
          }
        } else {
          if (map && entry) map.removeLayer(entry)
        }
      } catch (_) {}
    }
    this._drawings = []
    // Also clear person markers on full clear
    if (this._personMarkers) {
      Object.values(this._personMarkers).forEach(m => {
        try { if (map) map.removeLayer(m) } catch (_) {}
      })
      this._personMarkers = {}
    }
  }

  // ── Impact explosion animation ────────────────────────────────────────────

  _createImpactAnimation(lat, lon, color) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return
    // 3 expanding rings
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        try {
          const ring = L.circle([lat, lon], {
            radius: 500, color, fillColor: color, fillOpacity: 0.35, weight: 2, opacity: 1,
          }).addTo(map)
          let radius = 500, opacity = 1
          const expand = setInterval(() => {
            radius  += 6000
            opacity -= 0.05
            try { ring.setRadius(radius); ring.setStyle({ opacity: Math.max(opacity, 0), fillOpacity: Math.max(opacity * 0.25, 0) }) } catch (_) {}
            if (opacity <= 0) { clearInterval(expand); try { map.removeLayer(ring) } catch (_) {} }
          }, 30)
        } catch (_) {}
      }, i * 200)
    }
    // Center flash
    try {
      const flash = L.circle([lat, lon], { radius: 4000, color: "white", fillColor: color, fillOpacity: 0.9, weight: 0 }).addTo(map)
      let flashOp = 0.9
      const flashFade = setInterval(() => {
        flashOp -= 0.07
        try { flash.setStyle({ fillOpacity: Math.max(flashOp, 0) }) } catch (_) {}
        if (flashOp <= 0) { clearInterval(flashFade); try { map.removeLayer(flash) } catch (_) {} }
      }, 40)
    } catch (_) {}
  }

  // ── Curved bezier arrow ────────────────────────────────────────────────────

  _drawCurvedArrow(action) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return
    const from  = action.from
    const to    = action.to
    const color = action.color || "#ef4444"
    const isStrike = /strike|missile|attack|launch|trajectory|vector|rocket|bomb/i.test(action.label || "")

    // Quadratic bezier control point — offset perpendicular to mid
    const midLat   = (from[0] + to[0]) / 2
    const midLon   = (from[1] + to[1]) / 2
    const dx       = to[1] - from[1]
    const dy       = to[0] - from[0]
    const dist     = Math.sqrt(dx * dx + dy * dy) || 1
    const offset   = dist * 0.25
    const ctrlLat  = midLat + (-dx / dist) * offset
    const ctrlLon  = midLon + (dy  / dist) * offset

    // Sample bezier
    const steps      = 40
    const curvePoints = []
    for (let i = 0; i <= steps; i++) {
      const t   = i / steps
      const lat = (1 - t) * (1 - t) * from[0] + 2 * (1 - t) * t * ctrlLat + t * t * to[0]
      const lon = (1 - t) * (1 - t) * from[1] + 2 * (1 - t) * t * ctrlLon + t * t * to[1]
      curvePoints.push([lat, lon])
    }

    const drawDur  = isStrike ? 1600 : 2000
    const startTs  = Date.now()
    let stopped    = false
    let rafId      = null

    const mainLine = L.polyline([], { color, weight: isStrike ? 2 : 3, opacity: 0.9,
      dashArray: isStrike ? "8 6" : null, className: "director-drawing-line" }).addTo(map)
    const glowLine = L.polyline([], { color, weight: 9, opacity: 0.12 }).addTo(map)

    const dotIcon = L.divIcon({
      className: "",
      html: `<div style="width:10px;height:10px;border-radius:50%;background:${color};box-shadow:0 0 10px ${color};"></div>`,
      iconSize: [10, 10], iconAnchor: [5, 5],
    })
    const leadDot = L.marker(curvePoints[0], { icon: dotIcon, interactive: false, zIndexOffset: 900 }).addTo(map)

    const mainEntry = { layer: mainLine, animFrame: null }
    this._drawings.push(mainEntry, { layer: glowLine, animFrame: null }, { layer: leadDot, animFrame: null })

    const grow = () => {
      if (stopped) return
      const p       = Math.min((Date.now() - startTs) / drawDur, 1)
      const eased   = 1 - Math.pow(1 - p, 3)
      const idx     = Math.floor(eased * (curvePoints.length - 1))
      const visible = curvePoints.slice(0, idx + 1)
      try { mainLine.setLatLngs(visible); glowLine.setLatLngs(visible) } catch (_) {}
      if (idx < curvePoints.length - 1) {
        try { leadDot.setLatLng(curvePoints[idx]) } catch (_) {}
      }
      if (p < 1) {
        rafId = requestAnimationFrame(grow)
        mainEntry.animFrame = () => { stopped = true; if (rafId) cancelAnimationFrame(rafId) }
      } else {
        stopped = true
        // Arrowhead
        try {
          const last    = curvePoints.length - 1
          const bearing = this._calculateBearing(
            curvePoints[last - 1][0], curvePoints[last - 1][1],
            curvePoints[last][0],     curvePoints[last][1]
          )
          const arrowHead = L.marker(to, {
            icon: L.divIcon({
              className: "",
              html: `<svg width="20" height="20" viewBox="0 0 20 20" style="transform:rotate(${bearing}deg)"><polygon points="10,0 20,16 10,12 0,16" fill="${color}" stroke="white" stroke-width="0.5"/></svg>`,
              iconSize: [20, 20], iconAnchor: [10, 10],
            }),
            interactive: false,
          }).addTo(map)
          this._drawings.push({ layer: arrowHead, animFrame: null })
        } catch (_) {}
        // Remove lead dot
        setTimeout(() => { try { map.removeLayer(leadDot) } catch (_) {} }, 300)
        // Label at midpoint
        if (action.label) {
          try {
            const mid = curvePoints[Math.floor(curvePoints.length / 2)]
            const lbl = L.marker(mid, {
              icon: L.divIcon({
                className: "",
                html: `<div style="color:${color};font-size:11px;font-weight:600;background:rgba(0,0,0,0.7);padding:3px 8px;border-radius:4px;border:1px solid ${color}40;white-space:nowrap;">${action.label}</div>`,
                iconSize: [0, 0], iconAnchor: [0, 0],
              }), interactive: false,
            }).addTo(map)
            this._drawings.push({ layer: lbl, animFrame: null })
          } catch (_) {}
        }
        // Strike projectile after curve
        if (isStrike) {
          this._createImpact(to[0], to[1], color, null)
        }
      }
    }
    rafId = requestAnimationFrame(grow)
    mainEntry.animFrame = () => { stopped = true; if (rafId) cancelAnimationFrame(rafId) }
  }

  // ── Spotlight / vignette ──────────────────────────────────────────────────

  _createSpotlight(action) {
    const map = this.mapRef?.current
    if (!map) return
    const radius   = action.radius_px || 200
    const duration = action.duration  || 5000

    const overlay = document.createElement("div")
    overlay.style.cssText = "position:fixed;inset:0;z-index:500;pointer-events:none;opacity:0;transition:opacity 600ms ease-in;"

    const update = () => {
      if (!map) return
      try {
        const pt = map.latLngToContainerPoint([action.lat, action.lon])
        overlay.style.background = `radial-gradient(circle ${radius}px at ${pt.x}px ${pt.y}px,transparent 0%,transparent 70%,rgba(0,0,0,0.72) 100%)`
      } catch (_) {}
    }
    update()
    document.body.appendChild(overlay)
    requestAnimationFrame(() => { overlay.style.opacity = "1" })
    map.on("move", update)

    this._drawings.push({ domEl: overlay, animFrame: () => { map.off("move", update) } })

    setTimeout(() => {
      overlay.style.opacity = "0"
      map.off("move", update)
      setTimeout(() => { try { document.body.removeChild(overlay) } catch (_) {} }, 620)
    }, duration)
  }

  // ── Country info overlay ──────────────────────────────────────────────────

  _showCountryInfoOverlay(action) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return
    const position = action.position || [0, 0]

    const html = `<div style="text-align:center;pointer-events:none;animation:director-marker-arrive 800ms ease-out forwards;">
      <div style="font-size:11px;letter-spacing:3px;color:rgba(255,255,255,0.55);text-transform:uppercase;margin-bottom:6px;text-shadow:0 2px 8px rgba(0,0,0,0.9);">${action.headline || ""}</div>
      <div style="font-size:28px;font-weight:900;color:white;letter-spacing:2px;text-shadow:0 0 20px rgba(255,170,0,0.4),0 2px 8px rgba(0,0,0,0.9);margin-bottom:4px;">${(action.name || "").toUpperCase()}</div>
      <div style="font-size:32px;font-weight:900;color:white;text-shadow:0 0 30px rgba(0,170,255,0.3),0 2px 8px rgba(0,0,0,0.9);margin-bottom:2px;">${action.stat_value || ""}</div>
      <div style="font-size:12px;letter-spacing:4px;color:rgba(255,255,255,0.45);text-transform:uppercase;text-shadow:0 2px 8px rgba(0,0,0,0.9);">${action.stat_label || ""}</div>
    </div>`

    const marker = L.marker(position, {
      icon: L.divIcon({ className: "director-country-info-overlay", html, iconSize: [300, 120], iconAnchor: [150, 60] }),
      interactive: false, pane: "tooltipPane",
    }).addTo(map)
    this._drawings.push({ layer: marker, animFrame: null })
  }

  // ── Chart overlay ─────────────────────────────────────────────────────────

  _renderChart(action) {
    const data = action.data || []
    if (data.length === 0) return

    const W = 320, H = 180
    const pad = { top: 30, right: 20, bottom: 35, left: 45 }
    const cW  = W - pad.left - pad.right
    const cH  = H - pad.top - pad.bottom

    const vals   = data.map(d => d.value)
    const minVal = Math.min(...vals) * 0.95
    const maxVal = Math.max(...vals) * 1.05
    const range  = maxVal - minVal || 1

    const points = data.map((d, i) => ({
      x: pad.left + (i / Math.max(data.length - 1, 1)) * cW,
      y: pad.top + cH - ((d.value - minVal) / range) * cH,
      label: d.label, value: d.value,
    }))

    const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")

    const gridLines = []
    for (let i = 0; i <= 4; i++) {
      gridLines.push({ y: pad.top + (i / 4) * cH, val: Math.round(maxVal - (i / 4) * range) })
    }

    let eventSvg = ""
    const em = action.event_marker
    if (em && em.index < points.length) {
      const ep = points[em.index]
      eventSvg = `<rect x="${ep.x - 1}" y="${pad.top}" width="2" height="${cH}" fill="rgba(255,170,0,0.6)"/>
        <text x="${ep.x}" y="${pad.top - 4}" fill="white" font-size="8" text-anchor="middle" font-weight="700">${em.label}</text>
        <circle cx="${ep.x}" cy="${ep.y}" r="4" fill="#ffaa00" stroke="white" stroke-width="1"/>`
    }

    const color    = action.color || "#ff4444"
    const pathLen  = 1200
    const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" rx="8" fill="rgba(10,15,25,0.92)" stroke="rgba(86,207,255,0.2)" stroke-width="0.5"/>
      <text x="${pad.left}" y="18" fill="rgba(255,255,255,0.7)" font-size="10" font-weight="700" letter-spacing="1">${action.title || ""}</text>
      ${gridLines.map(g => `<line x1="${pad.left}" y1="${g.y.toFixed(1)}" x2="${W - pad.right}" y2="${g.y.toFixed(1)}" stroke="rgba(255,255,255,0.07)" stroke-width="0.5"/>
        <text x="${pad.left - 4}" y="${(g.y + 3).toFixed(1)}" fill="rgba(255,255,255,0.35)" font-size="8" text-anchor="end">${g.val}</text>`).join("")}
      ${eventSvg}
      <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
        stroke-dasharray="${pathLen}" stroke-dashoffset="${pathLen}">
        <animate attributeName="stroke-dashoffset" from="${pathLen}" to="0" dur="2s" fill="freeze"/>
      </path>
      ${data.filter((_, i) => i === 0 || i === data.length - 1 || i % Math.max(Math.ceil(data.length / 6), 1) === 0)
        .map(d => { const idx = data.indexOf(d); return `<text x="${points[idx].x.toFixed(1)}" y="${H - 8}" fill="rgba(255,255,255,0.35)" font-size="7" text-anchor="middle">${d.label}</text>` })
        .join("")}
    </svg>`

    // Fire onChart callback if available (for sidebar display)
    if (typeof this.onChart === "function") {
      this.onChart({ svg, title: action.title, duration: action.duration || 8000 })
      return
    }

    // Fallback: DOM overlay bottom-right
    const el = document.createElement("div")
    el.style.cssText = "position:fixed;bottom:100px;right:24px;z-index:800;border:1px solid rgba(255,255,255,0.12);border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.5);animation:director-marker-arrive 500ms ease-out forwards;"
    el.innerHTML = svg
    document.body.appendChild(el)
    this._drawings.push({ domEl: el, animFrame: null })
    const dur = action.duration || 8000
    setTimeout(() => {
      el.style.transition = "opacity 500ms"
      el.style.opacity = "0"
      setTimeout(() => { try { document.body.removeChild(el) } catch (_) {} }, 520)
    }, dur)
  }

  // ── Animated unit movement ────────────────────────────────────────────────

  _getUnitIcon(type, color) {
    const svgs = {
      warship:    `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M12 3L14 8H22L20 14H4L2 8H10Z" fill="${color}" stroke="white" stroke-width="0.5"/><rect x="10" y="14" width="4" height="4" fill="${color}"/></svg>`,
      carrier:    `<svg width="26" height="22" viewBox="0 0 28 22"><rect x="2" y="10" width="24" height="8" rx="1" fill="${color}" stroke="white" stroke-width="0.5"/><rect x="8" y="5" width="12" height="6" fill="${color}"/><rect x="12" y="2" width="2" height="4" fill="white"/></svg>`,
      submarine:  `<svg width="26" height="16" viewBox="0 0 28 16"><ellipse cx="14" cy="10" rx="12" ry="5" fill="${color}" stroke="white" stroke-width="0.5"/><rect x="10" y="3" width="4" height="7" rx="1" fill="${color}"/></svg>`,
      patrol:     `<svg width="20" height="18" viewBox="0 0 20 18"><path d="M10 2L13 7H20L18 13H2L0 7H7Z" fill="${color}" stroke="white" stroke-width="0.5"/></svg>`,
      tanker_ship:`<svg width="28" height="18" viewBox="0 0 28 18"><rect x="1" y="8" width="26" height="8" rx="2" fill="${color}" stroke="white" stroke-width="0.5"/><rect x="4" y="4" width="16" height="5" fill="${color}"/><circle cx="6" cy="6" r="2" fill="${color}88" stroke="white" stroke-width="0.5"/><circle cx="12" cy="6" r="2" fill="${color}88" stroke="white" stroke-width="0.5"/><circle cx="18" cy="6" r="2" fill="${color}88" stroke="white" stroke-width="0.5"/></svg>`,
      cargo_ship: `<svg width="28" height="18" viewBox="0 0 28 18"><rect x="1" y="9" width="26" height="7" rx="2" fill="${color}" stroke="white" stroke-width="0.5"/><rect x="4" y="5" width="8" height="5" fill="${color}"/><rect x="14" y="5" width="8" height="5" fill="${color}"/></svg>`,
      fighter:    `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M12 2L14 9L22 12L22 14L14 12L14 18L17 20L17 21L12 19L7 21L7 20L10 18L10 12L2 14L2 12L10 9Z" fill="${color}" stroke="white" stroke-width="0.4"/></svg>`,
      bomber:     `<svg width="26" height="22" viewBox="0 0 28 22"><path d="M14 2L16 10L28 14L28 16L16 13L16 18L20 21L20 22L14 20L8 22L8 21L12 18L12 13L0 16L0 14L12 10Z" fill="${color}" stroke="white" stroke-width="0.4"/></svg>`,
      helicopter: `<svg width="24" height="22" viewBox="0 0 24 22"><rect x="4" y="10" width="16" height="5" rx="2" fill="${color}" stroke="white" stroke-width="0.5"/><rect x="0" y="9" width="24" height="2" rx="1" fill="${color}"/><line x1="12" y1="15" x2="18" y2="20" stroke="${color}" stroke-width="1.5"/><line x1="12" y1="15" x2="6" y2="20" stroke="${color}" stroke-width="1.5"/></svg>`,
      drone:      `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M12 8L14 12L20 14L14 16L12 20L10 16L4 14L10 12Z" fill="${color}" stroke="white" stroke-width="0.5"/><circle cx="4" cy="4" r="3" fill="${color}88"/><circle cx="20" cy="4" r="3" fill="${color}88"/><line x1="4" y1="4" x2="10" y2="12" stroke="${color}" stroke-width="1"/><line x1="20" y1="4" x2="14" y2="12" stroke="${color}" stroke-width="1"/></svg>`,
      tank:       `<svg width="24" height="20" viewBox="0 0 24 20"><rect x="2" y="10" width="20" height="7" rx="1" fill="${color}" stroke="white" stroke-width="0.5"/><rect x="5" y="6" width="14" height="6" rx="1" fill="${color}"/><rect x="11" y="2" width="2" height="8" fill="${color}" stroke="white" stroke-width="0.4"/></svg>`,
      apc:        `<svg width="24" height="18" viewBox="0 0 24 18"><rect x="2" y="7" width="20" height="9" rx="2" fill="${color}" stroke="white" stroke-width="0.5"/><rect x="5" y="4" width="10" height="5" rx="1" fill="${color}"/></svg>`,
      troops:     `<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="5" r="3" fill="${color}" stroke="white" stroke-width="0.5"/><path d="M6 9 Q10 8 14 9 L15 18 H5 Z" fill="${color}" stroke="white" stroke-width="0.5"/></svg>`,
    }
    return svgs[type] || svgs.troops
  }

  // ── Bearing calculation ───────────────────────────────────────────────────

  _calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180)
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180)
            - Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon)
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
  }

  _animateAlongPath(marker, path, duration, map, onComplete) {
    const L = window.L
    if (!L || path.length < 2) return
    // Compute great-circle cumulative distances
    const latLngs = path.map(p => L.latLng(p[0], p[1]))
    const dists   = [0]
    for (let i = 1; i < latLngs.length; i++) {
      dists.push(dists[i - 1] + latLngs[i - 1].distanceTo(latLngs[i]))
    }
    const totalDist = dists[dists.length - 1] || 1
    const startTime = Date.now()
    let stopped   = false
    let rafId     = null
    const trail   = []
    let lastSeg   = 0

    const animate = () => {
      if (stopped) return
      const elapsed  = Math.min(Date.now() - startTime, duration)
      const p        = elapsed / duration
      const eased    = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
      const target   = eased * totalDist
      let seg = lastSeg
      for (let i = seg; i < dists.length - 1; i++) {
        if (dists[i + 1] >= target) { seg = i; break }
        seg = i
      }
      lastSeg = seg
      const segLen  = dists[seg + 1] - dists[seg]
      const segProg = segLen > 0 ? (target - dists[seg]) / segLen : 0
      const from    = latLngs[seg]
      const to      = latLngs[Math.min(seg + 1, latLngs.length - 1)]
      const lat     = from.lat + (to.lat - from.lat) * segProg
      const lon     = from.lng + (to.lng - from.lng) * segProg
      try { marker.setLatLng([lat, lon]) } catch (_) {}

      // Rotate icon to face direction of travel
      if (seg < latLngs.length - 1) {
        try {
          const bearing = this._calculateBearing(from.lat, from.lng, to.lat, to.lng)
          const el = marker.getElement?.()
          if (el) {
            const svgEl = el.querySelector("svg") || el.firstElementChild?.firstElementChild
            if (svgEl) {
              svgEl.style.transform = `rotate(${bearing}deg)`
              svgEl.style.transition = "transform 300ms ease"
            }
          }
        } catch (_) {}
      }

      // Sparse trail dots
      if (Math.random() < 0.18) {
        try {
          const td = L.circleMarker([lat, lon], {
            radius: 2.5, color: "#fff", fillColor: "#fff", fillOpacity: 0.45, weight: 0,
          }).addTo(map)
          trail.push(td)
          this._drawings.push({ layer: td, animFrame: null })
          if (trail.length > 12) {
            const old = trail.shift()
            try { map.removeLayer(old) } catch (_) {}
          }
        } catch (_) {}
      }

      if (elapsed < duration) {
        rafId = requestAnimationFrame(animate)
      } else {
        stopped = true
        try { map.removeLayer(marker) } catch (_) {}
        trail.forEach(t => { try { map.removeLayer(t) } catch (_) {} })
        if (onComplete) onComplete()
      }
    }
    rafId = requestAnimationFrame(animate)
    return () => { stopped = true; if (rafId) cancelAnimationFrame(rafId) }
  }

  _animateUnits(action) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return
    const duration = (action.duration ?? 8000)
    const factionColors = { hostile: "#ff3030", allied: "#56cfff", friendly: "#30ff80", neutral: "#ffffff" }
    const units = Array.isArray(action.units) ? action.units : []

    units.forEach((unit, idx) => {
      if (!unit.from || !unit.to) return
      const color     = factionColors[unit.faction] || "#ffffff"
      const unitType  = unit.type || "troops"
      const svg       = this._getUnitIcon(unitType, color)
      const iconW     = 24, iconH = 24

      const icon = L.divIcon({
        className: "",
        html: `<div style="filter:drop-shadow(0 0 6px ${color});position:relative;">
          ${svg}
          ${unit.label ? `<div style="position:absolute;top:100%;left:50%;transform:translateX(-50%);white-space:nowrap;color:${color};font-size:9px;font-weight:700;text-shadow:0 1px 4px #000;margin-top:2px;">${unit.label}</div>` : ""}
        </div>`,
        iconSize:   [iconW, iconH],
        iconAnchor: [iconW / 2, iconH / 2],
      })
      const marker = L.marker(unit.from, { icon, interactive: false, zIndexOffset: 850 }).addTo(map)
      const entry  = { layer: marker, animFrame: null }
      this._drawings.push(entry)

      const path     = Array.isArray(unit.waypoints) ? [unit.from, ...unit.waypoints, unit.to] : [unit.from, unit.to]
      const delay    = idx * 250

      setTimeout(() => {
        const cancel = this._animateAlongPath(marker, path, duration - delay, map, null)
        entry.animFrame = cancel
      }, delay)
    })
  }

  // ── Impact / explosion ────────────────────────────────────────────────────

  _createImpact(lat, lon, color, label) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return

    // Flash
    try {
      const flash = L.circle([lat, lon], { radius: 3000, color: "white", fillColor: color, fillOpacity: 0.95, weight: 0 }).addTo(map)
      let fo = 0.95
      const fi = setInterval(() => {
        fo -= 0.09
        try { flash.setStyle({ fillOpacity: Math.max(fo, 0) }) } catch (_) {}
        if (fo <= 0) { clearInterval(fi); try { map.removeLayer(flash) } catch (_) {} }
      }, 35)
    } catch (_) {}

    // 3 expanding rings
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        try {
          const ring = L.circle([lat, lon], {
            radius: 500 + i * 400, color, fillColor: color, fillOpacity: 0.25, weight: 2, opacity: 1,
          }).addTo(map)
          let r = 500 + i * 400, op = 1
          const ri = setInterval(() => {
            r  += 7000
            op -= 0.045
            try {
              ring.setRadius(r)
              ring.setStyle({ opacity: Math.max(op, 0), fillOpacity: Math.max(op * 0.2, 0) })
            } catch (_) {}
            if (op <= 0) { clearInterval(ri); try { map.removeLayer(ring) } catch (_) {} }
          }, 35)
        } catch (_) {}
      }, i * 220)
    }

    // 8 debris particles
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      const speed = 0.018 + Math.random() * 0.012
      try {
        const pLat = lat + Math.cos(angle) * 0.004
        const pLon = lon + Math.sin(angle) * 0.006
        const p = L.circleMarker([pLat, pLon], {
          radius: 3, color, fillColor: color, fillOpacity: 0.9, weight: 0,
        }).addTo(map)
        let po = 0.9, dist = 0
        const pi2 = setInterval(() => {
          dist += speed
          po   -= 0.04
          try {
            p.setLatLng([lat + Math.cos(angle) * dist, lon + Math.sin(angle) * dist * 1.5])
            p.setStyle({ fillOpacity: Math.max(po, 0) })
          } catch (_) {}
          if (po <= 0) { clearInterval(pi2); try { map.removeLayer(p) } catch (_) {} }
        }, 50)
      } catch (_) {}
    }

    // Label
    if (label) {
      try {
        const lm = L.marker([lat, lon], {
          icon: L.divIcon({
            className: "",
            html: `<div style="color:${color};font-size:11px;font-weight:700;text-shadow:0 0 8px ${color},0 2px 4px #000;white-space:nowrap;pointer-events:none;margin-top:8px;">${label}</div>`,
            iconSize: [0, 0], iconAnchor: [0, -16],
          }),
          interactive: false, pane: "tooltipPane",
        }).addTo(map)
        this._drawings.push({ layer: lm, animFrame: null })
        setTimeout(() => { try { map.removeLayer(lm) } catch (_) {} }, 5000)
      } catch (_) {}
    }
  }

  // ── Animated line drawing ─────────────────────────────────────────────────

  _drawAnimatedLine(action) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return
    const pts    = (action.points || []).map(p => [p[0], p[1]])
    if (pts.length < 2) return
    const color    = action.color || "#56cfff"
    const duration = action.duration ?? 3000
    const dashed   = action.dashed !== false

    // Build cumulative segment lengths for interpolation
    const segLens  = []
    let totalLen   = 0
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][1] - pts[i-1][1]
      const dy = pts[i][0] - pts[i-1][0]
      const d  = Math.sqrt(dx*dx + dy*dy)
      segLens.push(d)
      totalLen += d
    }
    const cumLens = [0]
    segLens.forEach((l) => cumLens.push(cumLens[cumLens.length-1] + l))

    const line = L.polyline([], {
      color, weight: 2.5, opacity: 0.9,
      dashArray: dashed ? "8 4" : null,
      className: "director-drawing-line",
    }).addTo(map)

    const dotIcon = L.divIcon({
      className: "",
      html: `<div style="width:10px;height:10px;border-radius:50%;background:${color};box-shadow:0 0 10px ${color},0 0 20px ${color}88;"></div>`,
      iconSize: [10, 10], iconAnchor: [5, 5],
    })
    const dot = L.marker(pts[0], { icon: dotIcon, interactive: false, zIndexOffset: 900 }).addTo(map)

    const entry = { layer: line, animFrame: null }
    const dotEntry = { layer: dot, animFrame: null }
    this._drawings.push(entry, dotEntry)

    const startTime = Date.now()
    let stopped = false
    let rafId   = null

    const animate = () => {
      if (stopped) return
      const elapsed  = Math.min(Date.now() - startTime, duration)
      const progress = elapsed / duration
      const target   = progress * totalLen
      // Build polyline points up to target distance
      const visPoints = [pts[0]]
      let accumulated = 0
      for (let i = 0; i < segLens.length; i++) {
        const rem = target - accumulated
        if (rem <= 0) break
        if (rem >= segLens[i]) {
          visPoints.push(pts[i + 1])
          accumulated += segLens[i]
        } else {
          const frac = rem / segLens[i]
          const interpLat = pts[i][0] + (pts[i+1][0] - pts[i][0]) * frac
          const interpLon = pts[i][1] + (pts[i+1][1] - pts[i][1]) * frac
          visPoints.push([interpLat, interpLon])
          try { dot.setLatLng([interpLat, interpLon]) } catch (_) {}
          break
        }
      }
      if (visPoints.length >= 2) {
        try { line.setLatLngs(visPoints) } catch (_) {}
      }
      if (elapsed < duration) {
        rafId = requestAnimationFrame(animate)
        entry.animFrame = () => { stopped = true; if (rafId) cancelAnimationFrame(rafId) }
      } else {
        stopped = true
        try { dot.setLatLng(pts[pts.length - 1]) } catch (_) {}
        if (action.label) {
          try { line.bindTooltip(action.label, { permanent: false, sticky: true }) } catch (_) {}
        }
      }
    }
    rafId = requestAnimationFrame(animate)
    entry.animFrame = () => { stopped = true; if (rafId) cancelAnimationFrame(rafId) }
  }

  // ── Data callout card (DOM overlay) ───────────────────────────────────────

  _showDataCallout(action) {
    // Inject CSS once
    if (!document.getElementById("director-callout-css")) {
      const style = document.createElement("style")
      style.id = "director-callout-css"
      style.textContent = `
        .director-data-callout {
          position: fixed;
          z-index: 9000;
          pointer-events: none;
          font-family: 'Inter', 'SF Pro Display', sans-serif;
          animation: dirCalloutIn 400ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        @keyframes dirCalloutIn {
          from { opacity: 0; transform: translateY(-12px) scale(0.94); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .director-data-callout-inner {
          background: rgba(6, 12, 26, 0.95);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(86, 207, 255, 0.3);
          border-radius: 10px;
          padding: 14px 18px;
          min-width: 180px;
          max-width: 280px;
          box-shadow: 0 8px 40px rgba(0,0,0,0.7), 0 0 20px rgba(86,207,255,0.1);
        }
        .director-data-callout-label {
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 2px;
          color: rgba(86,207,255,0.7);
          margin-bottom: 4px;
        }
        .director-data-callout-value {
          font-size: 28px;
          font-weight: 800;
          color: white;
          line-height: 1.1;
        }
        .director-data-callout-unit {
          font-size: 13px;
          color: rgba(255,255,255,0.5);
          margin-left: 3px;
        }
        .director-data-callout-sub {
          font-size: 11px;
          color: rgba(255,255,255,0.55);
          margin-top: 5px;
          line-height: 1.4;
        }
      `
      document.head.appendChild(style)
    }

    const el = document.createElement("div")
    el.className = "director-data-callout"
    const pos = action.screen_position || "top-right"
    const posStyles = {
      "top-right":    "top:80px;right:24px;",
      "top-left":     "top:80px;left:24px;",
      "bottom-right": "bottom:80px;right:24px;",
      "bottom-left":  "bottom:80px;left:24px;",
      "center":       "top:50%;left:50%;transform:translate(-50%,-50%);",
    }
    el.style.cssText = posStyles[pos] || posStyles["top-right"]

    const accentColor = action.color || "#56cfff"
    el.innerHTML = `<div class="director-data-callout-inner" style="border-color:${accentColor}44">
      ${action.label ? `<div class="director-data-callout-label">${action.label}</div>` : ""}
      <div style="display:flex;align-items:baseline;gap:4px;">
        <span class="director-data-callout-value" style="color:${accentColor}">${action.value ?? ""}</span>
        ${action.unit ? `<span class="director-data-callout-unit">${action.unit}</span>` : ""}
      </div>
      ${action.subtitle ? `<div class="director-data-callout-sub">${action.subtitle}</div>` : ""}
    </div>`

    document.body.appendChild(el)
    this._drawings.push({ domEl: el, animFrame: null })

    // Auto-remove after duration
    const dur = action.duration ?? 5000
    setTimeout(() => {
      el.style.transition = "opacity 400ms ease, transform 400ms ease"
      el.style.opacity = "0"
      el.style.transform += " translateY(-8px)"
      setTimeout(() => {
        try { document.body.removeChild(el) } catch (_) {}
      }, 420)
    }, dur)
  }

  // ── Recap overview ────────────────────────────────────────────────────────

  _executeRecapOverview(action) {
    const map = this.mapRef?.current
    const L   = window.L
    if (!map || !L) return
    const keyPoints = Array.isArray(action.key_points) ? action.key_points : []
    const color     = action.color || "#56cfff"

    // Fly to bounds encompassing all key points
    if (keyPoints.length >= 2) {
      try {
        const lats = keyPoints.map(p => p.lat)
        const lons = keyPoints.map(p => p.lon)
        const bounds = L.latLngBounds(
          [Math.min(...lats) - 2, Math.min(...lons) - 2],
          [Math.max(...lats) + 2, Math.max(...lons) + 2]
        )
        map.flyToBounds(bounds, { animate: true, duration: 3, padding: [60, 60] })
      } catch (_) {}
    }

    // Staggered dot + label markers for each key point
    keyPoints.forEach((pt, i) => {
      setTimeout(() => {
        if (!pt.lat || !pt.lon) return
        try {
          const dot = L.circleMarker([pt.lat, pt.lon], {
            radius: 7, color, fillColor: color, fillOpacity: 0.85, weight: 2,
          }).addTo(map)
          this._drawings.push({ layer: dot, animFrame: null })

          if (pt.label) {
            const lm = L.marker([pt.lat, pt.lon], {
              icon: L.divIcon({
                className: "",
                html: `<div style="color:white;font-size:10px;font-weight:700;text-shadow:0 0 8px ${color},0 2px 4px #000;white-space:nowrap;pointer-events:none;margin-top:6px;">${pt.label}</div>`,
                iconSize: [0, 0], iconAnchor: [0, -14],
              }),
              interactive: false, pane: "tooltipPane",
            }).addTo(map)
            this._drawings.push({ layer: lm, animFrame: null })
          }
        } catch (_) {}
      }, i * 400 + 1000)
    })

    // Narrative flow line connecting all key points after markers appear
    if (keyPoints.length >= 2) {
      setTimeout(() => {
        try {
          const pts  = keyPoints.map(p => [p.lat, p.lon])
          const line = L.polyline(pts, {
            color, weight: 1.5, opacity: 0.5,
            dashArray: "6 6", className: "director-drawing-line",
          }).addTo(map)
          this._drawings.push(line)
        } catch (_) {}
      }, keyPoints.length * 400 + 1400)
    }
  }

  // ── Time formatting ───────────────────────────────────────────────────────

  _formatTimeAgo(timestamp) {
    try {
      const then    = new Date(timestamp)
      const diffMin = Math.floor((Date.now() - then.getTime()) / 60000)
      if (diffMin < 1)   return "Just now"
      if (diffMin < 60)  return `${diffMin}m ago`
      const diffHr = Math.floor(diffMin / 60)
      if (diffHr < 24)   return `${diffHr}h ago`
      const diffDay = Math.floor(diffHr / 24)
      if (diffDay < 7)   return `${diffDay}d ago`
      return then.toLocaleDateString()
    } catch { return "" }
  }

  // ── State notification ────────────────────────────────────────────────────

  _notifyState() {
    this.onStateChange({
      isPlaying:    this.isPlaying,
      currentIndex: this.currentIndex,
      total:        this.actions.length,
    })
  }
}


// ── API helpers ───────────────────────────────────────────────────────────────

export async function submitDirectorBriefing(intent) {
  const res = await fetch(`${API_BASE}/api/director/submit`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ..._authHeaders() },
    body:    JSON.stringify({ intent }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `submit: ${res.status}`)
  }
  return res.json()
}

export async function pollDirectorStatus(jobId) {
  const res = await fetch(`${API_BASE}/api/director/status/${jobId}`, {
    headers: _authHeaders(),
  })
  if (!res.ok) throw new Error(`status: ${res.status}`)
  return res.json()
}

export async function fetchDirectorSnapshot() {
  const res = await fetch(`${API_BASE}/api/director/snapshot`)
  if (!res.ok) throw new Error(`snapshot: ${res.status}`)
  return res.json()
}

export async function generateDirectorSequence({ intent, snapshot }) {
  const res = await fetch(`${API_BASE}/api/director/generate`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ..._authHeaders() },
    body:    JSON.stringify({ intent, snapshot }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `generate: ${res.status}`)
  }
  return res.json()
}

export async function saveDirectorSequence(sequence, { transcript = "", intent = "" } = {}) {
  const res = await fetch(`${API_BASE}/api/director/save`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ..._authHeaders() },
    body:    JSON.stringify({ sequence, transcript, intent }),
  })
  if (!res.ok) throw new Error(`save: ${res.status}`)
  return res.json()
}

export async function listDirectorSequences() {
  const res = await fetch(`${API_BASE}/api/director/list`)
  if (!res.ok) throw new Error(`list: ${res.status}`)
  return res.json()
}

export async function loadDirectorSequence(seqId) {
  const res = await fetch(`${API_BASE}/api/director/load/${seqId}`)
  if (!res.ok) throw new Error(`load: ${res.status}`)
  return res.json()
}
