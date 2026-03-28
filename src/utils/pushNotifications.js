import { getToken } from '../auth.js'
import API_BASE from '../apiBase.js'

// VAPID public key — must match the private key stored on the backend
export const VAPID_PUBLIC_KEY = 'BOpdDKol_P2lALgYu03ybXJt2CNXNgaOqf4AwUq6D0gm8lKzyK9u7U1-NU8gd427CzF4OSdHwcTIs1DCe1D4x08'

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw     = window.atob(base64)
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

/** Register service worker. Call once on app load. */
export async function initPushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return { supported: false }
    }
    try {
        const registration = await navigator.serviceWorker.register('/sw.js')
        return { supported: true, registration }
    } catch (err) {
        console.error('[push] SW registration failed:', err)
        return { supported: false, error: err }
    }
}

/** Check if currently subscribed. */
export async function getPushSubscription() {
    if (!('serviceWorker' in navigator)) return null
    try {
        const reg = await navigator.serviceWorker.ready
        return await reg.pushManager.getSubscription()
    } catch {
        return null
    }
}

/** Request permission and subscribe. Sends subscription to backend. */
export async function requestPushPermission() {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return { granted: false }

    try {
        const reg          = await navigator.serviceWorker.ready
        const subscription = await reg.pushManager.subscribe({
            userVisibleOnly:      true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        })

        await fetch(`${API_BASE}/api/push/subscribe`, {
            method:  'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
            },
            body: JSON.stringify(subscription.toJSON()),
        })

        return { granted: true, subscription }
    } catch (err) {
        console.error('[push] Subscribe failed:', err)
        return { granted: false, error: err }
    }
}

/** Unsubscribe and notify backend. */
export async function unsubscribePush() {
    try {
        const reg          = await navigator.serviceWorker.ready
        const subscription = await reg.pushManager.getSubscription()
        if (!subscription) return { success: true }

        await subscription.unsubscribe()

        await fetch(`${API_BASE}/api/push/unsubscribe`, {
            method:  'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
            },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => {})

        return { success: true }
    } catch (err) {
        console.error('[push] Unsubscribe failed:', err)
        return { success: false, error: err }
    }
}
