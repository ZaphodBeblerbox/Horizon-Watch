"""
place_types.py — what kind of thing stands at an endangered place, for its
3D model (owner, 2026-10-12: "make sure we can generate generic 3D models
for everything on the list … a market square and so on").

The layer's `kind` says why a place is listed (a gathering point, a notified
assembly, an arms company); `model_type` says what is THERE — a town square,
a prefecture, a station, a bridge. It is derived on read from the kind and
the place's name (French, German, Italian, Spanish, Catalan, English),
never stored, so a better rule re-labels every place at once.

ORDER OF THE RULES. A name is cut into segments ("Houses of Parliament,
Parliament Square, London" → three); the first segment that says anything
decides, so the head of the name wins over the address after it. Inside a
segment:
  1. landmarks known by name (Quai d'Orsay is a ministry, not a quay);
  2. a leading type word — Romance and English names lead with it:
     "Place de l'Hôtel de Ville" is a square, "Pont Royal" a bridge,
     "Jardins de l'hôpital" a park;
  3. the facility words, most specific first (an embassy before a
     government office before a square), German compounds by their ending
     ("Jannowitzbrücke", "Altmarkt", "Bahnhofsvorplatz");
  4. a street with a house number is a building at that address.
Then the kind's own default: an arms company is a works, a lobby office an
office building, a gathering with no type word a rally (generic outdoor
gathering), a strike the transport it stops.

The model claims only the TYPE (a generic town square), never the site's
layout — the same restraint as the vessel and aircraft models.
"""
from __future__ import annotations

import re
import unicodedata

# Every model type, with the words the inspector shows. Each has a model in
# public/models/place/<type>.glb (tools/make_place_models.py).
MODEL_LABEL = {
    "refinery": "Refinery",
    "fuel_depot": "Fuel depot / oil terminal",
    "fuel_station": "Fuel station",
    "roundabout": "Roundabout",
    "motorway_junction": "Motorway junction / toll",
    "town_square": "Town or market square",
    "street": "Street",
    "town_hall": "Town hall",
    "government_office": "Government office / prefecture",
    "embassy": "Embassy / consulate",
    "police_station": "Police station",
    "courthouse": "Courthouse",
    "school": "School / university",
    "hospital": "Hospital",
    "train_station": "Train station",
    "bus_depot": "Bus depot / local transport",
    "port": "Port",
    "airport": "Airport",
    "military_base": "Military base",
    "bridge": "Bridge",
    "factory": "Factory / works",
    "office_building": "Office building",
    "shopping_centre": "Shopping centre",
    "warehouse": "Warehouse / logistics",
    "power_plant": "Power plant",
    "stadium": "Stadium",
    "church": "Church / place of worship",
    "monument": "Monument / memorial",
    "park": "Park / garden",
    "car_park": "Car park",
    "city": "City or area (no precise place)",
    "generic_building": "Building",
    "rally": "Outdoor gathering",
}
MODEL_TYPES = tuple(MODEL_LABEL)

# Kinds whose model is the kind itself, whatever the name says (a fuel
# station's name is its street address; a roundabout named after the
# supermarket beside it is still a roundabout).
FORCED = {"refinery": "refinery", "fuel_depot": "fuel_depot", "fuel_station": "fuel_station",
          "roundabout": "roundabout"}

# The kind's default when the name says nothing.
KIND_DEFAULT = {"gathering": "rally", "assembly": "rally", "action": "rally", "strike": "city",
                "arms_company": "factory", "lobby_office": "office_building", "listed_site": "generic_building"}

# A company on a target map: only these types may come from its name (an
# arms works called "… Route de Guerry" is not a street).
COMPANY_TYPES = {"office_building", "school", "airport", "port", "military_base", "warehouse", "factory",
                 "power_plant", "government_office", "hospital", "shopping_centre"}
COMPANY_KINDS = ("arms_company", "lobby_office", "listed_site")

# An Italian strike's model is the transport it stops (MIT strike sectors).
STRIKE_SECTOR = (
    ("ferroviar", "train_station"), ("aereo", "airport"), ("marittim", "port"), ("portual", "port"),
    ("autostrad", "motorway_junction"), ("trasporto_merci", "warehouse"), ("merci", "warehouse"),
    ("trasporto_pubblico_locale", "bus_depot"), ("tpl", "bus_depot"),
)

