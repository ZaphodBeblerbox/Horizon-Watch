/**
 * commandRunner.js — Director Mode action sequence playback engine.
 *
 * Usage:
 *   const runner = new CommandRunner({ mapRef, setLayerOverrides, setHighlights, surfaceItems })
 *   runner.load(sequence)   // load an action array
 *   runner.play()           // start/resume
 *   runner.pause()
 *   runner.stepForward()
 *   runner.stepBackward()
 *   runner.jumpTo(index)
 *   runner.stop()           // reset to start
 *   runner.destroy()        // clean up timers
 *
 * Callbacks supplied at construction:
 *   onAction(action, index)     — called each time an action executes
 *   onProgress(index, total)    — called after each action
 *   onComplete()                — called when last action finishes
 *   onNarrate(action)           — called for narrate/summary actions
 *   onIndicator(action)         — called for show_indicator actions
 *   onStateChange(state)        — called whenever play/pause/idle state changes
 */

import API_BASE from "../apiBase.js"

export class CommandRunner {
  constructor({
    mapRef,
    setLayerOverrides,
    setHighlights,
    surfaceItems = [],
    onAction      = () => {},
    onProgress    = () => {},
    onComplete    = () => {},
    onNarrate     = () => {},
    onIndicator   = () => {},
    onStateChange = () => {},
  } = {}) {
    this.mapRef            = mapRef
    this.setLayerOverrides = setLayerOverrides
    this.setHighlights     = setHighlights
    this.surfaceItems      = surfaceItems
    this.onAction          = onAction
    this.onProgress        = onProgress
    this.onComplete        = onComplete
    this.onNarrate         = onNarrate
    this.onIndicator       = onIndicator
    this.onStateChange     = onStateChange

    this.actions           = []
    this.currentIndex      = -1
    this.isPlaying         = false
    this._timer            = null
    this._aborted          = false
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  load(sequence) {
    this.stop()
    this.actions      = Array.isArray(sequence?.actions) ? sequence.actions : []
    this.currentIndex = -1
    this._aborted     = false
    this._notifyState()
  }

  play() {
    if (this.isPlaying) return
    if (this.currentIndex >= this.actions.length - 1) {
      // restart from beginning
      this.currentIndex = -1
      this.setHighlights([])
      this.setLayerOverrides({})
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
    this._notifyState()
  }

  stepForward() {
    this.pause()
    if (this.currentIndex < this.actions.length - 1) {
      this._executeIndex(this.currentIndex + 1)
    }
  }

  stepBackward() {
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
    this.setLayerOverrides({})
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

    const delay = this._dispatchAction(action)

    if (this.isPlaying) {
      this._timer = setTimeout(() => this._advance(), delay)
    }
  }

  /**
   * Dispatch a single action. Returns the ms to wait before the next action.
   */
  _dispatchAction(action) {
    const act = action.action
    const defaultDelay = 800

    switch (act) {
      case "fly_to": {
        const map = this.mapRef?.current
        if (map && typeof map.flyTo === "function") {
          const zoom     = action.zoom     ?? 5
          const duration = (action.duration ?? 2000) / 1000  // Leaflet uses seconds
          map.flyTo([action.lat, action.lon], zoom, { duration, easeLinearity: 0.5 })
        }
        return (action.duration ?? 2000) + 400
      }

      case "toggle_layer": {
        const layer   = action.layer
        const enabled = Boolean(action.enabled)
        if (layer) {
          this.setLayerOverrides(prev => ({ ...prev, [layer]: enabled }))
        }
        return defaultDelay
      }

      case "highlight_event": {
        const eventId = action.event_id
        const style   = action.style ?? "pulse"
        // Look up coordinates from surfaceItems
        const item = this.surfaceItems.find(
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

      case "narrate": {
        this.onNarrate(action)
        // Pause slightly longer for narration so the user can read
        return 300
      }

      case "show_indicator": {
        this.onIndicator(action)
        return defaultDelay
      }

      case "pause": {
        return action.duration ?? 1500
      }

      case "summary": {
        this.onNarrate(action)  // DirectorBar treats summary like narrate
        return 300
      }

      default:
        return defaultDelay
    }
  }

  _notifyState() {
    this.onStateChange({
      isPlaying:    this.isPlaying,
      currentIndex: this.currentIndex,
      total:        this.actions.length,
    })
  }
}


// ── API helpers ───────────────────────────────────────────────────────────────

const AUTH_KEY = "hw-auth-token"

function _authHeaders() {
  const tok = localStorage.getItem(AUTH_KEY)
  return tok ? { Authorization: `Bearer ${tok}` } : {}
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
