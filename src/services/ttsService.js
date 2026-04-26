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
    this._muted              = false
    this._speaking           = false
    this._voicePreference    = "elevenlabs"
    this._currentAudio       = null
    this._abortCtrl          = null
    this._cache              = new Map()   // text → Blob (session-scoped, not URL)
    this._elevenLabsDisabled = false       // set true on quota/auth error

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
    try {
      if (this._voicePreference !== "elevenlabs" || this._elevenLabsDisabled) {
        return await this._speakBrowser(text)
      }
      return await this._speakElevenLabs(text)
    } catch (_) {
      // Last-resort safety net — briefing must never crash due to TTS
    }
  }

  stop() {
    // Stop ElevenLabs audio
    if (this._currentAudio) {
      try { this._currentAudio.pause() } catch (_) {}
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
    // Check session blob cache first
    if (this._cache.has(text)) {
      return this._playBlob(this._cache.get(text))
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
      if (!resp.ok) {
        if ([401, 403, 422, 429, 503].includes(resp.status)) {
          console.warn(`[TTS] ElevenLabs disabled for session (HTTP ${resp.status})`)
          this._elevenLabsDisabled = true
        }
        throw new Error(`TTS ${resp.status}`)
      }
      const blob = await resp.blob()
      this._cache.set(text, blob)   // cache the blob, not the URL
      return this._playBlob(blob)
    } catch (err) {
      if (err.name === "AbortError") return
      console.warn("[TTS] ElevenLabs failed, using browser fallback:", err.message)
      return this._speakBrowser(text)
    } finally {
      this._abortCtrl = null
    }
  }

  _playBlob(blob) {
    return new Promise((resolve) => {
      // Create a fresh URL each play — blob URLs can silently stop firing 'ended'
      // if reused across multiple Audio instances.
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      this._currentAudio = audio

      let resolved = false
      const done = (reason) => {
        if (resolved) return
        resolved = true
        try { audio.pause() } catch (_) {}
        try { URL.revokeObjectURL(url) } catch (_) {}
        this._currentAudio = null
        console.log(`[TTS] chunk done (${reason})`)
        resolve()
      }

      audio.addEventListener('ended', () => done('ended'), { once: true })
      audio.addEventListener('error', () => done('error'), { once: true })

      // Smart timeout: (duration + 5s) once we know the audio length
      audio.addEventListener('loadedmetadata', () => {
        const maxWait = Math.max((audio.duration || 0) * 1000 + 5000, 10000)
        setTimeout(() => {
          if (!resolved) {
            console.warn('[TTS] Duration timeout — force advancing')
            done('duration-timeout')
          }
        }, maxWait)
      }, { once: true })

      // Hard 60s fallback regardless of loadedmetadata
      setTimeout(() => {
        if (!resolved) {
          console.warn('[TTS] Hard 60s timeout — force advancing')
          done('hard-timeout')
        }
      }, 60000)

      audio.play().catch(() => done('play-rejected'))
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
