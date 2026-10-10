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

/** Open the inspector on a real record, so the ontology steps have one to show. */
function openSampleInspector() {
    setTimeout(() => window.dispatchEvent(new CustomEvent("akili:open-inspector", {
        detail: { entityType: "country_risk", entityId: "UKR", data: { country: "Ukraine", iso3: "UKR" } },
    })), 400)
    // the graph sits below the record's details: bring it into view once drawn
    let tries = 0
    const iv = setInterval(() => {
        const card = document.querySelector('[data-testid="ontology-card"]')
        if (card) card.scrollIntoView({ block: "center" })
        if (++tries > 12 || card?.querySelector('[data-testid="ontology-open"]')) clearInterval(iv)
    }, 350)
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
        body: "Home, the Map, the graph, the Inbox, the Desk, Reports, Insight, Analytics and your work — one click each; point at a button and its name appears at once, with its letter shortcut (H for Home, M for the Map, I for the Inbox). Overwatch, the satellite imagery, sits under the map tools.",
        target: '[data-tour="rail"]',
    },
    {
        where: "Home",
        title: "The day, in one page",
        body: "Home is built on what is yours: it opens with what is most urgent for you — signals near your assets, then the most severe in your theaters — refreshed every 30 seconds. Below: footage from the ground, one video at a time with its headline large above it, what happened while you were away, what may happen next, and how yesterday's forecasts turned out.",
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
        body: "Each tab is a theater: a place, and the layers that matter there — every layer and sub-category the map has, or “take everything from the map” in one click. You start with none — + makes your first. Drag a tab to reorder them. Your theaters are yours alone; Home and your notifications follow them. The number on a tab is how many signals it holds right now.",
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
        body: "The inspector shows the selected thing — a ship, a strike, a heat detection, a fusion of several — with where it came from, its sources, its footage, and what the parties say about it. With nothing selected it summarises what is on the map, with charts you can click, and the context of the war you are looking at.",
        target: '[data-testid="glass-inspector-pane"][data-open="true"]',
        go: () => { nav("situation"); updateSetting("chrome.rightPanel", true) },
    },
    {
        where: "Map",
        title: "Everything has an ontology",
        body: "Whatever you select — a ship, a country, a unit, a strike, a Telegram report — has its own graph in the inspector: what it is linked to, the war it belongs to, who is involved, where, and who reported it. Click a node to walk to it. “Full ontology” opens the whole picture over the screen; for a military unit it shows its order of battle, the chain of command above it and the units under it.",
        target: '[data-testid="ontology-card"]',
        go: () => { nav("situation"); openSampleInspector() },
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
        where: "Assets",
        title: "What you protect",
        body: "Register your sites, vessels, aircraft, vehicles and people — an address is enough, or a ship's MMSI or an aircraft's ICAO code, and moving assets are followed live. For each one Parallax ranks what happens within its radius and can reach that kind of asset — a protest outside a substation counts, a tanker at sea does not — and writes how it affects you, what could come next and what to do, with the signals it rests on. Something new near an asset rings the bell.",
        target: '[data-screen-label="Assets"]',
        go: () => nav("assets"),
    },
    {
        where: "Desk",
        title: "What your team has seen",
        body: "The Desk is your team's feed. Post what you see — with a signal, a briefing, Telegram footage, a photo or file, a place or one of your assets attached — to your company, to everyone, or to the people you choose. A tick says you have seen a post, comments discuss it; filter by theater, by person or by what needs an answer. “Share to the desk” in the inspector, the reader and on an asset page posts straight from there.",
        target: '[data-testid="view-root-desk"]',
        go: () => nav("desk"),
    },
    {
        where: "Insight",
        title: "What changed, and what comes next",
        body: "Insight is one screen with three tabs: what changed, the risk ranking, and what happens next — forecasts you can check, the mood on Telegram country by country, and quiet indicators such as unusual late-week US military air activity.",
        target: '[aria-label="Insight · changes, risk, forecast"]',
        go: () => nav("analytics"),
    },
    {
        where: "Analytics",
        title: "Charts of everything",
        body: "Alerts per day by severity, what kind and where, ships and aircraft seen, fusions, Telegram reports by what happened, each war's reports and the forecast record. Pick 7, 30 or 90 days; click a country or a kind to filter the whole page, a day for its most serious alerts, and one of those to see it on the map.",
        target: '[data-testid="analytics-page"]',
        go: () => nav("stats"),
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
        body: "A card appears only for something happening now — new heat near a watched site, an imagery signal, a party claiming an attack, an announced protest near you with a reminder before it starts. Some ask what to do: investigate, or scan with a satellite. Everything lands in this tray; the bell counts what is unread. Settings › Alerts lets them reach you with the app closed, on this computer and on your phone.",
        target: '[data-tour="alerts"]',
        go: () => { nav("home"); setTimeout(() => openOverlay("overlay:tray"), 300) },
        leave: () => closeOverlay("overlay:tray"),
    },
    {
        where: "Profile",
        title: "Your profile",
        body: "The round button at the foot of the rail is you: your name, title and company, a picture and a header (drag either to frame it), your time zone and a short bio — what your team sees on your posts and in Messages. Administrators find the account administration here too.",
        target: '[data-screen-label="Profile"]',
        go: () => nav("profile"),
    },
    {
        where: "The rail",
        title: "Settings",
        body: "Theme, what interrupts you, the map's default layers, your interests, voice and the model budget, feed health — and this walkthrough, to replay it.",
        target: '[data-screen-label="Rail"] button[aria-label="Settings"]',
        go: () => nav("home"),
    },
]

