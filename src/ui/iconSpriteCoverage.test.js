/**
 * Every icon referenced anywhere must exist in the sprite.
 *
 * A missing sprite id fails SILENTLY: <use href="#i-nope"/> renders an
 * empty box, the build is clean, the tests pass and the button simply
 * has no picture on it. This is the same failure shape as calling a
 * hook without importing it, which shipped twice before hookImports
 * .test.js started catching it — and it was caught here too, on a
 * "refresh" icon that had never existed.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        const st = statSync(p)
        if (st.isDirectory()) walk(p, out)
        else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p)
    }
    return out
}

const sprite = readFileSync("src/ui/IconSprite.jsx", "utf8")
const defined = new Set(
    [...sprite.matchAll(/id="(i-[a-z0-9-]+)"/g)].map((m) => m[1]),
)

describe("icon sprite coverage", () => {
    it("defines a non-trivial number of icons", () => {
        expect(defined.size).toBeGreaterThan(40)
    })

    const files = walk("src")
    const missing = []
    for (const f of files) {
        const src = readFileSync(f, "utf8")
        for (const m of src.matchAll(/href=\{?["'`]#(i-[a-z0-9-]+)["'`]/g)) {
            if (!defined.has(m[1])) missing.push(`${f}: #${m[1]}`)
        }
    }

    it("references no icon that the sprite does not define", () => {
        expect(missing).toEqual([])
    })

    it("has an icon for every graph node type the ontology can draw", () => {
        // graph_store.NODE_TYPES, which the Ontology diagram renders as
        // i-node-<type>. A new node type with no icon draws blank.
        for (const t of ["person", "org", "faction", "vessel", "aircraft",
                         "facility", "country", "corridor", "event",
                         "equipment"]) {
            expect(defined.has(`i-node-${t}`), `missing i-node-${t}`).toBe(true)
        }
    })
})
