import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app.jsx'
import './index.css'
import './styles/designSystem.css'
import { initPushNotifications } from './utils/pushNotifications.js'
import { registerSW } from 'virtual:pwa-register'
import { reloadOnceForStaleChunk } from './utils/staleChunkRecovery.js'
import API_BASE from './apiBase.js'
import { isDesktop } from './apiBase.js'
import { installOfflineCache, indexedDbStore, pruneCache } from './lib/offlineCache.js'
import { seedOffline, WHOLE_DATASET_PATHS } from './lib/offlineSeed.js'

// THE APP MUST OPEN WHETHER OR NOT ANYTHING ANSWERS. Installed before
// React mounts, so the very first screen's requests are covered too — a
// cache that arrives after the dashboard has already fired its fetches
// protects nothing that matters.
//
// In the desktop build the frontend itself is local (Tauri serves the
// bundled files, not the network), so this is only ever about the data:
// the last good response for each API GET is kept and served when the
// server cannot be reached.
try {
    if (typeof window !== 'undefined' && window.indexedDB) {
        const store = indexedDbStore(window.indexedDB)
        installOfflineCache({
            win: window, apiBase: API_BASE, store,
            wholePaths: WHOLE_DATASET_PATHS,
        })
        // DESKTOP ONLY, AND DELIBERATELY SO. The seed exists because a
        // packaged app has to work with no network at all. A browser tab
        // does not: it is online by definition, and if it is not, the page
        // did not load either.
        //
        // Running it everywhere was actively harmful. Every web visitor
        // pulled 23 MB and made the server serialise 49,000 airports to do
        // it, which is a self-inflicted load spike on the same backend
        // whose stability is the point of this work.
        if (isDesktop()) {
            // Deferred past first paint: 23 MB competing with the first
            // screen's own requests would make the app feel broken in
            // order to make it work later.
            setTimeout(() => {
                seedOffline({ apiBase: API_BASE, store }).catch(() => {})
            }, 4000)
        }
        // Sweep what is past its usable age on launch rather than on a
        // timer — a desktop app can sit closed for a week.
        pruneCache(store).catch(() => {})
    }
} catch (e) {
    // A webview with storage disabled still gets a working app, just
    // without the cache.
    console.warn('[offline] cache unavailable:', e?.message || e)
}
if (typeof window !== 'undefined') window.__parallaxDesktop = isDesktop()

// Register service worker and listen for notification-click messages.
//
// NOT IN THE PACKAGED APP. Tauri serves the frontend from tauri://localhost,
// where service workers do not exist — navigator.serviceWorker is absent or
// refuses to register. There is also nothing for one to do there: the
// assets are already local, which is the only thing the SW was caching.
try {
    if (!isDesktop()) {
        initPushNotifications().then(({ supported }) => {
            if (!supported) return
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data?.type === 'NOTIFICATION_CLICK' && event.data.eventId) {
                    window.dispatchEvent(new CustomEvent('akili:open-alert', {
                        detail: { id: event.data.eventId },
                    }))
                }
            })
        }).catch((e) => console.warn('[push] unavailable:', e?.message || e))
    }
} catch (e) {
    console.warn('[push] unavailable:', e?.message || e)
}

// Real service-worker update-check wiring (stale-chunk-404 fix). The old
// injectRegister:'auto' script only ever registered the SW once on load —
// no periodic re-check, no forced activation. This is the real fix:
// register immediately, poll for a new SW every 30 minutes AND whenever
// the tab regains focus (catches the common "left a tab open overnight"
// case the browser's own ~24h native check cadence was too slow for), and
// when a new version is found, activate it and reload immediately — one
// fast automatic refresh, never a silent multi-minute stale hang.
//
// The activate-and-reload step is done directly against the real
// ServiceWorkerRegistration/postMessage/controllerchange primitives
// (the documented, standard Workbox "manual update" recipe) rather than
// through registerSW()'s own returned updateSW(true) helper — live testing
// found that helper's reload did not reliably fire in this app's build
// (generateSW mode + registerType:'prompt'); this direct version was
// verified live (real rebuild, real registration.update(), real
// controllerchange, real reload observed) before being kept.
let swRegistration = null
function activateWaitingWorkerAndReload() {
    const waiting = swRegistration?.waiting
    if (!waiting) return
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
    waiting.postMessage({ type: 'SKIP_WAITING' })
}
// THIS RUNS AT MODULE SCOPE, SO IT MUST NOT THROW. It used to be a bare
// call: in the packaged app, where the page is served from tauri://
// localhost and service workers do not exist, a throw here meant
// ReactDOM.render() below never ran and the window came up blank with no
// error anywhere a user could see. A window that renders nothing is the
// worst failure mode available, and it was one unguarded call away.
//
// Skipped entirely on desktop — there is no service worker to register and
// nothing for it to cache, because the assets are already on disk.
try {
    if (!isDesktop()) {
        registerSW({
            immediate: true,
            onNeedRefresh() {
                activateWaitingWorkerAndReload()
            },
            onRegisteredSW(_swUrl, registration) {
                if (!registration) return
                swRegistration = registration
                if (registration.waiting) activateWaitingWorkerAndReload()
                const check = () => registration.update().catch(() => {})
                setInterval(check, 30 * 60 * 1000)
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') check()
                })
            },
            onRegisterError(err) {
                console.error('[sw] registration failed:', err)
            },
        })
    }
} catch (e) {
    console.warn('[sw] registration unavailable:', e?.message || e)
}

window.onerror = function(msg, src, line, col, err) {
  console.error('GLOBAL CRASH:', msg, 'at', src, line, col)
  console.error('Stack:', err?.stack)
  if (reloadOnceForStaleChunk(msg)) return true
  return false
}
window.onunhandledrejection = function(e) {
  console.error('UNHANDLED PROMISE:', e.reason)
  reloadOnceForStaleChunk(e.reason?.message || String(e.reason))
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, componentStack: null }
  }
  static getDerivedStateFromError(err) {
    return { error: err }
  }
  componentDidCatch(err, info) {
    console.error('=== REACT CRASH ===', err)
    console.error('=== COMPONENT STACK ===', info.componentStack)
    this.setState({ componentStack: info.componentStack })
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, background: '#0a0e14', overflow: 'auto',
          fontFamily: 'monospace', color: '#e8edf2', padding: 24,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ef4444', marginBottom: 12 }}>
            App crashed
          </div>
          <div style={{ fontSize: 13, color: '#f97316', marginBottom: 16 }}>
            {this.state.error?.message}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
            Error stack:
          </div>
          <pre style={{ fontSize: 10, color: '#4a6080', marginBottom: 20, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {this.state.error?.stack}
          </pre>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
            Component stack (screenshot this):
          </div>
          <pre style={{ fontSize: 11, color: '#fbbf24', whiteSpace: 'pre-wrap', lineHeight: 1.6, marginBottom: 24 }}>
            {this.state.componentStack}
          </pre>
          <button
            onClick={() => { localStorage.removeItem('akili_tabs'); window.location.reload() }}
            style={{ padding: '8px 20px', background: '#0d9488', border: 'none', borderRadius: 4, color: '#fff', fontSize: 13, cursor: 'pointer' }}
          >
            Clear tabs + reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <ErrorBoundary><App /></ErrorBoundary>
)
