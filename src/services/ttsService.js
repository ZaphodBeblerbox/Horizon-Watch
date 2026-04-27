/**
 * ttsService.js — Director Mode TTS using ElevenLabs, falling back to browser SpeechSynthesis.
 */

import API_BASE from "../apiBase.js"

const DEFAULT_VOICE_ID = "fjnwTZkKtQOJaYzGLa6n"
const MAX_CHUNK_CHARS  = 500
const INTER_CHUNK_MS   = 250   // pause between sequential chunks to avoid rate limits

function _splitText(text) {
  if (text.length <= MAX_CHUNK_CHARS) return [text]
  const chunks = []
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

function _delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}

class TTSService {
  constructor() {
    this._muted              = false
    this._speaking           = false
    this._voicePreference    = "elevenlabs"
    this._currentAudio       = null
    this._abortCtrl          = null
    this._cache              = new Map()   // text → Blob
    this._elevenLabsDisabled = false       // only set true on sustained quota failure
    this._consecutiveFails   = 0           // reset on success; disable after 3

    this._browserVoice    = null
    this._rate            = 0.95
    this._pitch           = 0.9
    this._volume          = 1.0
    this._currentUtterance = null

    this._loadBrowserVoices()
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => this._loadBrowserVoices()
    }
  }

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

  mute()       { this._muted = true;  this.stop() }
  unmute()     { this._muted = false }
  toggleMute() { if (this._muted) this.unmute(); else this.mute(); return this._muted }

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
      // Safety net — briefing must never crash due to TTS
    }
  }

  stop() {
    if (this._currentAudio) {
      try { this._currentAudio.pause() } catch (_) {}
      this._currentAudio = null
    }
    if (this._abortCtrl) {
      try { this._abortCtrl.abort() } catch (_) {}
      this._abortCtrl = null
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel()
    this._currentUtterance = null
    this._speaking = false
  }

  // ── ElevenLabs implementation ────────────────────────────────────────────

  async _speakElevenLabs(text) {
    const chunks = _splitText(text)
    console.log(`[TTS] ElevenLabs: ${chunks.length} chunk(s) for ${text.length} chars`)
    this._speaking = true
    try {
      for (let i = 0; i < chunks.length; i++) {
        if (this._muted) break
        if (i > 0) await _delay(INTER_CHUNK_MS)
        await this._speakChunk(chunks[i])
        // If ElevenLabs got permanently disabled mid-loop, switch to browser for rest
        if (this._elevenLabsDisabled) {
          const remaining = chunks.slice(i + 1).join(" ")
          if (remaining.trim()) await this._doSpeakBrowser(remaining)
          break
        }
      }
    } finally {
      this._speaking = false
    }
  }

  async _speakChunk(text) {
    if (this._cache.has(text)) {
      console.log(`[TTS] cache hit (${text.length} chars)`)
      return this._playBlob(this._cache.get(text))
    }

    console.log(`[TTS] requesting ElevenLabs, text length: ${text.length} chars`)
    this._abortCtrl = new AbortController()
    const tok = localStorage.getItem("hw-auth-token")
    try {
      const resp = await fetch(`${API_BASE}/api/tts`, {
        method:  "POST",
        signal:  this._abortCtrl.signal,
        headers: {
          "Content-Type": "application/json",
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: JSON.stringify({ text }),
      })

      console.log(`[TTS] ElevenLabs response: ${resp.status}`)

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "")
        console.error(`[TTS] ElevenLabs failed ${resp.status}:`, errBody.slice(0, 200))
        if (resp.status === 429) {
          this._consecutiveFails++
          console.warn(`[TTS] Rate limited (fail #${this._consecutiveFails}) — backing off 2s`)
          await _delay(2000)
          if (this._consecutiveFails >= 3) {
            console.warn("[TTS] 3 consecutive rate limits — disabling ElevenLabs for session")
            this._elevenLabsDisabled = true
          }
        } else if (resp.status === 503) {
          this._consecutiveFails++
          if (this._consecutiveFails >= 3) {
            this._elevenLabsDisabled = true
          }
        }
        // Fall back to browser TTS for this chunk
        return this._doSpeakBrowser(text)
      }

      // Success — reset fail counter
      this._consecutiveFails = 0
      const blob = await resp.blob()
      this._cache.set(text, blob)
      return this._playBlob(blob)

    } catch (err) {
      if (err.name === "AbortError") return
      console.warn("[TTS] fetch error, using browser fallback:", err.message)
      return this._doSpeakBrowser(text)
    } finally {
      this._abortCtrl = null
    }
  }

  _playBlob(blob) {
    return new Promise((resolve) => {
      const url   = URL.createObjectURL(blob)
      const audio = new Audio(url)
      this._currentAudio = audio

      let resolved = false
      const done = (reason) => {
        if (resolved) return
        resolved = true
        try { audio.pause() } catch (_) {}
        try { URL.revokeObjectURL(url) } catch (_) {}
        this._currentAudio = null
        console.log(`[TTS] playback done (${reason})`)
        resolve()
      }

      audio.addEventListener('ended',  () => done('ended'),  { once: true })
      audio.addEventListener('error',  () => done('error'),  { once: true })

      // Smart timeout based on audio duration
      audio.addEventListener('loadedmetadata', () => {
        const maxWait = Math.max((audio.duration || 0) * 1000 + 5000, 10000)
        console.log(`[TTS] audio duration ${audio.duration?.toFixed(1)}s, timeout in ${(maxWait/1000).toFixed(0)}s`)
        setTimeout(() => {
          if (!resolved) {
            console.warn("[TTS] duration timeout — force advancing")
            done('duration-timeout')
          }
        }, maxWait)
      }, { once: true })

      // Hard 60s safety net
      setTimeout(() => {
        if (!resolved) {
          console.warn("[TTS] hard 60s timeout — force advancing")
          done('hard-timeout')
        }
      }, 60000)

      audio.play().catch(e => {
        console.error("[TTS] audio.play() rejected:", e.message)
        done('play-rejected')
      })
    })
  }

  // ── Browser TTS ──────────────────────────────────────────────────────────

  // Public-facing: stops any current audio before speaking
  _speakBrowser(text) {
    this.stop()
    return this._doSpeakBrowser(text)
  }

  // Internal: speaks without stopping — safe to call as a fallback mid-loop
  _doSpeakBrowser(text) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis || !text?.trim()) { resolve(); return }
      console.log(`[TTS] browser TTS fallback for ${text.length} chars`)
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

      let resolved = false
      const done = () => {
        if (resolved) return
        resolved = true
        clearInterval(keepAlive)
        this._currentUtterance = null
        resolve()
      }

      // Hard 45s timeout — browser TTS should never hang forever
      setTimeout(done, 45000)

      utterance.onend   = done
      utterance.onerror = (e) => {
        console.error("[TTS] browser TTS error:", e.error)
        done()
      }

      this._currentUtterance = utterance
      window.speechSynthesis.speak(utterance)
    })
  }
}

const ttsService = new TTSService()
export default ttsService
