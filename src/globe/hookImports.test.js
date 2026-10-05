/**
 * Every hook a globe layer calls must actually be imported.
 *
 * WHY THIS EXISTS. This failure compiles perfectly and then throws
 * ReferenceError on first render, which unmounts the globe — a clean
 * build and a dead map. It has happened twice in one sitting: an <Icon>
 * component that file never imported, and a useRef added to the AIS
 * layer without touching its import line. Neither the build nor any
 * behavioural test caught either one; both were found by eye, and the
 * second only because the first had made me suspicious.
 *
 * A grep is a poor substitute for type checking, but it costs nothing
 * and it closes exactly the hole these two fell through.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"

/* ALL OF src/, NOT TWO FOLDERS.
   This was scoped to the two directories where it had caught something,
   which meant it did not look at src/destinations — and a `useCallback`
   added to Constellation without touching its import line shipped a
   ReferenceError that blanked the screen on open. The hole this test
   exists to close was only ever closed over a third of the tree. */
const ROOT = "src"

/**
 * Comments are stripped first. Three files in this repo explain in
 * prose that they deliberately "do not assume useCesium() context",
 * and a scanner that reads its own documentation as code reports the
 * opposite of the truth about them.
 */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
}

function sources(dir = ROOT, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { sources(p, out); continue }
        // .jsx only: hooks live in components, and a .js helper that calls
        // one is already a different kind of mistake.
        if (!name.endsWith(".jsx") || name.includes(".test.")) continue
        out.push([p, stripComments(readFileSync(p, "utf8"))])
    }
    return out
}

describe("every hook a component calls is imported", () => {
    for (const [path, src] of sources()) {
        it(`${path} imports every hook it calls`, () => {
            const called = new Set([...src.matchAll(/\b(use[A-Z]\w*)\s*\(/g)].map((m) => m[1]))
            if (!called.size) return
            const missing = []
            for (const hook of called) {
                /* Imported by name, as a default, or defined here.
                   The brace group may follow a default import —
                   `import Viewer, { useViewerScale } from "..."` — which the
                   earlier pattern missed because it required the brace to
                   come straight after `import`. That reported two correctly
                   imported hooks in sceneComparison.jsx as missing the
                   moment this test was widened past its original two
                   folders. */
                const imported = new RegExp(
                    `import\\s+[^;]*?(\\{[^}]*\\b${hook}\\b[^}]*\\}|\\b${hook}\\b)[^;]*?\\s+from`)
                    .test(src)
                const declared = new RegExp(
                    `(function|const|let)\\s+${hook}\\b`).test(src)
                if (!imported && !declared) missing.push(hook)
            }
            expect(missing, `${path} calls ${missing.join(", ")} without importing it`).toEqual([])
        })
    }
})