# A target map's sector (Framacarte "La guerre se fabrique près de chez nous").
SECTOR = (
    (r"formation|recherche|research|universit|ecole|laborat", "school"),
    (r"marchandise|logisti|transport|fret", "warehouse"),
    (r"soutien|service|conseil|consult|financ|banque|assurance|lobby|bureau", "office_building"),
)


def fold(s) -> str:
    """lower case, no accents, ß → ss, curly quotes straight."""
    s = str(s or "").replace("ß", "ss").replace("’", "'").replace("‘", "'")
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower().strip()


def _rx(words: str):
    return re.compile(words)


# 1. Landmarks known by name.
LANDMARKS = [
    ("government_office", _rx(r"\b(quai d'orsay|downing street|whitehall|palais de l'elysee|elysee|matignon|"
                              r"palais bourbon|palais du luxembourg|westminster|bundeskanzleramt|kanzleramt|"
                              r"berlaymont|palazzo chigi|montecitorio|palazzo madama|la moncloa|"
                              r"houses of parliament|scottish parliament|senedd|stormont|reichstag)\b")),
    ("monument", _rx(r"\b(brandenburger tor|arc de triomphe|tour eiffel|siegessaule|fernsehturm|"
                     r"colonne vendome|cenotaph|nelson's column)\b")),
    ("town_square", _rx(r"\b(miroir d'eau|acampada sol|puerta del sol|grand'?[ -]?place|grote markt)\b")),
    ("generic_building", _rx(r"\b(post office|bureau de poste|la poste|ufficio postale|correos)\b")),
    ("unter_den_linden", _rx(r"^unter den linden\b")),       # a boulevard: street (or a building with a number)
    ("street", _rx(r"\b(champs-elysees|la canebiere|las ramblas|la rambla|via del corso|kurfurstendamm|"
                   r"oxford street|regent street|the mall)\b")),
]

# 2. A leading type word.
LEAD = [
    ("town_square", _rx(r"^(the )?(place|platz|piazza|piazzale|piazzetta|plaza|placa|praca|plein|esplanade|"
                        r"parvis|largo|campo|agora|marktplatz|market square|marche|mercato|mercado|mercat|market)\b")),
    ("shopping_centre", _rx(r"^(zone commerciale|centre commercial|centro commerciale|centro comercial|"
                            r"einkaufszentrum|retail park)\b")),
    ("roundabout", _rx(r"^(ronds?[ -]points?|giratoire|kreisverkehr|rotonda|rotatoria|glorieta)\b")),
    ("park", _rx(r"^(the )?(square|jardin|jardins|parc|parque|parco|giardin\w*|bois|butte|park)\b")),
    ("bridge", _rx(r"^(the )?(pont|ponte|puente)\b")),
    ("train_station", _rx(r"^(la )?(gare|estacion|estacio|stazione)\b")),
    ("motorway_junction", _rx(r"^(porte de|porte d'|echangeur|peage|barriere de peage|aire de)\b")),
    ("car_park", _rx(r"^(the )?(parking|parkplatz|car park|parkhaus|aparcamiento|parcheggio|tiefgarage)\b")),
    ("street", _rx(r"^(\d+[a-z]?(-\d+[a-z]?)? )?(rue|avenue|av\.?|boulevard|bd|bvd|allee|quai|chemin|route|impasse|"
                   r"cours|via|viale|vicolo|corso|calle|carrer|avinguda|paseo|passeig|rua|strada|sq\.)\b")),
]

