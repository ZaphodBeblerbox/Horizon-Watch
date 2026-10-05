# Voice commands

Hold **fn**, speak, and the map does it. No click first, and no model.

## How it works

Parallax never sees the fn key — macOS gives it to Wispr Flow before the
browser gets a keydown. Wispr dictates into whichever field has focus. So
the whole mechanism here is: *keep a field focused, and watch for a
sentence appearing in it.*

| File | What it does |
|---|---|
| `voiceCommands.js` | The parser. Regexes and lookups only — no network, no model. |
| `voiceField.js` | The three decisions the field makes: is this a dictation, may I take focus, is this keystroke a shortcut. |
| `voiceContext.js` | What is on screen, in the shape the parser wants. |
| `runVoiceActions.js` | A parsed action becomes something that happened, plus its inverse. |
| `VoiceBar.jsx` | The bar at the bottom of the map. |
| `voiceLog.js` | Every parse, locally, so the rules can grow. |

## Why the bar is visible

The obvious implementation is a hidden input, and it is the one that
fails: dictation tools skip fields they cannot see. It is a slim bar with
the cheat sheet in it, which is also the only way anyone learns what they
can say.

## Reading the log

In the browser console:

```js
JSON.parse(localStorage["plx.voice.log"])
```

Each row is `{ at, raw, intent, confident, problem, undone }` — the
sentence, what it was taken for, and whether the user took it back.
Nothing else: note bodies and signal text are content, and this log exists
to improve matching, not to collect what people write.

The two queries worth running:

```js
// Sentences the parser would not act on — the rules worth writing next.
JSON.parse(localStorage["plx.voice.log"]).filter(e => !e.confident)

// Worse: it acted, and the user undid it. These are misreadings.
JSON.parse(localStorage["plx.voice.log"]).filter(e => e.undone)
```

## What is wired, and what is not

| Command | Status |
|---|---|
| add to briefing | real — `addToBriefing`, undo removes it |
| note | real — saved into `savedForBriefing`, undo deletes it |
| tag / assign | real — `createAssignment`; undo marks it done, the nearest inverse that API has |
| filter | real — the map's own layer toggles; undo restores the previous set exactly |
| generate briefing | real — opens Reports · Generate. The analyst presses generate; this adds no model call |
| dismiss | **partial** — dispatched as an event. Inbox triage state is session-local and there is no server-side dismissed flag |
| create signal | **TODO** — no endpoint accepts an analyst-authored signal. Kept as a located note so the observation is not lost |
| send | **TODO** — there is no mail integration in this deployment. Generate's own distribute button is disabled for the same reason. The command refuses rather than pretending |

## Rules that will not change without saying so

- **Sending always needs a click.** Never on a timeout, never automatically.
  Recipients come from the user directory only — never a name the parser
  heard and guessed an address for.
- **Generating a briefing always needs a click.**
- **Nothing said is ever lost.** An unrecognised sentence is saved as a note
  on the selection, or as a loose note if nothing is selected.
- **One command per sentence.** "Dismiss this and show cyber" runs the first
  only.

## Not built

- LLM interpretation. `onUnrecognised(raw, ctx)` in `runVoiceActions.js` is
  the hook if we ever add a cheap fallback behind a flag; it does nothing today.
- "Zoom to <place>" — needs a gazetteer lookup. TODO.
