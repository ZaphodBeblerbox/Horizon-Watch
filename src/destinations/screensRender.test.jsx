// Every main screen renders without throwing. The build only checks syntax:
// a ReferenceError inside a component (Home, 2026-10-06 — state declared in
// the wrong scope) passed the build and crashed the app on load.
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import Home from "./Home.jsx"
import Assets from "./Assets.jsx"
import Settings from "./Settings.jsx"
import Analytics from "./Analytics.jsx"

describe("main screens render", () => {
    for (const [name, C] of [["Home", Home], ["Assets", Assets], ["Settings", Settings], ["Analytics", Analytics]]) {
        it(name, () => { expect(() => renderToStaticMarkup(<C />)).not.toThrow() })
    }
})
