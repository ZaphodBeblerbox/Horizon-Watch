/**
 * voiceLog.js — what the parser understood, so the rules can grow.
 *
 * WHAT IS RECORDED AND WHAT IS NOT. The raw sentence, the intent, whether
 * the parser was confident, the problem it reported, and whether the user
 * undid what it did. Nothing else — note bodies and signal text are
 * content, and this log exists to improve matching, not to collect what
 * people write.
 *
 * It is local (localStorage, last 200). There is no analytics pipeline in
 * this app to send it to, and inventing one for a debugging aid would be
 * shipping a telemetry channel nobody asked for.
 *
 * READING IT: in the browser console,
 *     JSON.parse(localStorage["plx.voice.log"]).filter(e => !e.confident)
 * gives every sentence the parser would not act on, newest last. Those are
 * the rules worth writing next. `undone: true` marks the ones it got wrong
 * in a more expensive way — it acted, and the user took it back.
 */
const KEY = "plx.voice.log"
const CAP = 200

function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]") } catch { return [] }
}
function write(rows) {
    try { localStorage.setItem(KEY, JSON.stringify(rows.slice(-CAP))) } catch { /* private window */ }
}

export function logParse(result) {
    const rows = read()
    rows.push({
        at: new Date().toISOString(),
        raw: result.raw,
        intent: result.intent,
        confident: !!result.confident,
        problem: result.problem || null,
        undone: false,
    })
    write(rows)
    return rows.length - 1
}

export function markUndone(i) {
    const rows = read()
    if (rows[i]) { rows[i].undone = true; write(rows) }
}

export function readVoiceLog() { return read() }
export function clearVoiceLog() { write([]) }