/**
 * WHAT'S NEW — a short tour shown once on the first opening after an
 * update, to people who have already been through the main walkthrough
 * (new users get that, which covers all of this). "Don't show again" ends
 * it for good at any step; closing it any other way brings it back next
 * time. Bump WHATS_NEW_ID with the next set of changes.
 */
export const WHATS_NEW_ID = "2026-10-10"
export const WHATS_NEW = [
    {
        where: "What's new",
        title: "What's new in Parallax",
        body: "A new Analytics page, an ontology for everything you select with the order of battle of military units, headlines over the footage on Home, theaters that take every layer, a Desk you can share with your company or chosen people, notifications with the app closed, and context for every war. Next shows you each one.",
        go: () => nav("home"),
    },
    {
        where: "Analytics",
        title: "Charts of everything",
        body: "Alerts, ships and aircraft, fusions, Telegram reports and the wars, day by day. Every chart is interactive: click a country or a kind to filter the page, a day to see its most serious alerts, an alert to see it on the map.",
        target: '[data-testid="analytics-page"]',
        go: () => nav("stats"),
    },
    {
        where: "Map",
        title: "Every thing has its ontology",
        body: "Select anything — a ship, a country, a strike, a Telegram report — and the inspector draws what it is linked to: the act, the place, the war, who is involved and who reported it. Click a node to walk to it.",
        target: '[data-testid="ontology-card"]',
        go: () => { nav("situation"); openSampleInspector() },
    },
    {
        where: "Map",
        title: "The full ontology, and units' order of battle",
        body: "“Full ontology” opens the whole graph over the screen, two steps out, every link with how it is known. For a military unit it shows the chain of command above it and the units under it, each a click away. Close it with ✕ or Escape.",
        target: '[data-testid="ontology-open"]',
        go: () => { nav("situation"); openSampleInspector() },
    },
    {
        where: "Home",
        title: "Footage with its headline",
        body: "From the ground plays one video at a time, the most breaking first, with its headline large above it; the next slides in when it ends. When new footage or a new story reaches Home, a notification says so — as a card when you are elsewhere in the app, in the tray always.",
        target: '[data-testid="ground-reel"]',
        go: () => nav("home"),
    },
    {
        where: "Theaters",
        title: "Theaters take every layer, and move",
        body: "Every layer and sub-category on the map can be part of a theater, and “take everything from the map” copies what you see. Drag a tab to put your theaters in your order.",
        target: '[data-tour="tabs"]',
    },
    {
        where: "Desk",
        title: "Choose who sees a post",
        body: "Post to your company, to everyone, or to the people you pick. Only they see it, its comments and its ticks.",
        target: '[data-testid="view-root-desk"]',
        go: () => nav("desk"),
    },
    {
        where: "Insight",
        title: "Mood and quiet indicators",
        body: "What happens next now shows the mood on Telegram country by country, and quiet indicators such as unusual late-week US military air activity, each against its own baseline.",
        target: '[aria-label="Insight · changes, risk, forecast"]',
        go: () => nav("analytics"),
    },
    {
        where: "Settings",
        title: "Alerts with the app closed",
        body: "In Settings › Alerts, turn on notifications that reach you when Parallax is closed — on this computer and on your phone. Announced protests near you come with a reminder before they start.",
        target: '[data-screen-label="Rail"] button[aria-label="Settings"]',
        go: () => nav("home"),
    },
]
