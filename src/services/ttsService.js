/**
 * ttsService.js — Browser-based text-to-speech singleton for Director Mode.
 *
 * Uses the Web Speech API (SpeechSynthesis). Supports voice selection,
 * mute toggle, and includes the Chrome keepalive workaround for long segments.
 */

class TTSService {
  constructor() {
    this._muted = false
    this._speaking = false
    this._voice = null
    this._voicePreference = "british_male"
    this._rate = 0.95
    this._pitch = 0.9
    this._volume = 1.0
    this._currentUtterance = null

    this._loadVoices()
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => this._loadVoices()
    }
  }

  _loadVoices() {
    if (!window.speechSynthesis) return
    const voices = window.speechSynthesis.getVoices()
    if (voices.length === 0) return
    this._voice = this._findVoice(this._voicePreference, voices)
  }

  _findVoice(preference, voices) {
    const priorities = {
      british_male: [
        v => v.name === "Daniel" && v.lang.startsWith("en-GB"),
        v => v.name === "Google UK English Male",
        v => v.name.includes("Daniel"),
        v => v.name.includes("Male") && v.lang.startsWith("en-GB"),
        v => v.lang.startsWith("en-GB"),
        v => v.name.includes("Male") && v.lang.startsWith("en"),
        v => v.lang.startsWith("en"),
      ],
      british_female: [
        v => v.name === "Kate" && v.lang.startsWith("en-GB"),
        v => v.name === "Google UK English Female",
        v => v.name.includes("Female") && v.lang.startsWith("en-GB"),
        v => v.lang.startsWith("en-GB"),
        v => v.lang.startsWith("en"),
      ],
      american_male: [
        v => v.name === "Alex" && v.lang.startsWith("en-US"),
        v => v.name === "Google US English",
        v => v.name.includes("Male") && v.lang.startsWith("en-US"),
        v => v.lang.startsWith("en-US"),
        v => v.lang.startsWith("en"),
      ],
      american_female: [
        v => v.name === "Samantha" && v.lang.startsWith("en-US"),
        v => v.name.includes("Female") && v.lang.startsWith("en-US"),
        v => v.lang.startsWith("en-US"),
        v => v.lang.startsWith("en"),
      ],
      deep_commander: [
        v => v.name === "Daniel" && v.lang.startsWith("en-GB"),
        v => v.name === "Google UK English Male",
        v => v.name.includes("Male") && v.lang.startsWith("en"),
        v => v.lang.startsWith("en"),
      ],
    }

    const matchers = priorities[preference] || priorities.british_male
    for (const matcher of matchers) {
      const found = voices.find(matcher)
      if (found) return found
    }
    return voices.find(v => v.lang.startsWith("en")) || voices[0]
  }

  setVoice(preference) {
    this._voicePreference = preference
    const voices = window.speechSynthesis?.getVoices() || []
    if (voices.length > 0) {
      this._voice = this._findVoice(preference, voices)
    }
    if (preference === "deep_commander") {
      this._rate = 0.85
      this._pitch = 0.7
    } else if (preference === "british_male") {
      this._rate = 0.95
      this._pitch = 0.9
    } else {
      this._rate = 1.0
      this._pitch = 1.0
    }
  }

  getAvailableVoices() {
    return [
      { id: "british_male",    label: "British Male",    description: "Daniel — deep, authoritative" },
      { id: "british_female",  label: "British Female",  description: "Kate — calm, professional" },
      { id: "american_male",   label: "American Male",   description: "Standard US English" },
      { id: "american_female", label: "American Female", description: "Samantha — clear, warm" },
      { id: "deep_commander",  label: "Commander",       description: "Deep, slow, commanding tone" },
    ]
  }

  get muted() { return this._muted }

  mute() {
    this._muted = true
    this.stop()
  }

  unmute() {
    this._muted = false
  }

  toggleMute() {
    if (this._muted) this.unmute()
    else this.mute()
    return this._muted
  }

  speak(text) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis || this._muted || !text) {
        resolve()
        return
      }

      this.stop()

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.voice  = this._voice
      utterance.rate   = this._rate
      utterance.pitch  = this._pitch
      utterance.volume = this._volume

      // Chrome bug workaround: speechSynthesis stalls after ~15s
      const keepAlive = setInterval(() => {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.pause()
          window.speechSynthesis.resume()
        }
      }, 10000)

      utterance.onend = () => {
        clearInterval(keepAlive)
        this._speaking = false
        this._currentUtterance = null
        resolve()
      }

      utterance.onerror = () => {
        clearInterval(keepAlive)
        this._speaking = false
        this._currentUtterance = null
        resolve()
      }

      this._currentUtterance = utterance
      this._speaking = true
      window.speechSynthesis.speak(utterance)
    })
  }

  stop() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    this._speaking = false
    this._currentUtterance = null
  }

  get isSpeaking() { return this._speaking }
  get voicePreference() { return this._voicePreference }
}

const ttsService = new TTSService()
export default ttsService
