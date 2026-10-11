# Endangered places: sources for other countries

Research date: **2026-10-11**. Scope: public sources, outside France, that say **where** (and ideally **when**) protest, blockade or strike action is called, plus activist-published **target lists** of companies and sites. The aim is to answer the owner's question: "can we create such a db of other countries as well?"

How to read this file:

- **Verified** means I fetched the endpoint with a plain GET on 2026-10-11 and saw the data described.
- **Unverified** means it is a lead or a guess. These are marked in the tables.
- Nothing was ingested and no POST endpoint was called.

---

## 1. Executive summary

**Yes, but the data looks different in each country.** No other country has an exact equivalent of the gilets jaunes call site, with its national list of blockade points and per-place calls. What does exist falls into four groups that can be ingested.

1. **Official lists of announced demonstrations.** These are the best quality. **Berlin** and **Dresden** publish clean JSON files: every notified assembly with date, time, topic and address, and for Berlin the march route. Berlin alone has 1,213 entries. **Italy's** transport ministry publishes every proclaimed strike as RSS, by sector and province, including national and general strikes. These are legally mandated, stable and machine-readable. They are not "calls to blockade", but they are the most reliable "something will happen here on this date" signal in Europe.
2. **uMap / Framacarte maps.** The French arms-industry map runs on uMap, and uMap is used Europe-wide. Every uMap map exposes the same GeoJSON endpoints, which I verified. A keyword search across uMap instances found more target maps of the same kind:
   - Stop Arming Israel France: 335 sites.
   - EU arms-lobby offices in Brussels: 17.
   - Veneto arms supply chain: 47.
   - "La fabbrica della guerra – Modena": 67.
   - Italy's 22 September general-strike gathering points.

   **One generic uMap adapter plus a discovery crawler is the highest-leverage build.** These maps appear and disappear at random, so they must be found repeatedly, not configured once.
3. **Activist calendars that publish feeds.** Each has an open feed with dates, and most have coordinates:
   - **Demosphere**: Brussels, Liège, Frankfurt and Würzburg, as ICS and RSS.
   - **Gancio** instances: Bonn, Rhein-Main, Berlin, Madrid, Barcelona, Bologna, Catalonia and others, as a JSON API.
   - **Extinction Rebellion UK**: the national event map is a geocoded JSON(P) file.

   These are noisy, because they mix culture nights and talks with actions. Use them with keyword and tag filters.
4. **Research-NGO target lists (UK).** CAAT's "Who arms Israel" map embeds clean JSON: 70 F-35 supply-chain companies and 110 export licensees, with lat/lon per site. This is the UK analogue of the French arms map. It is maintained by a stable NGO, not a throwaway activist map.

**What does not exist, or I could not find:**

- Public lists of announced demos in the UK, the Netherlands, Belgium, Spain, Austria, the Nordics or the Baltics.
- Machine-readable maps for farmers' or truckers' blockades anywhere. These are organised on WhatsApp, Telegram and Facebook, with the odd one-off uMap.
- A live endpoint for Rheinmetall Entwaffnen. Its noblogs.org site refused TLS from this machine.

For those gaps, the realistic options are GDELT, which is free, and ACLED, which needs a licence for commercial use, as after-the-fact context. The Telegram pipeline we already run is the other option.

**Legal flag (UK):** Palestine Action is a proscribed organisation in the UK under the Terrorism Act 2000. The High Court ruled the proscription unlawful in 2026, but the ban stays in force pending the government's appeal. **Do not ingest, mirror or republish Palestine Action material, including its Elbit site lists.** Use CAAT and Elbit's own corporate locations instead.

---

## 2. Per-country tables

Column key:

- **Coords?** means the source carries lat/lon. Otherwise addresses need geocoding.
- **Dates?** means event dates are present. Target lists usually have none, because they describe standing exposure.

### Germany

