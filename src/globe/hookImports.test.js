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
import { readdirSync, readFileSync } from "fs"

const DIRS = ["src/globe", "src/components"]

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

function sources() {
    const out = []
    for (const dir of DIRS) {
        for (const f of readdirSync(dir)) {
            if (!f.endsWith(".jsx")) continue
            out.push([`${dir}/${f}`, stripComments(readFileSync(`${dir}/${f}`, "utf8"))])
        }
    }
    return out
}

describe("hooks called in globe and component files are imported", () => {
    for (const [path, src] of sources()) {
        it(`${path} imports every hook it calls`, () => {
            const called = new Set([...src.matchAll(/\b(use[A-Z]\w*)\s*\(/g)].map((m) => m[1]))
            if (!called.size) return
            const missing = []
            for (const hook of called) {
                // Imported by name, imported as a default, or defined here.
                const imported = new RegExp(
                    `import\\s+(\\{[^}]*\\b${hook}\\b[^}]*\\}|${hook})\\s+from`).test(src)
                const declared = new RegExp(
                    `(function|const|let)\\s+${hook}\\b`).test(src)
                if (!imported && !declared) missing.push(hook)
            }
            expect(missing, `${path} calls ${missing.join(", ")} without importing it`).toEqual([])
        })
    }
})
