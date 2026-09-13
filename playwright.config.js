import { defineConfig } from "@playwright/test"

// Real-browser regression guard for the theming system (see
// tests/e2e/theming.spec.js). Not part of `npm test` (vitest, pure-logic
// unit tests, no DOM) — run explicitly via `npm run test:e2e`. Requires a
// real backend reachable at E2E_API_BASE (default http://localhost:8000);
// the spec skips honestly, not silently, if one isn't reachable — same
// disclosed-environment-dependency pattern as this repo's own existing
// src/lib/ref.test.js.
export default defineConfig({
    testDir: "./tests/e2e",
    // beforeAll/afterAll hooks share this same timeout budget (Playwright
    // has no separate hook-timeout override) — this repo's real backend
    // does real, sometimes CPU-heavy background work against a real ~3GB
    // SQLite DB and can be transiently slow to answer even a first
    // request, so beforeAll's reachability retries + fixture-user creation
    // need real headroom, not just enough for the browser assertions.
    timeout: 150_000,
    fullyParallel: false,
    reporter: "list",
    use: {
        baseURL: process.env.E2E_BASE_URL || "http://localhost:5173",
        viewport: { width: 1440, height: 900 },
    },
    webServer: {
        command: "npm run dev",
        url: process.env.E2E_BASE_URL || "http://localhost:5173",
        reuseExistingServer: true,
        timeout: 30_000,
    },
})