| Source | Kind of places | Data access (exact endpoint) | Coords? | Dates? | Cadence | Reliability | Legal / privacy |
|---|---|---|---|---|---|---|---|
| **Polizei Berlin – Versammlungsbehörde, "Versammlungen & Aufzüge"** | Every notified assembly and march in Berlin: vigils, demos, marches with route | **Verified JSON:** `https://www.berlin.de/polizei/service/versammlungsbehoerde/versammlungen-aufzuege/index.php/index/all.json?q=` → `{index:[{id, datum "DD.MM.YYYY", von, bis, thema, plz, strasse_nr, aufzugsstrecke}]}`. 1,213 entries; 182 with a march route; horizon runs to 2034 because of long-running vigils. HTML at `.../versammlungen-aufzuege/` | No (PLZ + street; geocode) | Yes (date + from/to) | Continuous; publication is required by § 12 VersFG Berlin | **High**: official and complete for notified assemblies. Spontaneous ones are missing | No organiser field. `thema` is free text and can name people, so do not store names. No explicit open licence found; it is public authority information |
| **Landeshauptstadt Dresden – Versammlungsübersicht** | Notified assemblies for the next 3 months | **Verified JSON:** `https://www.dresden.de/data_ext/versammlungsuebersicht/Versammlungen.json` → `{Dateidatum, Tabellenkopf, Versammlungen:[{Datum, Zeit, Thema, Ort, Startpunkt, Teilnehmer, Veranstalter, Status}]}`. 37 entries; status is `angemeldet` or `beschieden` (decision issued) | No (place name; geocode) | Yes | Daily by 08:00 (stated on the page) | **High**. Excludes strikes and very-short-notice ("Eil-") assemblies | **Drop `Veranstalter`**: it says "natürliche Person" for private people (privacy is already masked) but names associations otherwise. `Teilnehmer` (organiser's turnout estimate) is useful |
| München, Hamburg, Köln, Leipzig, Frankfurt | Notified assemblies | **None found.** Munich refused FragDenStaat requests for the list | – | – | – | – | Not public |
| **Demosphere Frankfurt / Würzburg** | Left/activist event calendar: demos, rallies, talks | **Verified:** `https://ffm.demosphere.net/events.ics` (48 events), `https://wuerzburg.demosphere.net/events.ics` (158); RSS at `/events.xml` (georss namespace) | Partly. ICS `GEO` is often `0;0`, so use `LOCATION` | Yes | Daily, by volunteers | Medium. Mixed content; filter on "Demo", "Kundgebung", "Blockade" | Event texts sometimes include contact emails. Strip them |
| **Gancio instances** (`bonn.jetzt`, `events.rheinmain.social`, `berlin.askapunk.de`) | Left/subculture calendars with some actions | **Verified JSON:** `https://<host>/api/events` (Bonn 96 events, 70 with lat/lon; Rhein-Main 143, 108 with lat/lon; askapunk 94, 0 with lat/lon). Also `/feed/rss` and `/feed/ics` | Yes for most instances (`place.latitude/longitude`) | Yes (unix `start_datetime`) | Continuous | Low–medium signal; mostly culture | No personal fields in the API output seen. Respect each instance's terms |
| **Rheinmetall Entwaffnen** (rheinmetallentwaffnen.noblogs.org) | Annual camp plus action days against Rheinmetall and other arms sites. 2026: Köln camp 1–6 Sep, then action days in Hamburg. Past "Karten" pages list Kassel arms firms | **Unreachable from here** (TLS reset on 2026-10-11). WordPress, so `/feed/` is likely. **Unverified guess** | No | Yes (camp dates) | A few posts a month | Medium: real actions, but locations are announced late | Movement publishes calls to disrupt. Store places and dates only, not calls to action |
| **IMI "Handbuch Rüstung" / Rüstungsatlas BaWü** (imi-online.de) | Map plus directory of German arms-industry sites | PDF only (`https://www.imi-online.de/download/IMI_Handbuch_Ruestung_web.pdf`, 2022). No machine-readable map found | No | No | Years | Medium. Based on lobby-association member lists; civil and military sites are not distinguished | Copyrighted; facts only. Better rebuilt from company sites plus OSM |
| uMap: "BAO Aktionswoche Bauernproteste" (`umap.openstreetmap.fr` map 1005472) | Farmers' protest action-week points/routes (2024) | **Verified** datalayer: `https://umap.openstreetmap.fr/en/datalayer/1005472/b8224939-272a-415c-b5fb-9d91d0a52fc1/` (50 features) | Yes | Not in the data | Dead (historical) | Example only. Shows farmers' maps are one-off and ephemeral | – |

### United Kingdom

| Source | Kind of places | Data access | Coords? | Dates? | Cadence | Reliability | Legal / privacy |
|---|---|---|---|---|---|---|---|
| **CAAT – "Who arms Israel" map** | UK companies in the F-35 supply chain plus holders of Israel export licences, with each site's address | **Verified:** JSON is embedded in the page `https://caat.org.uk/data/countries/israel/mapped-all-the-uk-companies-manufacturing-components-for-israels-f35-combat-aircraft/` as `cma.ukF35 = [...]` (70 companies, each with `address:[{title,address,lat,lon,icon}]`) and `cma.ukLicensee = [...]` (110 companies with licence lines). Parse the inline `<script>` | **Yes** | No (licence dates only) | Updated occasionally (stated last update 24 Aug 2025) | **High** for facts. Built from FOI and government licence data | CAAT content is copyrighted, so cite it and reuse facts only. No personal data. This list is used by activists to plan actions (e.g. Friends of the Earth's guide points to it) |
| CAAT company data hub | All UK locations per arms company (e.g. "BAE Systems: 141 known UK locations") | `https://caat.org.uk/data/companies/<slug>/map?country=country,united-kingdom`. Format **not inspected** (unverified) | Likely | No | – | High | As above |
| **Extinction Rebellion UK – events map** | All XR UK events: actions, local group meetings, drumming practice | **Verified JSONP:** `https://mapdata.extinctionrebellion.uk/uk-events-map-cache/events.php` → `xrevents({...})`: 105 locations keyed by address, each with Google-geocoded `geometry.location{lat,lng}` and `events[][]` (Teamup fields: `title, start_dt, end_dt, rrule, who, notes, custom{...}`). Category codes at `https://eventmap.extinctionrebellion.uk/categories.json?8` | **Yes** | Yes | Cached, continuous | Medium. Most entries are meetings, so filter by category ("action") | **`custom.registration_link` can be a personal email or phone, and `who` can name people. Drop both** |
| Workers in Palestine – "Who arms Israel" | Annotated list of the 79 F-35 open-licence companies | HTML plus Google Docs at `https://www.workersinpalestine.org/who-arms-israel` | No | No | Rare | Medium | Duplicates CAAT, so CAAT is preferred |
| **Palestine Action / Shut Elbit Down** | Elbit UK sites (~10) and suppliers | **Do not ingest.** Palestine Action is proscribed (Terrorism Act 2000; status contested in court, ban in force). `shutelbitdown.com` did not resolve | – | – | – | – | **Legal risk.** Take Elbit site addresses from Elbit Systems UK's own corporate pages instead |
| Stop the Arms Fair | DSEI arms fair (ExCeL London, every two years in September; next 2027) | HTML only (`https://stopthearmsfair.org.uk/`) | No | Yes (once every two years) | Rare | High, but a single event | Enter it as a manual calendar item |
| Just Stop Oil | – | Ended direct action in April 2025. The site is an archive | – | – | – | – | Do not build |
| Police notices (Met Section 14 conditions) | Conditions imposed on specific protests | Press releases only; no list or feed found | – | – | – | – | – |

