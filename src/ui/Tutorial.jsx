/**
 * Tutorial.jsx — the walkthrough a new analyst gets on first launch.
 *
 * WHY IT IS NOT A PRODUCT TOUR THAT POINTS AT BUTTONS. A tour anchored to
 * DOM elements breaks the first time a panel is renamed or moved, and it
 * breaks silently: the highlight lands on nothing and the step reads as a
 * caption for whatever is underneath. This describes what the app is FOR,
 * module by module, and names where each thing lives. That survives a
 * layout change, which this app has had several of.
 *
 * It shows until it is finished or skipped, and the setting is tri-state:
 * "never opened it" and "turned it off" are different, and only the second
 * should mean the app never mentions its own features again.
 */

import { useEffect, useState } from "react"
import { getSettings, subscribeSettings, updateSetting } from "../state/settingsStore.js"

const STEPS = [
    {
        title: "Two modes, one job",
        body: "Watch is what you monitor — the globe, imagery, briefings, replay. Workstation is where you build: cases, documents, the ontology, forecasts. Switch from the View menu (⇧⌘W), and each mode returns you to where you last were.",
    },
    {
        title: "Search like a map",
        body: "Type into the search box at the top: a country, a city, a street, a ship, a signal, or coordinates like 26.5, 56.4. Suggestions drop down as you type; Enter flies there. ⌘K jumps to the box from anywhere.",
    },
    {
        title: "Theaters are the places you watch",
        body: "Each tab is a theater — a place and the layers that matter there. + makes a new one: name the place, pick what to show. The ★ beside the title makes the selected theater a favourite; favourites stay first in the tabs.",
    },
    {
        title: "The map is the product",
        body: "Map data is the left pane, the inspector the right; both fold away to the edge. Click anything to see what it is, where it came from, and its sources — X and Telegram posts open right beside it.",
    },
    {
        title: "Turn on what you actually use",
        body: "Set the layers you want, then press “save default” in the Map data header — or choose them in Settings › Map & layers. The app opens that way from then on, for your account.",
    },
    {
        title: "Save, share, write",
        body: "“Save for briefing” keeps anything with its coordinates and imagery for the Editor. Share copies a link that opens your theater at your exact view for a colleague. Cases hold the work; nobody sees one unless you share it by name.",
    },
    {
        title: "Notifications are about now",
        body: "A card appears only for something happening while you are here; older events go quietly into the tray as history. The bell counts what is unread. Do not disturb is in Settings when you need quiet.",
    },
]

export default function Tutorial() {
    const [open, setOpen] = useState(() => getSettings()?.tutorial == null)
    const [i, setI] = useState(0)

    // Settings arrive from the server after first paint, so a single read
    // on mount would usually see the default and show this to someone who
    // dismissed it months ago.
    useEffect(() => subscribeSettings((s) => {
        if (s?.tutorial === "done") setOpen(false)
    }), [])

    useEffect(() => {
        if (!open) return
        const onKey = (e) => {
            if (e.key === "Escape") finish()
            else if (e.key === "ArrowRight") setI((n) => Math.min(n + 1, STEPS.length - 1))
            else if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0))
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [open])

    function finish() {
        setOpen(false)
        updateSetting("tutorial", "done")
    }

    if (!open) return null
    const step = STEPS[i]
    const last = i === STEPS.length - 1

    return (
        <div style={{
            position: "fixed", inset: 0, zIndex: 150, display: "flex",
            alignItems: "center", justifyContent: "center",
            background: "rgba(8,10,13,.62)", backdropFilter: "blur(2px)",
        }}>
            <div style={{
                width: 480, maxWidth: "calc(100vw - 32px)", background: "var(--bg-2, #1e212c)",
                border: "1px solid var(--line)", borderRadius: 4, padding: "22px 24px 18px",
            }}>
                <div style={{
                    font: "400 10px var(--font)", color: "var(--txt-4)", letterSpacing: ".1em",
                    textTransform: "uppercase", marginBottom: 10,
                }}>
                    Getting started · {i + 1} of {STEPS.length}
                </div>

                <h2 style={{ font: "600 17px var(--font)", color: "var(--txt)", margin: "0 0 9px" }}>
                    {step.title}
                </h2>
                <p style={{ font: "400 13px/1.62 var(--font)", color: "var(--txt-2)", margin: "0 0 18px" }}>
                    {step.body}
                </p>

                <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
                    {STEPS.map((_, n) => (
                        <span key={n} style={{
                            flex: 1, height: 2,
                            background: n <= i ? "var(--acc-hi)" : "var(--line)",
                        }} />
                    ))}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button className="btn sm" onClick={finish}
                            style={{ color: "var(--txt-3)" }}>
                        {last ? "Close" : "Skip"}
                    </button>
                    <div style={{ flex: 1 }} />
                    {i > 0 && <button className="btn sm" onClick={() => setI(i - 1)}>back</button>}
                    {last
                        ? <button className="btn sm primary" onClick={finish}>Got it — don&rsquo;t show again</button>
                        : <button className="btn sm primary" onClick={() => setI(i + 1)}>next</button>}
                </div>

                {!last && (
                    <p style={{ font: "400 10px var(--font)", color: "var(--txt-4)", margin: "10px 0 0" }}>
                        You can reopen this any time from Settings.
                    </p>
                )}
            </div>
        </div>
    )
}
