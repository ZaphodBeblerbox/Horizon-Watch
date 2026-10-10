// sw-push.js — notifications that arrive with Parallax closed.
//
// Imported by the generated service worker (vite.config.js importScripts).
// The handlers used to live in public/sw.js, which the build REPLACES with
// the generated worker, so the shipped worker had no push handler at all:
// a push reached the browser and nothing was ever shown.
//
// The server (backend/event_watch.sweep) pushes what would have popped up
// on screen with the app open, once per card. If a Parallax window is
// already in front of the reader, the app shows it itself; a second OS
// notification on top would only repeat it.

self.addEventListener('push', (event) => {
    let data = { title: 'Parallax', body: '' }
    if (event.data) {
        try { data = event.data.json() } catch { data.body = event.data.text() }
    }
    const critical = data.severity === 'critical' || data.kind === 'live'
    event.waitUntil((async () => {
        const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true })
        // On iPhone a push that shows nothing counts against the site and
        // Safari cancels the subscription after a few: there it always shows.
        const ios = /iPhone|iPad|iPod/.test(self.navigator?.userAgent || '')
        if (!ios && wins.some((w) => w.focused && w.visibilityState === 'visible')) {
            wins.forEach((w) => w.postMessage({ type: 'PUSH_WHILE_OPEN', id: data.id }))
            return
        }
        // The Parallax X and the headline (event_watch.bundle). The system
        // already names the app beside the icon ("from Parallax"), so the
        // title is the headline itself, not "Parallax" a second time.
        const headline = data.body || data.title || 'Parallax'
        await self.registration.showNotification(headline, {
            body: '',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: data.id || 'parallax',
            renotify: true,
            silent: false,                  // the system's notification sound
            requireInteraction: critical,
            vibrate: critical ? [300, 100, 300, 100, 300] : [200, 100, 200],
            data: { url: data.url || '/', eventId: data.id, lat: data.lat, lon: data.lon,
                    livestreamId: data.livestream_id || null, assetId: data.asset_id || null, headline: data.body || '' },
        })
    })())
})

self.addEventListener('notificationclick', (event) => {
    event.notification.close()
    const d = event.notification.data || {}
    event.waitUntil((async () => {
        const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true })
        const msg = { type: 'NOTIFICATION_CLICK', eventId: d.eventId, lat: d.lat, lon: d.lon,
                      livestreamId: d.livestreamId, assetId: d.assetId, headline: d.headline }
        for (const w of wins) {
            if (w.url.startsWith(self.location.origin) && 'focus' in w) {
                await w.focus()
                w.postMessage(msg)
                return
            }
        }
        // Closed: open Parallax on the signal itself (src/main.jsx reads these).
        const p = new URLSearchParams()
        if (d.eventId) p.set('signal', d.eventId)
        if (Number.isFinite(d.lat) && Number.isFinite(d.lon)) p.set('focus', `${d.lat},${d.lon}`)
        if (d.livestreamId) p.set('live', d.livestreamId)
        if (d.assetId) p.set('asset', d.assetId)
        if (d.headline) p.set('h', d.headline.slice(0, 160))
        if (clients.openWindow) await clients.openWindow(`/${p.toString() ? `?${p}` : ''}`)
    })())
})