### Netherlands

| Source | Kind | Access | Coords? | Dates? | Notes |
|---|---|---|---|---|---|
| Gemeente Amsterdam / Den Haag demo lists | Notified demos | **None found.** Amsterdam reports aggregate counts to the council (3,323 demos in 2025, 3,203 notified) but no public list | – | – | Not public |
| XR NL (A12 blockades), Code Rood | Climate blockades | HTML/social only (`extinctionrebellion.nl/agenda/` returns an image; `code-rood.org`). No feed found | – | – | Monitor via Telegram/news |
| Stop Wapenhandel | Research on the Dutch arms industry | Reports (PDF). No site map found | – | – | Low priority |

### Belgium

| Source | Kind | Access | Coords? | Dates? | Notes |
|---|---|---|---|---|---|
| **Demosphere Bruxelles** | Activist calendar (rallies, demos) | **Verified:** `https://bxl.demosphere.net/events.ics` (33 VEVENTs), `https://bxl.demosphere.net/events.xml` (RSS with georss), map at `/map` | ICS `GEO` often `0;0`; `LOCATION` is a usable address | Yes | Good signal for Brussels: Gaza, anti-war and union rallies |
| **Demosphere Liège** | Same | **Verified:** `https://liege.demosphere.net/events.ics` (74) | as above | Yes | |
| **uMap "Arms Industry Lobby EU"** | Brussels lobby offices of arms companies (Thales, Leonardo, …) | **Verified:** `https://umap.openstreetmap.fr/en/datalayer/1263116/5d2a8d7a-3985-4be8-8256-23f639bf8024/` (17 points) | Yes | No | Small but exactly the "target list" genre |
| Vredesactie – Arms Industry Watch (`armstradewatch.eu`) | European arms-industry company database | Site up (Drupal). **No export endpoint verified** | Unknown | No | Possible rich source; check its data/export pages |
| Police Bruxelles-Capitale/Ixelles | Traffic notices for big demos | News items only, no list found | – | – | – |

