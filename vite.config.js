import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

// Real package.json version, exposed for the new top bar's subtitle and the
// status bar's build string (redesign Round 2 — "real build/version string,
// real not fabricated") — never a hand-typed literal that can drift from
// the actual package version.
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version

export default defineConfig({
    define: {
        __APP_VERSION__: JSON.stringify(pkgVersion),
    },
    plugins: [
        react(),
        VitePWA({
            // Real root-cause fix (stale-chunk-404 + multi-minute-hang
            // prompt), two real, compounding bugs found and fixed together:
            //
            // 1) injectRegister:'auto' (the default) injected a bare-bones
            //    registerSW.js doing ONE navigator.serviceWorker.register()
            //    on window load and nothing else — no periodic update
            //    check, no onNeedRefresh/forced-activation handling. The
            //    app never imported vite-plugin-pwa's own richer
            //    virtual:pwa-register client helper (confirmed via a
            //    repo-wide grep), so nothing ever re-checked for a new
            //    worker beyond the browser's own slow, non-deterministic
            //    native cadence. Fixed: injectRegister:false here, and
            //    src/main.jsx now imports virtual:pwa-register directly,
            //    polling every 30 min + on tab-focus.
            // 2) registerType:'autoUpdate' presets the generated service
            //    worker itself to call self.skipWaiting()/clientsClaim()
            //    unconditionally on install — confirmed directly (built
            //    dist/sw.js and inspected it). That races against a
            //    client-driven onNeedRefresh flow: the new worker can
            //    finish activating on its own, silently, before the page's
            //    own JS ever observes a "waiting" worker to report —
            //    onNeedRefresh then never fires, clientsClaim() hands the
            //    new worker control in the background with no reload, and
            //    the already-loaded (stale) page just keeps running old
            //    code until some unrelated future navigation. Confirmed
            //    live: with registerType:'autoUpdate', a real rebuild-and-
            //    registration.update() test left an open tab NOT reloading
            //    at all. Fixed: 'prompt' (vite-plugin-pwa's other real
            //    registerType) leaves the generated SW's own skipWaiting/
            //    clientsClaim behavior to the real workbox.skipWaiting/
            //    clientsClaim settings below (both false) — only this
            //    app's own onNeedRefresh -> updateSW(true) call now tells a
            //    waiting worker to activate, so the client-driven reload
            //    this prompt asks for ("at most one fast automatic
            //    refresh") actually gets a chance to run.
            registerType: 'prompt',
            injectRegister: false,
            workbox: {
                // HTML IS DELIBERATELY NOT PRECACHED.
                //
                // Precaching index.html is what produced the stale-chunk
                // 404 in production: the worker served an old index.html
                // from cache, that HTML referenced a hashed bundle the
                // current deploy no longer has, and because skipWaiting
                // and clientsClaim are both false below, a long-lived tab
                // kept that worker — and therefore that HTML — for as
                // long as it stayed open. Reloading could not help,
                // because the reload was answered by the same worker with
                // the same cached HTML.
                //
                // The app shell is worth nothing offline anyway: this is a
                // live intelligence picture, and an offline shell can only
                // ever show an empty globe. Letting navigation go to the
                // network means the HTML is always the deploy's own.
                //
                // Exclude large Cesium bundles too — they'd blow the limit.
                globPatterns: ['**/*.{css,ico,png,svg,woff2}'],
                // AND THEREFORE NO NAVIGATION FALLBACK. vite-plugin-pwa
                // registers a NavigationRoute bound to index.html through
                // createHandlerBoundToURL, which resolves its URL FROM THE
                // PRECACHE. With the shell no longer precached that call
                // throws at runtime and takes navigation down with it —
                // strictly worse than the stale shell it replaced. Checked
                // in the built sw.js, not assumed.
                navigateFallback: null,
                globIgnores: ['**/cesium/**', '**/Viewer-*.js', '**/Cesium-*.js'],
                maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
                skipWaiting: false,
                clientsClaim: false,
                // Real, one-time, version-gated recovery for browsers whose
                // ALREADY-INSTALLED service worker predates this registerType:
                // 'prompt' fix (Round 2 stale-registerSW.js investigation) —
                // see public/sw-recovery.js's own docstring for the full real
                // root cause and why this is bounded/safe, not a return to the
                // skipWaiting/clientsClaim race this config just above moved
                // away from. Runs inside the SAME generated SW via workbox's
                // own importScripts, so it reaches an old tab with zero
                // cooperation from whatever (old, code-less) JS it's running.
                // sw-push.js: showing a push with the app closed (the generated
                // worker replaces public/sw.js, where these handlers used to be).
                importScripts: ['/sw-recovery.js', '/sw-push.js'],
                runtimeCaching: [
                    {
                        // CESIUM, CACHED AS IT IS USED rather than precached.
                        // It is excluded from the precache above on purpose —
                        // 22 MB of workers and assets would be downloaded
                        // before the app could start for the first time. But
                        // excluded from BOTH caches it was never available
                        // offline at all in the browser build, so the globe
                        // could not start on a second visit without a network.
                        // CacheFirst because these files are immutable: a
                        // given Cesium build's worker never changes, and a new
                        // version arrives under a new path.
                        urlPattern: ({ url }) => url.pathname.startsWith('/cesium/'),
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'cesium-assets',
                            expiration: {
                                // Generous on count because Cesium's own build
                                // is ~390 files, and long on age because they
                                // do not change within a version.
                                maxEntries: 500,
                                maxAgeSeconds: 60 * 60 * 24 * 90,
                            },
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                    {
                        urlPattern: /\/api\/(strategic-zones|chokepoints|cables|rules|watch-zones)/,
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'static-api-cache',
                            expiration: {
                                maxAgeSeconds: 60 * 60 * 24,
                            },
                        },
                    },
                    {
                        urlPattern: /\/api\/(alerts|fusions|assessments|v2\/events)/,
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'live-api-cache',
                            expiration: {
                                maxAgeSeconds: 60 * 5,
                            },
                            networkTimeoutSeconds: 3,
                        },
                    },
                ],
            },
            manifest: {
                name: 'Parallax',
                short_name: 'Parallax',
                theme_color: '#0a1220',
                background_color: '#0a1220',
                display: 'standalone',
                icons: [
                    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
                ],
            },
        }),
    ],
    build: {
        sourcemap: true,
    },
    test: {
        environment: "node",
        include: ["src/**/*.test.{js,jsx}"],
    },
    optimizeDeps: {
        include: ["leaflet.vectorgrid"],
    },
    server: {
        proxy: {
            "/api": "http://127.0.0.1:8000",
            "/geocode": "http://127.0.0.1:8000",
            "/events": "http://127.0.0.1:8000",
            "/analyse": "http://127.0.0.1:8000",
            "/news": "http://127.0.0.1:8000",
            "/route": "http://127.0.0.1:8000",
            "/roads": "http://127.0.0.1:8000",
            "/infrastructure": "http://127.0.0.1:8000",
            "/adsb": "http://127.0.0.1:8000",
            "/satellite": "http://127.0.0.1:8000",
            "/satellites": "http://127.0.0.1:8000",
            "/annotations": "http://127.0.0.1:8000",
            "/situations": "http://127.0.0.1:8000",
            "/chat": "http://127.0.0.1:8000",
            "/news-conflicts": "http://127.0.0.1:8000",
        },
    },
})
