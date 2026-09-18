import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const gen = readFileSync(path.join(dir, "Generate.jsx"), "utf8")

describe("§S4.2 — three panes, and the middle one is the argument", () => {
    it("lays out parameters | evidence set | generation", () => {
        expect(gen).toMatch(/gridTemplateColumns: "\d+px 1fr \d+px"/)
    })

    it("makes the evidence set explicit and editable", () => {
        // "A generator with a prompt box and a button produces text nobody
        // can audit."
        expect(gen).toMatch(/select top 12 by severity/)
        expect(gen).toMatch(/setSelected/)
    })
})

describe("§S4.4 — the basket pre-selects into the evidence set", () => {
    it("actually reads the basket, not just its count", () => {
        // getBriefingItems was imported and never called: the count was shown
        // beside an evidence set it had no effect on, so every "add to
        // basket" in the product was a dead end that looked like it worked.
        expect(gen).toMatch(/getBriefingItems\(\)/)
    })

    it("selects the basket's items rather than adding them to everything", () => {
        expect(gen).toMatch(/hits\.includes\(it\)/)
    })
})

describe("§S4.3 — the document sections", () => {
    it("carries the spec's six sections", () => {
        for (const label of [
            "Executive judgement", "Signal-by-signal assessment",
            "Exposure and continuity impact", "Indicators and warnings",
            "Recommended actions", "Sourcing and method",
        ]) expect(gen).toContain(label)
    })

    it("defaults Sourcing and method ON and warns when it is turned off", () => {
        // "A brief that cannot say where it came from is not shorter, it is
        // weaker."
        expect(gen).toMatch(/DOC_SECTIONS\.map\(\(s\) => \[s\.key, true\]\)/)
        expect(gen).toMatch(/cannot say where it came from/)
    })

    it("sends the chosen sections with the draft", () => {
        expect(gen).toMatch(/sections: DOC_SECTIONS\.filter/)
    })

    it("keeps document sections and evidence domains as separate questions", () => {
        // They shared the word "Sections": what the brief contains, and what
        // it may be written from, are not the same choice.
        expect(gen).toMatch(/Evidence domains/)
        expect(gen).toMatch(/DOC_SECTIONS/)
        expect(gen).toMatch(/SECTION_TOGGLES/)
    })
})

describe("§S4.5 — named stages, not a spinner", () => {
    it("runs the spec's seven stages in order", () => {
        expect(gen).toMatch(/"Resolve parameters and scope", "Assemble evidence set", "Deduplicate and cluster signals"/)
        expect(gen).toMatch(/"Score exposure against asset register", "Draft judgement and section text"/)
        expect(gen).toMatch(/"Apply house style and classification", "Compile document and paginate"/)
    })

    it("records a real elapsed time per stage", () => {
        // "A progress bar says 'wait', a stage list says what it is doing and
        // therefore what it would mean if it stalled."
        expect(gen).toMatch(/setStepStatus\(\d, "done", nowMs\(\) - t\d\)/)
    })
})
