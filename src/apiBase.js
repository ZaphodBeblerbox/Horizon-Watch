const API_BASE = import.meta.env.VITE_API_BASE
    || (typeof window !== "undefined" && window.location.hostname !== "localhost"
        ? "https://horizon-watch-production.up.railway.app"
        : "http://localhost:8000")

export default API_BASE
