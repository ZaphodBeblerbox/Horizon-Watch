import API_BASE from "./apiBase.js"

const TOKEN_KEY = "hw-auth-token"

export function getToken() {
    return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
    localStorage.removeItem(TOKEN_KEY)
}

export function authHeaders() {
    const token = getToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function apiFetch(path, options = {}) {
    const { _timeout = 12000, ...fetchOptions } = options
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), _timeout)
    try {
        const res = await fetch(`${API_BASE}${path}`, {
            ...fetchOptions,
            headers: {
                "Content-Type": "application/json",
                ...authHeaders(),
                ...(fetchOptions.headers || {}),
            },
            signal: controller.signal,
        })
        return res
    } catch (err) {
        if (err.name === "AbortError") {
            throw new Error("Request timed out — check your connection")
        }
        throw err
    } finally {
        clearTimeout(timer)
    }
}
