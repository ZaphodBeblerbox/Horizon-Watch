import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const SRC = readFileSync(fileURLToPath(new URL("./Ontology.jsx", import.meta.url)), "utf8")
const ORBAT = readFileSync(fileURLToPath(new URL("./OntologyOrbat.jsx", import.meta.url)), "utf8")

describe("every selection kind is handled", () => {
    // Selecting an ORBAT formation crashed the inspector. The branch was
    // node-or-else, and the else was LinkEditor — which reads link.kind,
    // link.conf and link.id, none of which an ORBAT node has. A fallback
    // that assumes "not a node means a link" is wrong the moment a third
    // kind exists, and it fails at the point of use rather than where the
    // kind was introduced.

    const kinds = [...SRC.matchAll(/setSelected\(\{\s*kind:\s*"(\w+)"/g)].map((m) => m[1])
    const orbatKinds = [...ORBAT.matchAll(/kind:\s*"(\w+)"/g)].map((m) => m[1])
    const all = [...new Set([...kinds, ...orbatKinds])]

    it("finds the kinds the surface actually emits", () => {
        expect(all).toContain("node")
        expect(all).toContain("link")
        expect(all).toContain("orbat")
    })

    it.each(["node", "link", "orbat"])("the inspector names kind %s explicitly", (k) => {
        expect(SRC).toMatch(new RegExp(`selected\\.kind === "${k}"`))
    })

    it("an unknown kind falls through to a message, not to LinkEditor", () => {
        // The order matters: LinkEditor must sit behind its own explicit
        // test, so a future kind cannot land in it by default.
        const linkBranch = SRC.indexOf('selected.kind === "link"')
        const linkEditorUse = SRC.indexOf("<LinkEditor link={selected.item}")
        expect(linkBranch).toBeGreaterThan(-1)
        expect(linkEditorUse).toBeGreaterThan(linkBranch)
        expect(SRC).toMatch(/Nothing to show for this selection/)
    })

    it("the extension row does not read .id off a kind that has none", () => {
        // An ORBAT item carries node_id, not id.
        expect(SRC).toMatch(/selected\?\.kind === "node" && selected\.item\?\.id != null/)
    })
})
