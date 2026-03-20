import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            "/geocode": "http://127.0.0.1:8001",
            "/events": "http://127.0.0.1:8001",
            "/analyse": "http://127.0.0.1:8001",
            "/news": "http://127.0.0.1:8001",
            "/route": "http://127.0.0.1:8001",
            "/roads": "http://127.0.0.1:8001",
            "/infrastructure": "http://127.0.0.1:8001",
            "/adsb": "http://127.0.0.1:8001",
            "/satellite": "http://127.0.0.1:8001",
            "/satellites": "http://127.0.0.1:8001",
            "/annotations": "http://127.0.0.1:8001",
            "/situations": "http://127.0.0.1:8001",
            "/chat": "http://127.0.0.1:8001",
            "/news-conflicts": "http://127.0.0.1:8001",
        },
    },
})
