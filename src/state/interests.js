/**
 * interests.js — what this user watches, and whether a signal is for them.
 *
 * The surface pool is ranked once for the whole server (_ACTIVE_PROFILE in
 * main.py is a single profile.json), so Home led with "Boat collision on the
 * Congo River" for an analyst who watches the Red Sea. Relevance is decided
 * here, per user, at read time — the shared scoring is untouched.
 *
 * What a user watches:
 *   - their theaters: the countries each one looks at, taken from the
 *     theater's view (countries whose centre is inside the framed area), so
 *     a theater made a minute ago counts without anyone listing countries;
 *   - countries and regions they add (Settings › Your interests);
 *   - topics they add (maritime, aviation, conflict, energy, cyber, unrest).
 *
 * A signal is FOR YOU when it is in a watched country, or matches a watched
 * topic and is critical. Everything else is ELSEWHERE — still there, never
 * hidden, but not the headline. Each verdict carries its reason, so the
 * console can say why it is showing something.
 */

/** Regions a user can add in one click, as the countries they mean. */
export const REGIONS = {
    "Red Sea & Horn of Africa": ["Yemen", "Saudi Arabia", "Eritrea", "Djibouti", "Somalia", "Ethiopia", "Sudan", "Egypt"],
    "Persian Gulf": ["Iran", "Iraq", "Kuwait", "Saudi Arabia", "Bahrain", "Qatar", "United Arab Emirates", "Oman"],
    "Levant": ["Israel", "Palestine", "Lebanon", "Syria", "Jordan"],
    "Ukraine & Black Sea": ["Ukraine", "Russia", "Moldova", "Romania", "Georgia", "Turkey", "Belarus"],
    "Baltic & Nordics": ["Estonia", "Latvia", "Lithuania", "Poland", "Finland", "Sweden", "Denmark", "Norway", "Germany"],
    "Sahel": ["Mali", "Burkina Faso", "Niger", "Chad", "Mauritania", "Nigeria", "Sudan"],
    "Great Lakes": ["Democratic Republic of the Congo", "Rwanda", "Uganda", "Burundi", "United Republic of Tanzania", "Kenya", "South Sudan"],
    "Taiwan Strait & South China Sea": ["Taiwan", "China", "Philippines", "Vietnam", "Malaysia", "Japan"],
    "Korean Peninsula": ["North Korea", "South Korea", "Japan", "China"],
    "South Asia": ["India", "Pakistan", "Afghanistan", "Bangladesh", "Myanmar", "Sri Lanka", "Nepal"],
    "Latin America": ["Venezuela", "Colombia", "Mexico", "Brazil", "Ecuador", "Peru", "Haiti", "Cuba"],
}

/** Topics, as patterns over what a signal says about itself. */
export const TOPICS = {
    maritime: { label: "Maritime", re: /\b(vessel|ship|tanker|port|maritime|navy|naval|strait|cargo|sanctioned vessel|piracy|ais)\b/i },
    aviation: { label: "Aviation", re: /\b(aircraft|airport|flight|airspace|drone|uav|jet|air ?force|gps|jamming|missile)\b/i },
    conflict: { label: "Armed conflict", re: /\b(attack|strike|shelling|killed|clash|fighting|offensive|troops|militant|insurgent|bomb|explosion|frontline|artillery)\b/i },
    energy:   { label: "Energy & infrastructure", re: /\b(oil|gas|pipeline|refinery|power|grid|cable|lng|energy|infrastructure|substation)\b/i },
    cyber:    { label: "Cyber", re: /\b(cyber|hack|ransomware|malware|outage|ddos)\b/i },
    unrest:   { label: "Unrest & politics", re: /\b(protest|riot|coup|election|unrest|curfew|sanction|arrest|demonstrat)\w*/i },
}

const deg = Math.PI / 180
function kmBetween(a, b) {
    const dLat = (b.lat - a.lat) * deg, dLon = (b.lon - a.lon) * deg
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * deg) * Math.cos(b.lat * deg) * Math.sin(dLon / 2) ** 2
    return 12742 * Math.asin(Math.sqrt(h))
}

/**
 * The countries a theater looks at: every country whose centre lies within
 * the framed area. A camera at height h sees roughly h × 0.9 km to each
 * side; floored so a city-level theater still names its own country.
 */
export function countriesInView(view, countries) {
    if (!view || !Number.isFinite(view.lat) || !Number.isFinite(view.lon)) return []
    const reach = Math.max(350, (Number(view.height) || 2_000_000) / 1000 * 0.9)
    return countries
        .filter((c) => kmBetween(view, c) <= reach)
        .sort((a, b) => kmBetween(view, a) - kmBetween(view, b))
        .map((c) => c.name)
}

/**
 * Everything this user watches, as sets plus where each came from.
 * @param saved     settings.interests: {countries, regions, topics}
 * @param theaters  [{name, view}]
 * @param countries [{name, lat, lon}] — the gazetteer's countries
 */
export function watched(saved = {}, theaters = [], countries = []) {
    const why = new Map()
    const add = (c, reason) => { if (c && !why.has(c)) why.set(c, reason) }
    for (const c of saved?.countries || []) add(c, "a country you watch")
    for (const r of saved?.regions || []) for (const c of REGIONS[r] || []) add(c, r)
    for (const t of theaters || []) for (const c of countriesInView(t.view, countries)) add(c, t.name)
    return { countries: why, topics: new Set(saved?.topics || []) }
}

const text = (s) => [s?.headline, s?.title, s?.type, s?.source_type, s?.rule_name].filter(Boolean).join(" ")

/** {forYou, reason} for one signal. */
export function relevance(signal, w) {
    const c = signal?.location_country
    if (c && w?.countries?.has(c)) return { forYou: true, reason: `${c} · ${w.countries.get(c)}` }
    const t = text(signal)
    for (const k of w?.topics || []) {
        if (TOPICS[k]?.re.test(t) && signal?.severity_tier === "critical") {
            return { forYou: true, reason: `${TOPICS[k].label}, critical` }
        }
    }
    return { forYou: false, reason: null }
}

/** Split a surface into what is for this user and what is elsewhere. */
export function partition(surface, w) {
    const mine = [], elsewhere = []
    for (const s of surface || []) {
        const r = relevance(s, w)
        ;(r.forYou ? mine : elsewhere).push(r.forYou ? { ...s, _why: r.reason } : s)
    }
    return { mine, elsewhere, hasInterests: !!(w && (w.countries.size || w.topics.size)) }
}
