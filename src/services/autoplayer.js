/**
 * autoplayer.js — Intelligent autoplay queue builder.
 * Fetches live data and builds an ordered camera route visiting
 * only active intelligence signals (no random globe spinning).
 *
 * Priority order:
 *   1. Escalating threat zones (trend_delta >= 25)
 *   2. Sanctioned vessels / STS alerts + emerging zones
 *   3. Active fusion events
 *   4. High-relevance forge alerts (score >= 70)
 *   5. Active surge events with location
 *   6. Tier 1 news visible on globe
 *   7. Elevated stable zones (score >= 55)
 */

export const AUTOPLAY_SEGMENT_DURATION = 18_000  // ms per location
export const TRANSITION_DURATION       =  2_800  // camera flight ms

export const AUTOPLAY_ALTITUDES = {
    zone:     900_000,   // region overview
    incident: 180_000,   // fusion / STS / sanctions
    news:     300_000,   // news event city level
    alert:    250_000,   // forge alert (vessel / aircraft)
}

export async function buildAutoplayQueue(API) {
    const queue         = []
    const visitedCoords = new Set()

    const dedupeKey = (lat, lon) =>
        `${Math.round(Number(lat))},${Math.round(Number(lon))}`

    const addIfNew = (item) => {
        if (!isFinite(item.lat) || !isFinite(item.lon)) return
        const key = dedupeKey(item.lat, item.lon)
        if (visitedCoords.has(key)) return
        visitedCoords.add(key)
        queue.push(item)
    }

    try {
        // ── 1. Threat matrix — escalating and emerging first ──────────────
        const tmRaw = await fetch(`${API}/api/analytics/threat-matrix`)
            .then(r => r.ok ? r.json() : []).catch(() => [])
        const zones = Array.isArray(tmRaw) ? tmRaw : []

        zones
            .filter(z => z.is_escalating && z.lat && z.lon)
            .forEach(z => addIfNew({
                type:      'zone',
                subtype:   'escalating',
                lat:       z.lat,
                lon:       z.lon,
                altitude:  AUTOPLAY_ALTITUDES.zone,
                title:     (z.region_name || 'ZONE').toUpperCase(),
                subtitle:  `ESCALATING · +${z.trend_delta ?? 0} pts`,
                narrative: z.narrative || '',
                color:     '#FF2D2D',
                zone:      { score: z.threat_score ?? z.score ?? 0, zone_name: z.region_name },
                priority:  1,
            }))

        zones
            .filter(z => z.is_emerging && !z.is_escalating && z.lat && z.lon)
            .forEach(z => addIfNew({
                type:      'zone',
                subtype:   'emerging',
                lat:       z.lat,
                lon:       z.lon,
                altitude:  AUTOPLAY_ALTITUDES.zone,
                title:     (z.region_name || 'ZONE').toUpperCase(),
                subtitle:  `EMERGING · +${z.trend_delta ?? 0} pts`,
                narrative: z.narrative || '',
                color:     '#FF9500',
                zone:      { score: z.threat_score ?? z.score ?? 0, zone_name: z.region_name },
                priority:  2,
            }))

        // ── 2. Active fusion events ───────────────────────────────────────
        const fusionRaw = await fetch(`${API}/api/fusions?status=active`)
            .then(r => r.ok ? r.json() : []).catch(() => [])
        const fusions = Array.isArray(fusionRaw) ? fusionRaw : (fusionRaw.events || [])

        fusions
            .filter(f => f.lat && f.lon && f.status === 'active')
            .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
            .slice(0, 4)
            .forEach(f => {
                let domains = []
                try { domains = JSON.parse(f.domains || '[]') } catch (_) {}
                addIfNew({
                    type:      'fusion',
                    lat:       Number(f.lat),
                    lon:       Number(f.lon),
                    altitude:  AUTOPLAY_ALTITUDES.incident,
                    title:     (f.title || 'FUSION EVENT').toUpperCase(),
                    subtitle:  `${domains.join(' + ')} · ${Math.round((f.confidence || 0) * 100)}% confidence`,
                    narrative: f.narrative || f.subtitle || '',
                    color:     '#5856D6',
                    data:      f,
                    priority:  3,
                })
            })

        // ── 3. High-relevance forge alerts ───────────────────────────────
        const alertsRaw = await fetch(`${API}/api/forge/alerts`)
            .then(r => r.ok ? r.json() : []).catch(() => [])
        const alerts = Array.isArray(alertsRaw) ? alertsRaw : (alertsRaw.alerts || [])

        alerts
            .filter(a => a.lat && (a.lng ?? a.lon) && (a.relevance_score || 0) >= 70)
            .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
            .slice(0, 5)
            .forEach(a => {
                const rn          = a.alert_type || a.rule_name || ''
                const isSanctioned = rn.includes('Sanctioned')
                const isSTS        = rn.includes('Ship-to-Ship')
                addIfNew({
                    type:      'alert',
                    subtype:   rn,
                    lat:       Number(a.lat),
                    lon:       Number(a.lng ?? a.lon),
                    altitude:  AUTOPLAY_ALTITUDES.alert,
                    title:     (rn || 'FORGE ALERT').toUpperCase(),
                    subtitle:  a.title || a.headline || '',
                    narrative: a.description || a.body || '',
                    color:     isSanctioned ? '#FF2D2D' : isSTS ? '#FF9500' : '#34AADC',
                    data:      a,
                    priority:  isSanctioned ? 2 : 4,
                })
            })

        // ── 4. Active surge events ────────────────────────────────────────
        const surgesRaw = await fetch(`${API}/api/surge-events?limit=10`)
            .then(r => r.ok ? r.json() : []).catch(() => [])
        const surges = Array.isArray(surgesRaw) ? surgesRaw : (surgesRaw.events || [])

        surges
            .filter(s => s.lat && s.lon && s.status === 'active')
            .slice(0, 4)
            .forEach(s => addIfNew({
                type:      'surge',
                lat:       Number(s.lat),
                lon:       Number(s.lon),
                altitude:  AUTOPLAY_ALTITUDES.news,
                title:     (s.headline || 'NEWS SURGE').toUpperCase().slice(0, 50),
                subtitle:  `${s.article_count || ''} articles`,
                narrative: s.context_summary || '',
                color:     '#FF9500',
                data:      s,
                priority:  4,
            }))

        // ── 5. Tier 1 events visible on globe ────────────────────────────
        const newsRaw = await fetch(`${API}/api/v2/events?mode=events&limit=30`)
            .then(r => r.ok ? r.json() : {}).catch(() => ({}))
        const newsArr = Array.isArray(newsRaw) ? newsRaw : (newsRaw?.events || [])

        newsArr
            .filter(n => n.lat && n.lon && n.show_on_map !== false
                      && (n.tier === 1 || n.tier === '1'))
            .slice(0, 5)
            .forEach(n => addIfNew({
                type:      'news',
                lat:       Number(n.lat),
                lon:       Number(n.lon),
                altitude:  AUTOPLAY_ALTITUDES.news,
                title:     (n.event_title || n.headline || 'EVENT').toUpperCase().slice(0, 50),
                subtitle:  `${n.source_name || ''} · TIER 1`,
                narrative: n.context_summary || '',
                color:     '#FF3B30',
                data:      n,
                priority:  5,
            }))

        // ── 6. News points from snapshot (relevance ≥ 6) ────────────────
        const snapRaw = await fetch(`${API}/api/snapshot/news_points`)
            .then(r => r.ok ? r.json() : {}).catch(() => ({}))
        const snapArr = Array.isArray(snapRaw) ? snapRaw : (snapRaw?.data || [])

        snapArr
            .filter(n => isFinite(Number(n.lat)) && isFinite(Number(n.lon)) && (n.relevance || 0) >= 6)
            .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
            .slice(0, 8)
            .forEach(n => {
                const meta = n.ingested_at
                    ? `Reported ${new Date(n.ingested_at).toUTCString().slice(0, 22)}`
                    : ''
                addIfNew({
                    type:      'NEWS',
                    lat:       Number(n.lat),
                    lon:       Number(n.lon),
                    altitude:  1_200_000,
                    title:     (n.title || 'NEWS EVENT').slice(0, 60),
                    subtitle:  'INTELLIGENCE FEED',
                    narrative: meta ? `${n.title || ''}\n${meta}` : (n.title || ''),
                    color:     '#E8A838',
                    data:      n,
                    priority:  2 + (n.relevance / 10),
                })
            })

        // ── 7. Elevated stable zones (filler) ────────────────────────────
        zones
            .filter(z => (z.threat_score ?? z.score ?? 0) >= 55
                      && !z.is_emerging && !z.is_escalating
                      && z.lat && z.lon)
            .slice(0, 4)
            .forEach(z => addIfNew({
                type:      'zone',
                subtype:   'elevated',
                lat:       z.lat,
                lon:       z.lon,
                altitude:  AUTOPLAY_ALTITUDES.zone,
                title:     (z.region_name || 'ZONE').toUpperCase(),
                subtitle:  `${z.threat_level || 'HIGH'} · STABLE`,
                narrative: z.narrative || '',
                color:     '#FFCC00',
                zone:      { score: z.threat_score ?? z.score ?? 0, zone_name: z.region_name },
                priority:  6,
            }))

    } catch (e) {
        console.error('[autoplay] Queue build failed:', e)
    }

    // Sort by priority, then signal strength
    queue.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority
        const sa = a.zone?.score || a.data?.relevance_score || 50
        const sb = b.zone?.score || b.data?.relevance_score || 50
        return sb - sa
    })

    // Global overview is always the first segment
    const overview = {
        type:      'overview',
        lat:       30,
        lon:       20,
        altitude:  22_000_000,
        title:     'HORIZON WATCH',
        subtitle:  `GLOBAL INTELLIGENCE PICTURE · ${new Date().toUTCString().slice(0, 16)}`,
        narrative: `Monitoring ${queue.length} active signals across ${
            new Set(queue.map(q => q.type)).size} intelligence domains.`,
        color:     '#00D4FF',
        priority:  0,
    }

    return [overview, ...queue.slice(0, 19)]
}
