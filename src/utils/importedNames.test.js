/**
 * You may not use a name that another module exports without importing it.
 *
 * WHY THIS EXISTS. There is no ESLint in this project, so `no-undef`
 * never runs, and an identifier that is simply not defined produces a
 * clean build, a passing test suite, and a component that throws the
 * moment it renders. That has now shipped three times: `<Icon>` in
 * Situation, `useRef` in the AIS layer, and `detectionCorners` in the
 * overwatch layer.
 *
 * hookImports.test.js already covers the hook-shaped version of this.
 * This is the general one, kept deliberately narrow to stay free of
 * false positives: it only complains about an identifier that some
 * module in src/ actually exports, that this file uses, and that this
 * file neither imports nor defines itself. That is precisely the
 * "forgot the import" mistake and almost nothing else.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, basename } from "node:path"

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.jsx?$/.test(name)) out.push(p)
    }
    return out
}

/** Comments and string/template literals removed, so prose cannot match. */
function stripNoise(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
        .replace(/`(?:[^`\\]|\\[\s\S])*`/g, "``")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
}

const files = walk("src")

// Every named export in the project, and where it came from.
const exportedBy = new Map()
for (const f of files) {
    const src = stripNoise(readFileSync(f, "utf8"))
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) {
        if (!exportedBy.has(m[1])) exportedBy.set(m[1], f)
    }
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
        for (const part of m[1].split(",")) {
            const name = part.trim().split(/\s+as\s+/).pop()?.trim()
            if (name && /^[A-Za-z_$][\w$]*$/.test(name) && !exportedBy.has(name)) {
                exportedBy.set(name, f)
            }
        }
    }
}

describe("no use of another module's export without importing it", () => {
    it("found the project's exports", () => {
        expect(exportedBy.size).toBeGreaterThan(50)
    })

    const offenders = []
    for (const f of files) {
        if (/\.test\.jsx?$/.test(f)) continue
        const raw = readFileSync(f, "utf8")
        const src = stripNoise(raw)

        const imported = new Set()
        for (const m of src.matchAll(/import\s+([\s\S]*?)\s+from\s*['"`]/g)) {
            for (const part of m[1].replace(/[{}]/g, ",").split(",")) {
                const name = part.trim().split(/\s+as\s+/).pop()?.trim()
                if (name && /^[A-Za-z_$][\w$]*$/.test(name)) imported.add(name)
            }
        }
        // Anything this file declares for itself, at any depth.
        const declared = new Set()
        // Local bindings of every shape, because a name bound locally is
        // not a missing import — including the ones that made the first
        // version of this test cry wolf: `useState` pairs, destructured
        // props, Promise callbacks and arrow parameters.
        for (const re of [
            /(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
            /(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
            /class\s+([A-Za-z_$][\w$]*)/g,
            /(?:const|let|var)\s*\{([^}]*)\}/g,
            /(?:const|let|var)\s*\[([^\]]*)\]/g,
            /\(([^()]*)\)\s*=>/g,
            /(?:async\s+)?function\s*\*?\s*[A-Za-z_$][\w$]*\s*\(([^()]*)\)/g,
            /\b([A-Za-z_$][\w$]*)\s*=>/g,
            /catch\s*\(([^()]*)\)/g,
        ]) {
            for (const m of src.matchAll(re)) {
                for (const part of m[1].split(",")) {
                    // Strip destructuring punctuation, rest syntax and
                    // default values: a parameter written `{ open }` or
                    // `...rest` or `x = 1` still binds the name locally.
                    const name = part
                        .split(":").pop()
                        .replace(/=[\s\S]*$/, "")
                        .replace(/[{}[\]().]/g, " ")
                        .replace(/\.\.\./g, " ")
                        .trim()
                    if (name && /^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name)
                }
            }
        }

        for (const [name, origin] of exportedBy) {
            if (origin === f) continue
            if (imported.has(name) || declared.has(name)) continue
            // A CALL `name(`, or a JSX ELEMENT `<Name`. The first
            // version of this accepted `name<` too, which matched the
            // JSX text in `>open</button>` and reported four
            // non-existent problems — a guard that cries wolf is worse
            // than no guard, because it gets switched off.
            // No space before the paren: every JS style in use writes a
            // call as `name(`, while JSX prose reads "advance (stage →
            // stage)" with one. That space is what separates code from
            // text here without parsing JSX properly.
            const call = new RegExp(`(^|[^.\\w$])${name}\\(`).test(src)
            // A JSX component is capitalised by React's own rule; a
            // lowercase tag is HTML, and <label> collided with an
            // exported helper called label.
            const element = /^[A-Z]/.test(name)
                && new RegExp(`<${name}[\\s/>]`).test(src)
            const used = call || element
            if (used) offenders.push(`${f}: ${name} (exported by ${basename(origin)})`)
        }
    }

    it("no file uses an unimported export", () => {
        expect(offenders).toEqual([])
    })
})
