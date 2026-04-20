const _host = typeof window !== "undefined" ? window.location.hostname : "localhost"
const _isLocal = _host === "localhost" || _host === "127.0.0.1" || _host.startsWith("192.168.") || _host.startsWith("10.")

const API_BASE = import.meta.env.VITE_API_BASE
    || (_isLocal
        ? "http://localhost:8000"
        : "https://horizon-watch-production.up.railway.app")

export default API_BASE
