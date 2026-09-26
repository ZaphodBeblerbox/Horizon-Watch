import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const SRC = fileURLToPath(new URL("..", import.meta.url))

function walk(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p, out)
        else if (/\.jsx?$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p)
    }
    return out
}

const files = walk(SRC)

describe("global shortcuts cannot fire while someone is typing", () => {
    // Two real bugs this locks down. app.jsx switched modules on a BARE
    // digit behind a guard that matched the editable host but nothing
    // inside it — so typing "1" in a bold span in a document changed the
    // page. FlyoutMenu had a bare letter hotkey guarded only against INPUT
    // and TEXTAREA, so it opened a menu mid-word.

    const globalHandlers = files.filter((f) => {
        const t = readFileSync(f, "utf8")
        return /(window|document)\.addEventListener\(\s*["']keydown["']/.test(t)
    })

    it("there are global keydown handlers to check", () => {
        expect(globalHandlers.length).toBeGreaterThan(0)
    })

    it("no global handler acts on a printable key without a modifier or the guard", () => {
        // Escape and the arrows are deliberately NOT flagged: closing a
        // dialog with Escape while typing is what a reader expects, and
        // neither is something you produce writing prose. What breaks
        // writing is a letter or a digit.
        const PRINTABLE = /e\.key(?:\.toLowerCase\(\))?\s*===\s*["']([A-Za-z0-9])["']|e\.code\s*===\s*["'](?:Key[A-Z]|Digit\d)["']|Number\(e\.key\)/

        const offenders = []
        for (const f of globalHandlers) {
            const t = readFileSync(f, "utf8")
            if (!PRINTABLE.test(t)) continue                 // Escape/arrows only
            const guarded = /isTextEntry\s*\(/.test(t)
            const modifierOnly =
                /if\s*\(\s*!\s*e\.(altKey|metaKey|ctrlKey)\s*\)\s*return/.test(t) ||
                /\(\s*e\.metaKey\s*\|\|\s*e\.ctrlKey\s*\)\s*&&/.test(t)
            if (!guarded && !modifierOnly) offenders.push(f.replace(SRC, ""))
        }
        expect(offenders).toEqual([])
    })

    it("no handler switches modules on a bare digit", () => {
        const offenders = files.filter((f) => {
            const t = readFileSync(f, "utf8")
            if (!/Number\(e\.key\)/.test(t)) return false
            // The digit branch must sit behind a modifier check.
            return !/e\.metaKey\s*\|\|\s*e\.ctrlKey/.test(t)
        })
        expect(offenders.map((f) => f.replace(SRC, ""))).toEqual([])
    })
})

describe("the text-entry guard covers what the old inline checks missed", () => {
    const guard = readFileSync(join(SRC, "utils/isTextEntry.js"), "utf8")

    it("looks at ancestors, not just the event target", () => {
        expect(guard).toMatch(/closest\?\./)
    })

    it("looks at isContentEditable, not only the attribute selector", () => {
        expect(guard).toMatch(/isContentEditable/)
    })

    it("also checks the focused element", () => {
        expect(guard).toMatch(/activeElement/)
    })
})
