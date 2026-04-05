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
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  load(sequence) {
    this.stop()
    this.actions      = Array.isArray(sequence?.actions) ? sequence.actions : []
    this.currentIndex = -1
    this._aborted     = false
    this._pendingSatObservations = null
    this._pendingImage           = null
    this._placedEvents           = new Map()
    this._placedLocations        = new Map()
    this._notifyState()
  }

  play() {
    if (this.isPlaying) return
    if (this.currentIndex >= this.actions.length - 1) {
      this.currentIndex = -1
      this.setHighlights([])
      if (this.setLayerOverrides) this.setLayerOverrides({})
    }
    this.isPlaying = true
    this._aborted  = false
    this._notifyState()
    this._advance()
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

  _executeIndex(index) {
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

    const delay = this._dispatchAction(action)
    if (this.isPlaying) {
      this._timer = setTimeout(() => this._advance(), delay)
    }
  }

  /**
   * Dispatch a single synchronous action. Returns ms to wait before next action.
   */
  _dispatchAction(action) {
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
        // Close any open Leaflet popups
        const map = this.mapRef?.current
        if (map && typeof map.closePopup === "function") map.closePopup()
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
        const { title, lat, lon, type, severity, source, summary: evSummary } = action
        if (title && lat != null && lon != null && this.setDirectorItems) {
          const evData = {
            title,
            lat,
            lon,
            type:     type     || "general",
            severity: severity || "elevated",
            source:   source   || "",
            summary:  evSummary || "",
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
        const color = SEVERITY_COLOR[ev.severity] || "#3b82f6"
        const imgId = `dir-ev-img-${Date.now()}`
        const html = `<div class="director-event-popup">
          <div class="director-event-popup-header" style="border-left:3px solid ${color};padding-left:8px">
            <span class="director-event-popup-type">${(ev.type || "event").toUpperCase()}</span>
            <span class="director-event-popup-severity" style="color:${color}">${(ev.severity || "").toUpperCase()}</span>
          </div>
          <div class="director-event-popup-title">${ev.title}</div>
          ${ev.summary ? `<div class="director-event-popup-summary">${ev.summary}</div>` : ""}
          ${ev.source  ? `<div class="director-event-popup-source">${ev.source}</div>` : ""}
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
        const L     = window.L
        if (!L) return defaultDelay
        const from  = action.from
        const to    = action.to
        const color = action.color || "#ef4444"
        // Line
        const line  = L.polyline([from, to], { color, weight: 2, opacity: 0.9, className: "director-drawing-line" }).addTo(map)
        if (action.label) line.bindTooltip(action.label, { permanent: false, sticky: true })
        // Arrowhead: small divIcon triangle rotated to bearing
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
        // entry is either a Leaflet layer or { layer, animFrame } for animated markers
        if (entry && typeof entry === "object" && "animFrame" in entry) {
          if (typeof entry.animFrame === "function") entry.animFrame()
          if (map && entry.layer) map.removeLayer(entry.layer)
        } else {
          if (map && entry) map.removeLayer(entry)
        }
      } catch (_) {}
    }
    this._drawings = []
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

export async function saveDirectorSequence(sequence) {
  const res = await fetch(`${API_BASE}/api/director/save`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ..._authHeaders() },
    body:    JSON.stringify({ sequence }),
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
