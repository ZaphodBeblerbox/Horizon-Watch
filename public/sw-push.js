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
        if (wins.some((w) => w.focused && w.visibilityState === 'visible')) {
            wins.forEach((w) => w.postMessage({ type: 'PUSH_WHILE_OPEN', id: data.id }))
            return
        }
        await self.registration.showNotification(data.title || 'Parallax', {
            body: data.body || '',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: data.id || 'parallax',
            renotify: true,
            requireInteraction: critical,
            vibrate: critical ? [300, 100, 300, 100, 300] : [200, 100, 200],
            data: { url: data.url || '/', eventId: data.id, lat: data.lat, lon: data.lon },
        })
    })())
})

self.addEventListener('notificationclick', (event) => {
    event.notification.close()
    const d = event.notification.data || {}
    event.waitUntil((async () => {
        const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true })
        const msg = { type: 'NOTIFICATION_CLICK', eventId: d.eventId, lat: d.lat, lon: d.lon }
        for (const w of wins) {
            if (w.url.startsWith(self.location.origin) && 'focus' in w) {
                await w.focus()
                w.postMessage(msg)
                return
            }
        }
        // Closed: open it where the notification points.
        const q = Number.isFinite(d.lat) && Number.isFinite(d.lon) ? `?focus=${d.lat},${d.lon}` : ''
        if (clients.openWindow) await clients.openWindow(`/${q}`)
    })())
})
