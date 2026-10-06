/**
 * tutorialSteps.js — what the walkthrough shows, in order.
 *
 * Each step: where it happens, what it opens (go), what it rings (target, a
 * CSS selector built only from stable hooks — data-tour, data-testid,
 * data-screen-label, a rail button's title, an id), and what to say.
 * tutorialSteps.test.js checks every hook named here exists in the source,
 * so renaming one fails a test instead of leaving the ring on nothing.
 */
import { openOverlay, closeOverlay } from "../state/overlayManager.js"
import { updateSetting } from "../state/settingsStore.js"

const nav = (destination) => window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination } }))
const railBtn = (title) => document.querySelector(`[data-screen-label="Rail"] button[title="${title}"]`)
/** Open a map pane through its rail button — only if it is not already open (the button toggles). */
const ensurePane = (testid, railTitle) => {
    const pane = document.querySelector(`[data-testid="${testid}"]`)
    if (!pane || pane.getAttribute("data-open") !== "true") railBtn(railTitle)?.click()
}

export const STEPS = [
    {
        where: "Home",
        title: "Welcome to Parallax",
        body: "This walkthrough opens each part of the console and shows you the controls that matter. Next and Back move through it, the arrow keys too; Escape leaves it. You can replay it any time from Settings.",
        go: () => nav("home"),
    },
    {
        where: "The rail",
        title: "Every screen lives here",
        body: "Home, the Map, the graph, the Inbox, Reports, Insight and your work — one click each, with a letter shortcut in each button's name (H for Home, M for the Map, I for the Inbox). Overwatch, the satellite imagery, sits under the map tools.",
        target: '[data-tour="rail"]',
    },
    {
        where: "Home",
        title: "The day, in one page",
        body: "Home leads with the newest footage from the ground, then what happened while you were away, what may happen next, and how yesterday's forecasts turned out — all for the places you watch.",
        target: '[data-tour="brief"]',
        go: () => nav("home"),
    },
    {
        where: "Everywhere",
        title: "Search anything",
        body: "A country, a city, a street, a port, a ship or aircraft by name, a signal, or coordinates like 26.5, 56.4. Suggestions appear as you type; Enter goes to the first. ⌘K jumps here from anywhere.",
        try: "type Dubai and press Enter.",
        target: '[data-tour="search"]',
    },
    {
        where: "Everywhere",
        title: "Theaters are the places you watch",
        body: "Each tab is a theater: a place, and the layers that matter there. + makes a new one. The number on a tab is how many signals it holds right now.",
        target: '[data-tour="tabs"]',
    },
    {
        where: "Map",
        title: "What the map shows",
        body: "Map data is every layer, grouped: ships and aircraft, news and verified footage, imagery and heat, alerts, frontlines, infrastructure. Switch them here; “save default” makes the map open this way for you.",
        target: '[data-testid="glass-layers-pane"][data-open="true"]',
        go: () => { nav("situation"); setTimeout(() => ensurePane("glass-layers-pane", "Map data · L"), 350) },
    },
    {
        where: "Map",
        title: "Click anything to see what it is",
        body: "The inspector shows the selected thing — a ship, a strike, a heat detection, a fusion of several — with where it came from, its sources, its footage, and what the parties say about it. With nothing selected it summarises what is on the map.",
        target: '[data-testid="glass-inspector-pane"][data-open="true"]',
        go: () => { nav("situation"); updateSetting("chrome.rightPanel", true) },
    },
    {
        where: "Map",
        title: "Back in time",
        body: "The timeline counts events by day. Drag the window to see the map as it was; the bars are coloured by kind — conflict, equipment, infrastructure, maritime, air.",
        target: "#timestrip",
        go: () => { nav("situation"); setTimeout(() => { if (!document.getElementById("timestrip")) railBtn("Timeline · T")?.click() }, 350) },
    },
    {
        where: "Every page",
        title: "Just say it",
        body: "Hold fn and speak — “search for Dubai”, “show me fires in Yemen”, “open Imagery”, “hide GDELT”, “what's going on in Sudan”. What you said and what was done appear here, with Undo.",
        target: '[data-screen-label="Voice bar"]',
        go: () => nav("situation"),
    },
    {
        where: "Overwatch",
        title: "Satellite imagery of the places that matter",
        body: "Each watched area is scanned by Sentinel-2 (optical) and Sentinel-1 (radar) as passes come in; ships, aircraft, tanks and smoke are outlined, and what changed since the last pass is counted. + adds an area — draw it, and the first pass runs at once.",
        target: 'nav[aria-label="Watched areas"]',
        go: () => nav("imagery"),
    },
    {
        where: "Overwatch",
        title: "Compare passes",
        body: "Swipe, side by side, fade or blink between this pass and an earlier one or the sharp reference image; the date of each image stays beside it. “Show on the map” puts the pass on the globe, outlines and all.",
        target: '[data-tour="imagery-compare"]',
        go: () => nav("imagery"),
    },
    {
        where: "Inbox",
        title: "Everything, as a list",
        body: "Every signal that reached you, newest first: filter it, read it, file it into a case, or add it to a briefing. Footage plays inline.",
        target: '[data-screen-label="Inbox"] > :first-child',
        go: () => nav("watchlists"),
    },
    {
        where: "Reports",
        title: "Briefings, decks and documents",
        body: "Read the generated briefings, or generate one from what you saved — as a briefing, a slide deck or a document — and share it with your team.",
        target: '[data-screen-label="Reports"]',
        go: () => nav("briefings"),
    },
    {
        where: "Everywhere",
        title: "Notifications",
        body: "A card appears only for something happening now — new heat near a watched site, an imagery signal, a party claiming an attack. Some ask what to do: investigate, or scan with a satellite. Everything lands in this tray; the bell counts what is unread.",
        target: '[data-tour="alerts"]',
        go: () => { nav("home"); setTimeout(() => openOverlay("overlay:tray"), 300) },
        leave: () => closeOverlay("overlay:tray"),
    },
    {
        where: "The rail",
        title: "Settings",
        body: "Theme, what interrupts you, the map's default layers, your interests, voice and the model budget, feed health — and this walkthrough, to replay it.",
        target: '[data-screen-label="Rail"] button[title="Settings"]',
        go: () => nav("home"),
    },
]