# 3. Facility words, most specific first.
RULES = [
    ("embassy", _rx(r"\b(embassy|ambassade|botschaft|embajada|ambaixada|ambasciata|consulat\w*|konsulat\w*|"
                    r"consulate|consolato|high commission)\b")),
    ("police_station", _rx(r"\b(police|polizei\w*|commissariat|gendarmerie|questura|carabinieri|comisaria|"
                           r"policia|mossos|polizia|landeskriminalamt|lka|bka)\b")),
    ("courthouse", _rx(r"\b(palais de justice|tribunal\w*|tribunale|\w*gericht|court ?house|law courts|"
                       r"(crown|county|magistrates'?|high|supreme|royal) courts?|cour d'appel|cour de cassation|"
                       r"juzgado|audiencia|old bailey|justizpalast|palazzo di giustizia)\b")),
    ("government_office", _rx(
        r"\b(prefecture|sous-prefecture|prefettura|ministere|ministry|\w*ministerium|ministero|ministerio|"
        r"parlement|parliament|parlamento|bundestag|bundesrat|landtag|abgeordnetenhaus|assemblee nationale|"
        r"senat|senate|senato|senatsverwaltung|staatskanzlei|government|gouvernement|regierung\w*|generalitat|"
        r"delegacion del gobierno|centre des impots|finanzamt|hmrc|dgaia|rectorat|conseil regional|"
        r"conseil departemental|county council|regional council|european commission|commission europeenne|"
        r"council of the european union|european council|european parliament|european defence agency|"
        r"nato|otan|home office|foreign office|cabinet office|treasury|bundesamt|agentur fur arbeit|"
        r"jobcenter|pole emploi|france travail|caf|urssaf|cpam|hotel de region|hotel du departement)\b")),
    ("town_hall", _rx(r"\b(hotel de ville|mairie|rathaus|\w+rathaus|town hall|city hall|guildhall|municipio|"
                      r"ayuntamiento|ajuntament|palazzo comunale|palazzo del comune|stadhuis|gemeentehuis|"
                      r"maison communale|capitole|bezirksamt)\b")),
    ("hospital", _rx(r"\b(hopital|hospital|hopitaux|chu|chru|chr|clinique|klinik\w*|krankenhaus|charite|"
                     r"ospedale|policlinico|clinica|infirmary|nhs)\b")),
    ("school", _rx(r"\b(ecole|lycee|college|universite|university|universitat|universita|universidad|"
                   r"hochschule|fachhochschule|gymnasium|grundschule|\w+schule|schule|scuola|liceo|istituto|"
                   r"instituto|campus|faculte|fakultat|facultad|sorbonne|sciences po|iut|institut|"
                   r"laboratoire|laboratory|laboratorio|cnrs|inria|onera|cea)\b")),
    ("military_base", _rx(r"\b(raf|base aerienne|base navale|base militaire|base de defense|caserne|kaserne|"
                          r"\w+kaserne|military base|air base|airbase|barracks|camp militaire|quartier militaire|"
                          r"arsenal|naval base|fliegerhorst|bundeswehr|ba ?\d{3}|regiment|garrison|"
                          r"caserma|cuartel|aeronautica militare|ministry of defence|mod)\b")),
    ("airport", _rx(r"\b(aeroport|airport|\w*flughafen|aeroporto|aeropuerto|aerodrome|airfield|roissy|orly|"
                    r"heathrow|gatwick|stansted|tegel|schonefeld|fiumicino|malpensa|barajas|el prat)\b")),
    ("train_station", _rx(r"\b(gare|\w*bahnhof\w*|hbf|railway station|train station|stazione|estacion|estacio|"
                          r"s-bahn|u-bahn|metro|underground station|tube station|king's cross|euston|paddington|"
                          r"st pancras|termini|atocha|sants)\b")),
    ("bus_depot", _rx(r"\b(gare routiere|busbahnhof|bus station|bus depot|depot de bus|autostazione|"
                      r"estacion de autobuses|tram depot|betriebshof)\b")),
    ("port", _rx(r"\b(port|vieux-port|\w*hafen|porto|puerto|harbour|harbor|docks?|darse|"
                 r"container terminal|terminal (a )?conteneurs|marina|grand port|port autonome|quayside)\b")),
    ("bridge", _rx(r"\b(pont|\w*brucke|bridge|ponte|puente|viaduc|viaduct|viadotto)\b")),
    ("power_plant", _rx(r"\b(centrale (nucleaire|thermique|electrique|a charbon|a gaz|hydraulique)|cnpe|"
                        r"\w*kraftwerk|power (station|plant)|nuclear|centrale termoelettrica|"
                        r"central (nuclear|termica))\b")),
    ("stadium", _rx(r"\b(stade|stadion|\w+stadion|stadium|estadio|stadio|arena|velodrome|palais des sports|"
                    r"sportpark|domes?|olympiapark|parc des princes|hippodrome|sporthalle)\b")),
    ("shopping_centre", _rx(r"\b(centre commercial|zone commerciale|einkaufszentrum|shopping (centre|center|mall)|mall|"
                            r"galeries? lafayette|printemps|arkaden|westfield|centro commerciale|centro comercial|"
                            r"hypermarche|supermarche|supermarkt|carrefour|auchan|leclerc|intermarche|super u|lidl|"
                            r"aldi|ikea|leroy merlin|primark|kaufhaus|kadewe|les halles|forum des halles|"
                            r"grand magasin|department store|retail park|outlet|marche couvert|markthalle)\b")),
    ("factory", _rx(r"\b(usine|\w+werk|werk|works|factory|fabrique|fabbrica|fabrica|manufactur\w*|"
                    r"zone industrielle|industrial estate|industriegebiet|gewerbegebiet|acieries?|chantier naval|"
                    r"shipyard|werft|fonderie|foundry|stabilimento|poudrerie|pyrotechnie)\b")),
    ("warehouse", _rx(r"\b(entrepot|warehouse|logisti\w*|distribution cent(re|er)|amazon|plateforme logistique|"
                      r"magazzino|almacen|fret|freight|\w+lager|zone d'activites?|parc d'activites?)\b")),
    ("office_building", _rx(r"\b(bank|banque|banca|banco|banc|barclays|hsbc|lloyds|natwest|santander|"
                            r"deutsche bank|bnp|societe generale|credit agricole|credit mutuel|bourse|borse|"
                            r"stock exchange|pension fund|insurance|assurance|versicherung|headquarters|hq|"
                            r"siege( social)?|registered office|head office|offices?|bureaux?|\w*buro|"
                            r"tower|towers|business park|immeuble|lobby|shell centre|chamber of commerce|cci|"
                            r"medef|bdi|confindustria|treuhand|verlag|axel-springer)\b")),
    ("church", _rx(r"\b(eglise|church|chapel|chapelle|kirche|\w+kirche|dom|munster|cathedral|cathedrale|"
                   r"basilique|basilica|chiesa|duomo|iglesia|catedral|esglesia|abbaye|abbey|temple|synagogue|"
                   r"synagoge|moschee|mosque|mosquee|kloster|monastery|minster|sacre-coeur|notre-dame|"
                   r"presbytere)\b")),
    ("monument", _rx(r"\b(monument|memorial|denkmal|\w+denkmal|mahnmal|ehrenmal|gedenkstatte|statue|obelisk|"
                     r"obelisque|tor|colonne|column|war memorial|fontaine|fountain|brunnen|monumento|"
                     r"cenotafio|castle|chateau|schloss|palais|palazzo|palacio|museum|musee|museo)\b")),
    ("park", _rx(r"\b(parc|park|jardin|jardins|\w*garten|gardens?|parque|parco|giardin\w*|tiergarten|"
                 r"bois de|common|heath|hoe|butte|plage|beach|strand|lac|lake|wiese|\w+wiese|feld)\b")),
    ("car_park", _rx(r"\b(parking|parkplatz|car park|parkhaus|aparcamiento|parcheggio|tiefgarage)\b")),
    ("motorway_junction", _rx(r"\b(peage|toll|autoroute|autobahn|\w+autobahn|motorway|autostrada|autopista|"
                              r"autovia|echangeur|anschlussstelle|autobahnkreuz|autobahndreieck|raststatte|"
                              r"peripherique|rocade|bretelle|interchange|svincolo|casello|"
                              r"a\d{1,3}|m\d{1,2}|e\d{2})\b")),
    ("roundabout", _rx(r"\b(ronds?-points?|ronds? points?|rondpoint|giratoire|roundabout|kreisverkehr|rotonda|rotatoria|"
                       r"glorieta|rotonde)\b")),
    ("town_square", _rx(r"\b(place|platz|\w+platz|piazza|piazzale|plaza|placa|praca|plein|\w*markt|"
                        r"market square|buttermarket|square|esplanade|parvis|agora|forum|piazzetta|largo|"
                        r"zocalo|rynek|\w+vorplatz|marche|mercato|mercado|mercat|market)\b")),
    ("generic_building", _rx(r"\b(hall|halle|salle|theatre|theater|cinema|kino|opera|oper|bibliotheque|library|"
                             r"bibliothek|biblioteca|maison|haus|centre culturel|kulturzentrum|community centre|"
                             r"post office|la poste|bureau de poste|hotel|residence)\b")),
    ("street", _rx(r"\b(\w+strasse|strasse|\w+str\.?|str|\w+weg|\w+allee|\w+damm|\w+ufer|chaussee|"
                   r"\w*promenade|\w+gasse|\w+steig|\w+zeile|\w+graben|street|road|rd|lane|avenue|ave|"
                   r"boulevard|landstrasse|high st|st)\b")),
]

