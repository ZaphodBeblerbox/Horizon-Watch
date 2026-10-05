/**
 * greetings.js — what Home says when you open it.
 *
 * FIVE BUCKETS, FROM THE USER'S OWN CLOCK. The boundaries are local time,
 * the same `new Date()` the tab bar's day/night dial and the auto theme's
 * solar cycle read, so the greeting, the sky and the palette agree about
 * what time it is. A greeting keyed to UTC tells someone in Singapore
 * "good evening" over breakfast.
 *
 * WHY A CATALOGUE AND NOT ONE LINE PER BUCKET. The same sentence every
 * morning stops being read after a week — it becomes furniture, and the
 * line underneath it (which carries the actual state of the watch) gets
 * skipped with it. Rotating the opener keeps the eye landing there.
 *
 * THE REGISTER. This is an intelligence desk, not a wellness app. The
 * lines are allowed to be warm and occasionally dry; none of them are
 * jokes, none of them use exclamation marks, and none of them comment on
 * the news. "Working late?" at 01:00 is a colleague noticing. "Another
 * one in the books" after a bad day would be the software having an
 * opinion about events it does not understand.
 *
 * {name} is interpolated. A line must read correctly when the name is
 * missing — see `greetingFor`, which falls back to a nameless variant
 * rather than printing "Good morning, there."
 */

/** Local-time buckets. Boundaries are deliberate, not even sixths:
 *  "noon" is a short, real part of the day; night is long. */
export const BUCKETS = [
    { key: "morning",   from: 5,  to: 11, label: "Morning" },
    { key: "noon",      from: 11, to: 14, label: "Midday" },
    { key: "afternoon", from: 14, to: 18, label: "Afternoon" },
    { key: "evening",   from: 18, to: 22, label: "Evening" },
    { key: "night",     from: 22, to: 5,  label: "Night" },
]

export function timeBucket(date = new Date()) {
    const h = date.getHours()
    for (const b of BUCKETS) {
        if (b.from < b.to ? (h >= b.from && h < b.to) : (h >= b.from || h < b.to)) return b.key
    }
    return "morning"
}

/* Each entry: [withName, withoutName]. The second is not a fallback bolted
   on afterwards — several of these read better without a name, and a few
   only work with one, which is why both are written out. */
const LINES = {
    morning: [
        ["Good morning, {name}.",            "Good morning."],
        ["Morning, {name}.",                 "Morning."],
        ["You're on early, {name}.",         "An early start."],
        ["First light, {name}.",             "First light."],
        ["Here's the overnight, {name}.",    "Here's the overnight."],
        ["Back at it, {name}.",              "Back at it."],
    ],
    noon: [
        ["Midday, {name}.",                  "Midday."],
        ["Half the day gone, {name}.",       "Half the day gone."],
        ["Where things stand, {name}.",      "Where things stand."],
        ["Good afternoon, {name}.",          "Good afternoon."],
        ["Checking in, {name}?",             "Checking in."],
    ],
    afternoon: [
        ["Good afternoon, {name}.",          "Good afternoon."],
        ["Afternoon, {name}.",               "Afternoon."],
        ["Still with us, {name}.",           "Still going."],
        ["The day so far, {name}.",          "The day so far."],
        ["Picking up where you left off, {name}.", "Picking up where you left off."],
    ],
    evening: [
        ["Good evening, {name}.",            "Good evening."],
        ["Evening, {name}.",                 "Evening."],
        ["Winding down, {name}?",            "Winding down."],
        ["Last look before you go, {name}?", "Last look before you go."],
        ["How the day went, {name}.",        "How the day went."],
    ],
    night: [
        ["Working late, {name}?",            "Working late?"],
        ["Still up, {name}?",                "Still up?"],
        ["Late shift, {name}.",              "Late shift."],
        ["The quiet hours, {name}.",         "The quiet hours."],
        ["Nobody else is on, {name}.",       "Nobody else is on."],
        ["Burning the midnight oil, {name}.", "Burning the midnight oil."],
    ],
}

/* The line under the greeting. It sets up what Home is about to show, so
   it changes with the bucket but stays steady within one — this is the
   sentence that tells you what you are looking at. */
const SUBS = {
    morning:   "Here is your brief for the day.",
    noon:      "Here is where the day stands.",
    afternoon: "Here is what has moved since this morning.",
    evening:   "Here is how the day went, and what to watch tonight.",
    night:     "Here is what came in while the desk was quiet.",
}

/** The kicker over the brief card. */
export const KICKERS = {
    morning: "Morning brief", noon: "Midday update", afternoon: "Afternoon update",
    evening: "Evening review", night: "Night watch",
}

/**
 * Pick a line. `seed` decides which one, and the caller owns it so the
 * greeting is stable for as long as the caller wants it to be — Home seeds
 * once per mount, so it does not reshuffle on every re-render but is
 * different next time you open it.
 */
export function greetingFor(name, { date = new Date(), seed = 0 } = {}) {
    const bucket = timeBucket(date)
    const list = LINES[bucket] || LINES.morning
    const [withName, without] = list[Math.abs(Math.floor(seed)) % list.length]
    const clean = (name || "").trim()
    return {
        bucket,
        lead: clean ? withName.replace("{name}", clean) : without,
        sub: SUBS[bucket],
        kicker: KICKERS[bucket],
    }
}
