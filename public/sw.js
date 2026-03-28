// Horizon Watch — Service Worker
// Handles push notifications and offline caching

const CACHE_NAME = 'horizon-watch-v1'

self.addEventListener('install', (event) => {
    self.skipWaiting()
})

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim())
})

// Push notification received
self.addEventListener('push', (event) => {
    let data = { title: 'Horizon Watch', body: 'New intelligence alert' }

    if (event.data) {
        try {
            data = event.data.json()
        } catch {
            data.body = event.data.text()
        }
    }

    const isCritical = data.severity === 'critical'

    const options = {
        body:               data.body || data.headline || 'New alert',
        icon:               '/icon-192.png',
        badge:              '/icon-192.png',
        vibrate:            isCritical ? [300, 100, 300, 100, 300] : [200, 100, 200],
        tag:                data.id || 'horizon-alert',
        renotify:           true,
        requireInteraction: isCritical,
        silent:             false,
        data: {
            url:     data.url || '/',
            eventId: data.id,
        },
        actions: [
            { action: 'view',    title: 'View' },
            { action: 'dismiss', title: 'Dismiss' },
        ],
    }

    event.waitUntil(
        self.registration.showNotification(
            data.title || 'Horizon Watch',
            options
        )
    )
})

// Notification clicked
self.addEventListener('notificationclick', (event) => {
    event.notification.close()

    if (event.action === 'dismiss') return

    const targetUrl = event.notification.data?.url || '/'

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(windowClients => {
                // Focus existing tab if open
                for (const client of windowClients) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        client.focus()
                        client.postMessage({
                            type:    'NOTIFICATION_CLICK',
                            eventId: event.notification.data?.eventId,
                        })
                        return
                    }
                }
                // Otherwise open a new window
                if (clients.openWindow) {
                    return clients.openWindow(targetUrl)
                }
            })
    )
})