### Italy

| Source | Kind | Access | Coords? | Dates? | Cadence | Notes |
|---|---|---|---|---|---|---|
| **MIT – Osservatorio sui conflitti sindacali, "Scioperi in programma"** | Every proclaimed **transport** strike, plus general strikes affecting transport (e.g. "Settore: Generale, Rilevanza: Regionale, Toscana"), with sector, scope, region, province, unions and affected company | **Verified RSS:** `https://scioperi.mit.gov.it/mit2/public/scioperi/rss` (31 items on 2026-10-11). Each item's description has `modalità, Data fine, Settore, Rilevanza, Regione, Provincia, Sindacati, Categoria interessata, Data proclamazione`. HTML: `https://scioperi.mit.gov.it/mit2/public/scioperi` | No (region/province: map to centroids) | **Yes** (start/end plus hours) | Daily | **High**: legally required pre-notice. Covers the USB / "blocchiamo tutto" Gaza general strikes, which also brought port blockades. No personal data (only union names). Licence not stated |
| Commissione di Garanzia Sciopero (`cgsse.it`) | All-sector strike calendar | **Unreachable from here** (timeout). Unverified | – | Yes | – | Would extend MIT beyond transport |
| **uMap "Filiera Armi Veneto"** | Arms supply-chain firms in Veneto/Friuli | **Verified:** `https://umap.openstreetmap.fr/en/datalayer/1096412/2c263c38-19fc-4eee-8fa9-2f22087bc4f6/` (47 points: company, address, comune) | Yes | No | – | Has company phone numbers: drop them |
| **uMap "La fabbrica della guerra – Modena"** | Arms and war-economy firms around Modena | **Verified** map 1418035, layer `b32d1220-2501-4911-ac43-b8233ba4d749` (67 points; 5 other layers empty) | Yes | No | – | Points carry OSM geocoder fields |
| uMap "Verso lo sciopero generale del 22 settembre" | Gathering points for the Rome general strike (2025) | **Verified** map 1285163 (17 features, routes) | Yes | Implicit (title) | Dead | Shows the pattern: strike-day maps are published on uMap |
| **Gancio `balotta.org`** (Bologna) | Movement calendar | **Verified** `https://balotta.org/api/events` (52 events, 17 with coords) | Partly | Yes | Continuous | |
| The Weapon Watch / Rete Pace Disarmo atlas | Italian defence industry, site by site | Print/PDF atlas; no data endpoint found | – | – | – | Facts only |

### Spain

