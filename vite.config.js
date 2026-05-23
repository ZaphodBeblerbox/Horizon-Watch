import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            workbox: {
                // Exclude large Cesium bundles from precache — they'd blow the 2 MiB limit
                globPatterns: ['**/*.{css,html,ico,png,svg,woff2}'],
                globIgnores: ['**/cesium/**', '**/Viewer-*.js', '**/Cesium-*.js'],
                maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
                skipWaiting: false,
                clientsClaim: false,
                runtimeCaching: [
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
                name: 'Horizon Watch',
                short_name: 'HorizonWatch',
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
