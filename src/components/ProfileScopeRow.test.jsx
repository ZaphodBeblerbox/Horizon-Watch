import { describe, it, expect, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("../state/settingsStore.js", () => ({
    getSettings: () => ({ interests: { countries: ["France"] } }),
    subscribeSettings: () => () => {},
    updateSetting: () => {},
}))
vi.mock("../auth.js", () => ({ apiFetch: () => Promise.resolve({ ok: false }) }))

import ProfileScopeRow, { scopeLine, withSwitch } from "./ProfileScopeRow.jsx"

const Row = ({ label, hint, children }) => <div><b>{label}</b><i>{hint}</i>{children}</div>
const Toggle = ({ value }) => <button aria-pressed={value}>toggle</button>

describe("scopeLine", () => {
    it("says how much is held back, from the server's counts", () => {
        expect(scopeLine({ has_profile: true, hidden: 37, counts: { signals: 30, telegram: 7 } }, true))
            .toBe("37 items outside your profile hidden (30 signals, 7 Telegram reports).")
        expect(scopeLine({ has_profile: true, hidden: 1, counts: { signals: 1 } }, true)).toBe("1 item outside your profile hidden (1 signal).")
        expect(scopeLine({ has_profile: true, hidden: 0 }, true)).toBe("Nothing is held back right now.")
    })
    it("says everything is shown when off, and tells a new account how to set a profile", () => {
        expect(scopeLine({ has_profile: true, hidden: 9 }, false)).toBe("Showing everything, wherever it happens.")
        expect(scopeLine({ has_profile: false, hint: "Add a theater" }, true)).toBe("Add a theater")
    })
})

describe("the switch", () => {
    it("is on by default and named plainly", () => {
        const html = renderToStaticMarkup(<ProfileScopeRow Row={Row} Toggle={Toggle} />)
        expect(html).toContain("Only show what matches my profile")
        expect(html).toContain('aria-pressed="true"')
    })
    it("is stored as interests.onlyMine beside what the user already chose", () => {
        expect(withSwitch({ countries: ["France"] }, false)).toEqual({ countries: ["France"], onlyMine: false })
        expect(withSwitch({ onlyMine: false, topics: ["cyber"] }, true)).toEqual({ onlyMine: true, topics: ["cyber"] })
    })
})
