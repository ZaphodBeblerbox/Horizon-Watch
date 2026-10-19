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
    // A WARNING sent by hand (backend/asset_warnings.py): above everything —
    // an open page takes the whole screen with its alarm (src/warnings/), and
    // the system notification stays until touched, buzzes long and strong
    // where the device can, and has a tag of its own so a reminder shows again.
    const warning = data.kind === 'warning'
    event.waitUntil((async () => {
        const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true })
        if (warning) wins.forEach((w) => w.postMessage({ type: 'WARNING', id: data.warning_id || data.id }))
        // On iPhone a push that shows nothing counts against the site and
        // Safari cancels the subscription after a few: there it always shows.
        const ios = /iPhone|iPad|iPod/.test(self.navigator?.userAgent || '')
        if (!ios && wins.some((w) => w.focused && w.visibilityState === 'visible')) {
            wins.forEach((w) => w.postMessage({ type: 'PUSH_WHILE_OPEN', id: data.id }))
            return
        }
        // The system names the app beside the X ("from Parallax"), so the
        // title says what KIND of notification it is and the text under it
        // carries the headline and context (event_watch.label_for/body_for).
        const title = data.title && data.title !== 'Parallax' ? data.title : 'Notification'
        await self.registration.showNotification(title, {
            body: data.body || '',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: warning ? `warning-${data.warning_id || data.id}` : (data.id || 'parallax'),
            renotify: true,
            silent: false,                  // the system's notification sound
            requireInteraction: critical || warning,
            vibrate: warning ? [1000, 250, 1000, 250, 1000, 250, 1000] : critical ? [300, 100, 300, 100, 300] : [200, 100, 200],
            data: { url: data.url || '/', eventId: data.id, lat: data.lat, lon: data.lon,
                    livestreamId: data.livestream_id || null, assetId: data.asset_id || null, headline: data.body || '',
                    routePlanId: data.route_plan_id || null,
                    // a vessel of concern opens on the vessel itself (src/notify/openSignal.js)
                    mmsi: data.mmsi || null, alertType: data.alert_type || null,
                    // a message opens its conversation, a desk post the desk at it
                    kind: data.kind || null, conversationId: data.conversation_id || null, postId: data.post_id || null },
        })
    })())
})

self.addEventListener('notificationclick', (event) => {
    event.notification.close()
    const d = event.notification.data || {}
    event.waitUntil((async () => {
        const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true })
        const msg = { type: 'NOTIFICATION_CLICK', eventId: d.eventId, lat: d.lat, lon: d.lon,
                      livestreamId: d.livestreamId, assetId: d.assetId, headline: d.headline, routePlanId: d.routePlanId || null,
                      mmsi: d.mmsi || null, alertType: d.alertType || null,
                      kind: d.kind || null, conversationId: d.conversationId || null, postId: d.postId || null }
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
        if (d.routePlanId) p.set('plan', d.routePlanId)
        if (d.mmsi) p.set('vessel', d.mmsi)
        if (d.alertType) p.set('type', d.alertType)
        if (d.conversationId) p.set('chat', d.conversationId)
        if (d.kind === 'desk' && d.postId) p.set('deskpost', d.postId)
        if (d.headline) p.set('h', d.headline.slice(0, 160))
        if (clients.openWindow) await clients.openWindow(`/${p.toString() ? `?${p}` : ''}`)
    })())
})