| Source | Kind | Access | Coords? | Dates? | Notes |
|---|---|---|---|---|---|
| Delegaciones del Gobierno | Notified demonstrations | **None found.** Figures only come through press or parliamentary answers | – | – | Not public |
| **Gancio `mad.convoca.la`, `bcn.convoca.la`** (+ burgos, mallorca, castello… `.convoca.la`) | Movement calendars (Madrid, Barcelona…) | **Verified** `https://mad.convoca.la/api/events` (46 events, 40 with coords), `https://bcn.convoca.la/api/events` (74, 56 with coords) | **Yes** | Yes | Best open Spanish source found; filter for "manifestación", "concentración", "huelga" |
| Gancio `calendario.extinctionrebellion.es` | XR Spain | **Verified** `/api/events`, but only 1 (online) event | – | Yes | Nearly empty |
| `calendari.cc` (Catalonia, Gancio) | Calendar | **Verified** `/api/events` (23, 18 with coords) | Yes | Yes | |
| Centre Delàs | Reports on the Spanish/Catalan/Basque military industry | Reports only; no map found | – | – | Facts only |

### Poland

| Source | Kind | Access | Coords? | Dates? | Notes |
|---|---|---|---|---|---|
| **Voivodeship crisis centres (WCZK): "zgromadzenia w trybie uproszczonym"** | Small assemblies notified in the simplified procedure (art. 21) | **Verified HTML** for Łódź: `https://www.gov.pl/web/uw-lodzki/zgromadzenia` (free text: date, time, town, place, expected size, purpose). Other voivodeships are probably similar on gov.pl (**unverified**) | No | Yes | Low value: tiny pickets. **Free text can name private individuals (seen in Łódź), so do not ingest raw** |
| Warsaw | Mass events only (`https://bezpieczna.um.warszawa.pl/wykaz-imprez-od-01-01-2019`) | Not assemblies | – | – | Assemblies list not found |
| Farmers' border blockades | – | No structured source | – | – | Telegram/news |

### Switzerland and Austria

| Source | Kind | Access | Notes |
|---|---|---|---|
| Stadt Zürich open data "Demonstrationen" | **Annual counts only** | **Verified** `https://data.stadt-zuerich.ch/dataset/sid_stapo_sicherheitsbericht_demonstrationen_od1010/download/RCH101OD1010.csv` (`Jahr, bewilligt/unbewilligt, AnzDemo`) | Useless for places; context only |
| uMap "Feministischer Streik 2025" | 14 June strike programme points across Switzerland | **Verified** map 1223625 (27 points) | Shows the yearly pattern; re-discover each June |
| Wien / Bern | Notified assemblies | None found | – |

### Nordics and Baltics

| Source | Kind | Access | Notes |
|---|---|---|---|
| **Polisen (Sweden) – händelser API** | Police incident notices, incl. type `Polisinsats/kommendering` (used for demos and operations) | **Verified** `https://polisen.se/api/events` (last 500 events; `type`, `datetime`, `summary`, `location.gps` at county/municipality level) | Reactive, not announced. Useful as a "something is happening" signal. Low-resolution coordinates |
| Oslo, Copenhagen, Helsinki police | Notified demos | None found | – |
| Riga, Vilnius, Tallinn | Notified assemblies | None found. Municipalities approve them, but no published list was found | – |
| Activist arms maps (Ofog, Svenska Freds, etc.) | – | None found | – |

### Elsewhere (major ones only)

| Source | Kind | Access | Notes |
|---|---|---|---|
| **Mobilize (US)** | Progressive/Democratic events, incl. rallies and protests (`event_type`) | **Verified public API** `https://api.mobilize.us/v1/events?timeslot_start=gte_now` (19,543 upcoming; `location.location.latitude/longitude`, `timeslots`, `event_type`, `tags`) | **Drop `contact` and the host fields: personal data.** Most events are meetings, so filter on `event_type` (sample value seen: `MEETING`; the protest/rally enum names are **unverified**) |
| uMap "Pro-Palestine events in NYC" (`umap.openstreetmap.fr` 1104786) | NYC event points | Found by search, not inspected | Same adapter |
| AFSC Investigate / Who Profits | Companies complicit in the occupation or arming Israel | Company-level web database; no site coordinates found | Company names only. Join to our own site data |

### Cross-country aggregators and fallbacks

