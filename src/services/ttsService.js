/**
 * ttsService.js — Director Mode TTS using ElevenLabs, falling back to browser SpeechSynthesis.
 *
 * Public API is unchanged from the previous browser-only version so all existing
 * callers (commandRunner.js, DirectorBar, DirectorModal, DirectorSubtitle) work
 * without modification.
 */

import API_BASE from "../apiBase.js"

const DEFAULT_VOICE_ID = "fjnwTZkKtQOJaYzGLa6n"
const MAX_CHUNK_CHARS  = 500

function _splitText(text) {
  if (text.length <= MAX_CHUNK_CHARS) return [text]
  const chunks = []
  // Split on sentence endings, keeping the delimiter with the preceding chunk
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text]
  let current = ""
  for (const s of sentences) {
    if ((current + s).length > MAX_CHUNK_CHARS && current) {
      chunks.push(current.trim())
      current = s
    } else {
      current += s
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.length ? chunks : [text]
}

class TTSService {
  constructor() {
    this._muted          = false
    this._speaking       = false
    this._voicePreference = "elevenlabs"
    this._currentAudio   = null
    this._abortCtrl      = null
    this._cache          = new Map()   // text → blob URL (session-scoped)

    // Browser voice fallback state
    this._browserVoice   = null
    this._rate           = 0.95
    this._pitch          = 0.9
    this._volume         = 1.0
    this._currentUtterance = null

    this._loadBrowserVoices()
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => this._loadBrowserVoices()
    }
  }

  // ── Browser voice helpers (fallback only) ────────────────────────────────

  _loadBrowserVoices() {
    if (!window.speechSynthesis) return
    const voices = window.speechSynthesis.getVoices()
    if (!voices.length) return
    this._browserVoice = voices.find(v => v.name === "Daniel" && v.lang.startsWith("en-GB"))
      || voices.find(v => v.lang.startsWith("en-GB"))
      || voices.find(v => v.lang.startsWith("en"))
      || voices[0]
  }

  // ── Public API ───────────────────────────────────────────────────────────

  get muted()           { return this._muted }
  get isSpeaking()      { return this._speaking }
  get voicePreference() { return this._voicePreference }

  mute()        { this._muted = true;  this.stop() }
  unmute()      { this._muted = false }
  toggleMute()  { if (this._muted) this.unmute(); else this.mute(); return this._muted }

  setVoice(preference) {
    this._voicePreference = preference
    if (preference === "deep_commander") { this._rate = 0.85; this._pitch = 0.7 }
    else if (preference === "british_male") { this._rate = 0.95; this._pitch = 0.9 }
    else { this._rate = 1.0; this._pitch = 1.0 }
    this._loadBrowserVoices()
  }

  getAvailableVoices() {
    return [
      { id: "elevenlabs",      label: "ElevenLabs AI",   description: "Deep, authoritative AI voice" },
      { id: "british_male",    label: "British Male",     description: "Daniel — browser TTS" },
      { id: "british_female",  label: "British Female",   description: "Kate — browser TTS" },
      { id: "american_male",   label: "American Male",    description: "Standard US English — browser TTS" },
      { id: "american_female", label: "American Female",  description: "Samantha — browser TTS" },
      { id: "deep_commander",  label: "Commander",        description: "Deep, slow — browser TTS" },
    ]
  }

  async speak(text) {
    if (this._muted || !text?.trim()) return
    if (this._voicePreference !== "elevenlabs") {
      return this._speakBrowser(text)
    }
    return this._speakElevenLabs(text)
  }

  stop() {
    // Stop ElevenLabs audio
    if (this._currentAudio) {
      try { this._currentAudio.pause(); this._currentAudio.src = "" } catch (_) {}
      this._currentAudio = null
    }
    if (this._abortCtrl) {
      try { this._abortCtrl.abort() } catch (_) {}
      this._abortCtrl = null
    }
    // Stop browser TTS
    if (window.speechSynthesis) window.speechSynthesis.cancel()
    this._currentUtterance = null
    this._speaking = false
  }

  // ── ElevenLabs implementation ────────────────────────────────────────────

  async _speakElevenLabs(text) {
    const chunks = _splitText(text)
    this._speaking = true
    try {
      for (const chunk of chunks) {
        if (this._muted) break
        await this._speakChunk(chunk)
      }
    } finally {
      this._speaking = false
    }
  }

  async _speakChunk(text) {
    // Check session cache first
    if (this._cache.has(text)) {
      return this._playUrl(this._cache.get(text))
    }

    this._abortCtrl = new AbortController()
    const tok = localStorage.getItem("hw-auth-token")
    try {
      const resp = await fetch(`${API_BASE}/api/tts`, {
        method:  "POST",
        signal:  this._abortCtrl.signal,
        headers: {
          "Content-Type":  "application/json",
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: JSON.stringify({ text }),
      })
      if (!resp.ok) throw new Error(`TTS ${resp.status}`)
      const blob = await resp.blob()
      const url  = URL.createObjectURL(blob)
      this._cache.set(text, url)
      return this._playUrl(url)
    } catch (err) {
      if (err.name === "AbortError") return
      console.warn("[TTS] ElevenLabs failed, using browser fallback:", err.message)
      return this._speakBrowser(text)
    } finally {
      this._abortCtrl = null
    }
  }

  _playUrl(url) {
    return new Promise((resolve) => {
      const audio = new Audio(url)
      this._currentAudio = audio
      audio.onended = () => { this._currentAudio = null; resolve() }
      audio.onerror = () => { this._currentAudio = null; resolve() }
      audio.play().catch(() => resolve())
    })
  }

  // ── Browser TTS fallback ─────────────────────────────────────────────────

  _speakBrowser(text) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis || !text) { resolve(); return }
      this.stop()
      const utterance    = new SpeechSynthesisUtterance(text)
      utterance.voice    = this._browserVoice
      utterance.rate     = this._rate
      utterance.pitch    = this._pitch
      utterance.volume   = this._volume

      // Chrome: speechSynthesis stalls after ~15s
      const keepAlive = setInterval(() => {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.pause()
          window.speechSynthesis.resume()
        }
      }, 10000)

      const done = () => {
        clearInterval(keepAlive)
        this._speaking = false
        this._currentUtterance = null
        resolve()
      }
      utterance.onend   = done
      utterance.onerror = done

      this._currentUtterance = utterance
      this._speaking = true
      window.speechSynthesis.speak(utterance)
    })
  }
}

const ttsService = new TTSService()
export default ttsService
