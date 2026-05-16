import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
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