_HOUSE_NUMBER = re.compile(r"(^\d+[a-z]?(-\d+[a-z]?)?\b)|(\b\d+[a-z]?(-\d+[a-z]?)?$)|(\b\d+[a-z]?(-\d+)?,)")
# An area rather than a place: a province, a region, a whole country, a postcode.
_AREA = re.compile(r"\((province|region|nationwide|regione|provincia)\)|\b(uk wide|nationwide|worldwide|"
                   r"countrywide|bundesweit|national|central london|estat espanyol|a tot l'estat|"
                   r"tout le territoire|toute la france|italy|all over)\b|^plz \d{5}\b")
_SPLIT = re.compile(r"\s*(?:,|\(|\)| - | — | – |;)\s*")


def _segments(name: str) -> list[str]:
    return [s for s in (x.strip(" .'\"") for x in _SPLIT.split(fold(name))) if s]


def classify_all(name: str) -> list[str]:
    """What each segment of the name says, head first (segments that say
    nothing are left out)."""
    return [t for t in (_classify_segment(seg) for seg in _segments(name)) if t]


def classify_name(name: str) -> str | None:
    """The model type a name says, or None. Head segment first."""
    hits = classify_all(name)
    return hits[0] if hits else None


def _classify_segment(seg: str) -> str | None:
    for t, rx in LANDMARKS:
        if rx.search(seg):
            if t == "unter_den_linden":
                return "generic_building" if _HOUSE_NUMBER.search(seg) else "street"
            return t
    for t, rx in LEAD:
        if rx.search(seg):
            if t == "street" and _HOUSE_NUMBER.search(seg):
                return "generic_building"
            return t
    for t, rx in RULES:
        if rx.search(seg):
            if t == "street" and _HOUSE_NUMBER.search(seg):
                return "generic_building"
            return t
    return None