| Source | Kind | Access | Coords? | Dates? | Legal / notes |
|---|---|---|---|---|---|
| **uMap / Framacarte (all instances)** | Any activist map | **Verified pattern:** map metadata `https://<host>/<lang>/map/<id>/geojson/` → `properties.datalayers[].id`; features `https://<host>/<lang>/datalayer/<map_id>/<layer_uuid>/`. Discovery: `https://<host>/en/search/?q=<term>` (HTML; parse `/map/<slug>_<id>` links). Hosts: `umap.openstreetmap.fr` (largest), `framacarte.org`, `umap.openstreetmap.de` (searches there returned nothing) | Yes | Rarely | Check the per-map `licence` property. Features sometimes include phone numbers or personal notes, so whitelist name, type, address and description |
| **Demosphere** network | Activist calendars | `https://<site>.demosphere.net/events.ics` and `/events.xml`. Sites outside France: `bxl`, `liege`, `ffm`, `wuerzburg`, `saopaulo` (list at `https://demosphere.net/`) | Weak | Yes | Mixed content |
| **Gancio** network | Activist/community calendars | `https://<host>/api/events`, `/feed/rss`, `/feed/ics`. Instance list: `https://gancio.org/instances` (DE, ES, IT, CZ, SI, AT, BE …) | Often | Yes | Mixed content |
| Mobilizon | Federated events | Instance-wide search is GraphQL (POST), **not called**. Per-group feeds are reportedly `/@<group>/feed/ics` (**unverified**) | – | Yes | Low adoption for protest calls outside FR |
| **GDELT 2.0 Events** | News-coded events; CAMEO root 14 = protest | **Verified** `http://data.gdeltproject.org/gdeltv2/lastupdate.txt` → 15-minute export zips | Yes (geo-coded) | Yes (after the fact) | Free. Noisy; good for "ongoing at X". No personal data beyond actor names |
| ACLED | Curated protest/riot events | API requires a registered account/token. **Terms restrict commercial use and redistribution; check the licence before using it in a product.** Weekly | Yes | Yes (after the fact) | Context only, never a source of "called" places |
| Fridays for Future action map | Climate strike points | Page loads its data via `wp-admin/admin-ajax.php` (likely POST). **Not called, unverified** | – | – | Skip unless a GET export exists |
| de.indymedia.org | Left news | `https://de.indymedia.org/rss.xml` (verified 200); no event-calendar feed | No | In text | Text mining only |

---

## 3. Ranked shortlist: ingest these first

Ranking is value × ease × reliability. All endpoints below were verified on 2026-10-11.

| # | Source | Country | Why | Endpoint |
|---|---|---|---|---|
| 1 | **Polizei Berlin – Versammlungen JSON** | DE | Official and complete; covers a capital; march routes; one GET | `https://www.berlin.de/polizei/service/versammlungsbehoerde/versammlungen-aufzuege/index.php/index/all.json?q=` |
| 2 | **Italy MIT – scioperi RSS** | IT | Official; national/general/port-relevant strikes with dates, region and province; standard RSS | `https://scioperi.mit.gov.it/mit2/public/scioperi/rss` |
| 3 | **Generic uMap/Framacarte adapter + discovery crawler** | multi | Reuses the French adapter; finds new target/blockade maps in IT, BE, DE and CH as they appear. Seed with Framacarte 173229 (Stop Arming Israel France, 335 sites), umap.fr 1263116 (EU arms lobby), 1096412 (Veneto), 1418035 (Modena) | `/<lang>/map/<id>/geojson/` + `/<lang>/datalayer/<id>/<uuid>/` + `/en/search/?q=` |
| 4 | **CAAT "Who arms Israel"** | UK | UK equivalent of the French arms map; 180 companies with site lat/lon; NGO-maintained | Inline `cma.ukF35` / `cma.ukLicensee` on the CAAT page above |
| 5 | **Dresden – Versammlungen.json** | DE | Official, daily, includes turnout estimate and approval status | `https://www.dresden.de/data_ext/versammlungsuebersicht/Versammlungen.json` |
| 6 | **XR UK events map** | UK | Geocoded, national; climate actions (filter out meetings) | `https://mapdata.extinctionrebellion.uk/uk-events-map-cache/events.php` (JSONP) |
| 7 | **Demosphere BE/DE** (bxl, liege, ffm, wuerzburg) | BE, DE | Real protest calls in Brussels, where EU institutions are; ICS is trivial to parse | `https://<site>.demosphere.net/events.ics` |
| 8 | **Gancio ES/DE/IT** (mad/bcn.convoca.la, bonn.jetzt, events.rheinmain.social, balotta.org, calendari.cc) | ES, DE, IT | Coordinates and dates in JSON; one adapter covers all instances | `https://<host>/api/events` |
| 9 | **GDELT 2.0 protest events** | all | Free fallback that confirms "it is happening now" where no announcement source exists (NL, PL, Nordics, Baltics) | `http://data.gdeltproject.org/gdeltv2/lastupdate.txt` |
| 10 | **Mobilize API** (if US coverage is wanted) | US | Large, clean, geocoded; public GET | `https://api.mobilize.us/v1/events?timeslot_start=gte_now` |

