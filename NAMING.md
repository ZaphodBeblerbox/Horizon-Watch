# Naming

Two separate problems. The first is solved and shipped; the second is a
proposal, because module names are a judgement call and renaming twenty
things on a guess is worse than renaming them once, deliberately.

## 1. Source names — done

Layer labels used to name the suppliers. Anyone reading over your shoulder
learned which feeds you buy.

| was | is |
|---|---|
| AIS Vessels | Vessels |
| ADS-B Aircraft | Aircraft |
| AIS Density | Sea Density |
| ADS-B Density | Air Density |
| GDELT Events | Wire Reports |
| News Intelligence Events | Reported Events |
| Precision Intelligence | Verified Events |
| Sentinel-2 Satellite | Satellite |

Hints lost their attributions too: OpenInfraMap, OurAirports, OpenSeaMap,
openAIP, NASA FIRMS and Copernicus are gone from anything a reader sees.

One caveat deliberately survives — thermal detection still says "a flare,
stubble and a strike look identical". That is a statement about what the
data can and cannot tell you, not an attribution, and removing it would
make the layer look more certain than it is.

**Display labels only.** Keys, API fields and variable names are unchanged.
Renaming those is a data migration and a separate decision.

## 2. Module names — proposed, not applied

The strongest candidates, in the order I would do them:

| now | proposed | why |
|---|---|---|
| Imagery | **Overwatch** | It is the watching surface, and the name is already in the product's vocabulary |
| Situation | **Watchfloor** | Says it is a place, not a status |
| Briefings | **Dispatch** | What leaves the building |
| Ontology | **Lattice** | The structure, without the philosophy-seminar overtone |
| Forecast | **Horizon** | Reads forward, and does not promise accuracy |
| Replay | **Rewind** | Plainer |

Note **Overwatch is already taken** inside the product — the draw-an-area
detection tool is called that. Renaming Imagery to Overwatch means renaming
that tool first, or the two collide in conversation on day one.

### Left alone on purpose

**Cases**, **Editor**, **Analytics**, **Team**, **Inbox**, **Dossiers**.
They say exactly what they do, and Workstation already frames them. A
cleverer name here costs a new person a week of asking what it means.