def _strike_type(p: dict) -> str:
    # the transport most of its strikes stop; a general strike is the city
    votes: dict[str, int] = {}
    for c in p.get("calls") or []:
        k = str(c.get("kind") or "") + " " + fold(c.get("topic") or "")
        t = "city" if ("generale" in k or "plurisettoriale" in k) else \
            next((t for key, t in STRIKE_SECTOR if key in k), None)
        if t:
            votes[t] = votes.get(t, 0) + 1
    return max(votes, key=lambda t: votes[t]) if votes else "city"


def _is_area(p: dict) -> bool:
    n = fold(p.get("name"))
    if _AREA.search(n):
        return True
    city = fold(p.get("city"))
    head = _segments(p.get("name") or "")
    # "Lyon", "Lons-le-Saunier": the name is only a town
    return bool(head) and (head[0] == city or (len(head) == 1 and re.fullmatch(r"[a-z'\-]+", head[0]) is not None))


def model_type(p: dict) -> str:
    """The model to show for a place (see the module docstring)."""
    kind = str(p.get("kind") or "")
    if kind in FORCED:
        return FORCED[kind]
    if kind == "strike":
        return _strike_type(p)
    name = p.get("name") or ""
    if kind in COMPANY_KINDS:
        # "Rue de la Loi 200 - European Commission": the address says a
        # building, the second segment what the building is
        t = next((x for x in classify_all(name) if x in COMPANY_TYPES), None)
        if t:
            return t
        sector = fold(" ".join(str(p.get(k) or "") for k in ("sector", "domain")))
        for rx, st in SECTOR:
            if re.search(rx, sector):
                return st
        return KIND_DEFAULT[kind]
    t = classify_name(name)
    if t:
        return t
    if _is_area(p) and not re.search(r"lieu a preciser|a preciser|to be confirmed|tbc", fold(name)):
        return "city"
    if kind in ("gathering", "assembly", "action") and _HOUSE_NUMBER.search(fold(name).split(",")[0]):
        return "generic_building"                             # an assembly outside a building at an address
    return KIND_DEFAULT.get(kind, "generic_building")


def model_label(t: str) -> str:
    return MODEL_LABEL.get(t, MODEL_LABEL["generic_building"])
