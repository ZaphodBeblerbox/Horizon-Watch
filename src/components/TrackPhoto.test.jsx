import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { TrackPhotoView, PhotoCredit, photoQuery } from "./TrackPhoto.jsx"
import CountryFlag from "./CountryFlag.jsx"

const ps = { available: true, thumbnail_url: "https://t.plnspttrs.net/1_280.jpg", photographer: "Jane Spotter",
    link_url: "https://www.planespotters.net/photo/1", source: "planespotters.net", licence: "All rights reserved" }
const wm = { available: true, thumbnail_url: "https://upload.wikimedia.org/x.jpg", photographer: "kees torn",
    link_url: "https://commons.wikimedia.org/wiki/File:X.jpg", source: "Wikimedia Commons",
    licence: "CC BY-SA 2.0", licence_url: "https://creativecommons.org/licenses/by-sa/2.0" }

describe("track photo", () => {
    it("shows the hotlinked picture with the photographer and a link to the source", () => {
        const html = renderToStaticMarkup(<TrackPhotoView photo={ps} alt="RYR1" />)
        expect(html).toContain('src="https://t.plnspttrs.net/1_280.jpg"')
        expect(html).toContain('loading="lazy"')
        expect(html).toContain("16 / 9")
        expect(html).toContain("Photo: Jane Spotter")
        expect(html).toContain('href="https://www.planespotters.net/photo/1"')
        expect(html).not.toContain("All rights reserved")
    })
    it("a Commons photo carries its licence, linked", () => {
        const html = renderToStaticMarkup(<PhotoCredit photo={wm} />)
        expect(html).toContain("Photo: kees torn")
        expect(html).toContain("Wikimedia Commons")
        expect(html).toContain('href="https://creativecommons.org/licenses/by-sa/2.0"')
    })
    it("draws nothing without a photo, a skeleton while it is looked up", () => {
        expect(renderToStaticMarkup(<TrackPhotoView photo={null} />)).toBe("")
        expect(renderToStaticMarkup(<TrackPhotoView photo={null} pending />)).toContain("track-photo-skeleton")
    })
    it("asks by hex and registration, or by MMSI and IMO", () => {
        expect(photoQuery("aircraft", { icao: "adsb-4CA87C", registration: "EI-DCL" })).toBe("aircraft?hex=4CA87C&reg=EI-DCL")
        expect(photoQuery("aircraft", { icao: "~12" })).toBeNull()
        expect(photoQuery("vessel", { mmsi: "353136000", imo: "IMO 9811000" })).toBe("vessel?mmsi=353136000&imo=9811000")
        expect(photoQuery("vessel", {})).toBeNull()
    })
})

describe("country flag", () => {
    it("renders the flag with the country name for hover and screen readers", () => {
        const html = renderToStaticMarkup(<CountryFlag iso2="IE" />)
        expect(html).toContain("🇮🇪")
        expect(html).toContain('title="Ireland"')
        expect(html).toContain('aria-label="Ireland"')
    })
    it("uses the given name and draws nothing for no country", () => {
        expect(renderToStaticMarkup(<CountryFlag iso2="NL" name="Netherlands" />)).toContain('title="Netherlands"')
        expect(renderToStaticMarkup(<CountryFlag iso2="" />)).toBe("")
    })
})