Honourable mentions:

- Polisen.se API: reactive, Sweden.
- Polish WCZK lists: only with strict text sanitising.
- Rheinmetall Entwaffnen RSS: once reachable; check `/feed/`.
- CGSSE all-sector strike calendar: once reachable.

---

## 4. Caveats

- **Announced ≠ blockade.** Official lists (Berlin, Dresden, MIT) say an assembly or strike is notified, not that a site is targeted. Score them lower than explicit "block X" calls. A march past a depot is not a depot blockade. Use the topic text and the route to match against assets.
- **Activist maps are ephemeral.** uMap/Framacarte maps get deleted, emptied (the Modena map has 5 empty layers) or frozen after the event (the Rome strike map, the 2024 farmers' map). Treat each one as a snapshot with `fetched_at`. Expire date-bound items. Re-run discovery weekly instead of trusting a fixed list.
- **Activist sites disappear or block clients.** rheinmetallentwaffnen.noblogs.org refused TLS, shutelbitdown.com did not resolve, and cgsse.it timed out. Build adapters to fail loudly (see the silent-failure memory), not to return empty.
- **Accuracy.** Target lists mix arms makers with prefectures, regional councils, ports and detention centres (the French map 213599 does this). Several maps use automatic geocoding, with fields such as `osm_key: highway` and `type: street`, so the point may sit on a street centroid rather than the plant. Lists like IMI's do not separate civil sites from military ones. Show these as "named by activists", not as verified exposure, and prefer corporate or OSM geometry when matching to assets.
- **Coverage bias.** Official lists exist only where the law requires publication (Berlin, Dresden) or a ministry chose to publish (Italy). There are big holes in NL, ES, PL, the Nordics and the Baltics. Farmers' and truckers' blockades are organised on Telegram, WhatsApp and Facebook, not on maps. Our Telegram pipeline is the realistic source there.
- **Personal data (GDPR Art. 9: political opinions).** Never store organiser names, `who`, contact emails, phones, registration links or participant counts tied to a person. Fields to drop:
  - Dresden: `Veranstalter`.
  - XR UK: `who`, `custom.registration_link`.
  - Mobilize: `contact`, `sponsor`, host fields.
  - uMap: any phone fields.
  - Polish lists and Berlin `thema`: free text can name private individuals.

  Keep place, time, topic category and source URL. Whitelist fields; do not blacklist them.
- **Legal.**
  - UK: Palestine Action is proscribed, so do not ingest or republish its material.
  - Generally: store facts (place, date, type), not the text of calls to sabotage or blockade. Republishing incitement could itself be an offence in DE, FR and the UK.
  - Licences: mostly unstated (Berlin, Dresden, MIT, CAAT). Facts are generally reusable, but cite the source and do not mirror whole pages.
  - ACLED needs a commercial licence for use in a product.
- **Rate and politeness.** These are small community servers (Demosphere, Gancio, uMap). Poll them hourly at most, with a descriptive User-Agent.
