"""place_types.py — what stands at an endangered place (its 3D model type),
derived from the kind and the name in French, German, Italian, Spanish,
Catalan and English (owner, 2026-10-12)."""
import pathlib

import pytest

import place_types as pt


@pytest.mark.parametrize("kind,name,want", [
    # forced by the kind, whatever the name says
    ("refinery", "Raffinerie de Feyzin", "refinery"),
    ("fuel_depot", "Entrepôt pétrolier de Lyon", "fuel_depot"),
    ("fuel_station", "Fuel station, Place de la Renaissance", "fuel_station"),
    ("roundabout", "Sous-préfecture", "roundabout"),
    # squares and market squares, every language
    ("gathering", "Place Bellecour", "town_square"),
    ("gathering", "Place de l'Hôtel de Ville", "town_square"),          # the leading word wins
    ("assembly", "Alexanderplatz, Berlin", "town_square"),
    ("assembly", "Platz der Republik 1, Berlin", "town_square"),
    ("assembly", "Altmarkt, Dresden", "town_square"),
    ("action", "Plaça del Sortidor, Barcelona", "town_square"),
    ("action", "Plaza Cibeles, Madrid", "town_square"),
    ("action", "The Buttermarket Square, Canterbury, CT1 2HW", "town_square"),
    ("gathering", "Piazza del Duomo", "town_square"),
    ("gathering", "Marktplatz", "town_square"),
    ("gathering", "Marché des Etats-Unis", "town_square"),               # a market square
    ("gathering", "Champs-Élysées", "street"),
    ("gathering", "Ronds point bleu", "roundabout"),
    ("gathering", "Zone Commerciale de Châteaufarine", "shopping_centre"),
    # civic buildings
    ("gathering", "Préfecture", "government_office"),
    ("gathering", "Sous-préfecture", "government_office"),
    ("gathering", "Quai d'Orsay", "government_office"),                  # a landmark, not a quay
    ("action", "Houses of Parliament, Parliament Square, London SW1A 0AA", "government_office"),
    ("gathering", "Hôtel de Ville", "town_hall"),
    ("gathering", "Mairie de Lyon", "town_hall"),
    ("assembly", "Rotes Rathaus", "town_hall"),
    ("assembly", "Rathausstr., Berlin", "street"),                       # a street named after it is a street
    ("assembly", "Botschaft der Vereinigten Staaten", "embassy"),
    ("gathering", "Ambassade d'Israël", "embassy"),
    ("gathering", "Commissariat central", "police_station"),
    ("assembly", "Polizeipräsidium", "police_station"),
    ("gathering", "Palais de Justice", "courthouse"),
    ("assembly", "Amtsgericht Tiergarten", "courthouse"),
    ("gathering", "Lycée du Dauphiné", "school"),
    ("assembly", "Humboldt-Universität", "school"),
    ("gathering", "CHU de Nantes", "hospital"),
    ("assembly", "Charité", "hospital"),
    # transport
    ("action", "Gare des Guillemins, Liège", "train_station"),
    ("action", "Bahnhofsvorplatz, Würzburg", "train_station"),
    ("gathering", "Rue de la Gare", "street"),                           # the street, not the station
    ("assembly", "Jannowitzbrücke, Berlin", "bridge"),
    ("gathering", "Pont Royal", "bridge"),
    ("gathering", "Vieux-Port, Canebière", "port"),
    ("gathering", "Aéroport de Nantes", "airport"),
    ("assembly", "Flughafen BER", "airport"),                            # not a port ("…hafen")
    ("gathering", "Péage de Saint-Arnoult", "motorway_junction"),
    ("gathering", "Porte de Clichy", "motorway_junction"),
    ("action", "Main gate of RAF Lakenheath Chester St, Lakenheath", "military_base"),
    # other places
    ("gathering", "Châtelet-les Halles", "shopping_centre"),
    ("gathering", "Centre commercial Part-Dieu", "shopping_centre"),
    ("gathering", "Jardins de l'hôpital", "park"),                       # the leading word wins
    ("gathering", "Square de Boston", "park"),                           # a French square is a garden
    ("action", "Bonn, Hofgarten", "park"),
    ("action", "Brighton War Memorial, North Steine Gardens", "monument"),
    ("gathering", "Cathédrale Notre-Dame", "church"),
    ("assembly", "Kaiser-Wilhelm-Gedächtniskirche", "church"),
    ("assembly", "Kirchstr. 6, Berlin", "generic_building"),            # not a church: an address
    ("gathering", "Stade de France", "stadium"),
    ("gathering", "Centrale nucléaire de Golfech", "power_plant"),
    ("gathering", "Parking du 8-Mai, Verdun", "car_park"),
    ("gathering", "Zone Industrielle de Ruitz", "factory"),
    ("action", "Barclays, Princesshay, Exeter, EX1 1LX", "office_building"),
    ("action", "Great Malvern Post Office, 1 Abbey Road, Malvern", "generic_building"),
    # streets and addresses
    ("gathering", "Rue de Rivoli", "street"),
    ("assembly", "Wilmersdorfer Str., Berlin", "street"),
    ("assembly", "Prager Straße, Dresden", "street"),
    ("assembly", "Gürtelstr. 39, Berlin", "generic_building"),
    ("gathering", "3 Rue de Bitche", "generic_building"),
    ("assembly", "Unter den Linden 80, Berlin", "generic_building"),
    ("assembly", "Unter den Linden, Berlin", "street"),
    # a town, an area
    ("gathering", "Lyon", "city"),
    ("gathering", "Lons-le-Saunier", "city"),
    ("action", "Central London", "city"),
    ("action", "UK wide", "city"),
    ("assembly", "PLZ 10117, Berlin", "city"),
    # nothing said: the kind's default
    ("gathering", "Lieu à préciser", "rally"),
    ("action", "La Violette, Liège", "rally"),
    ("arms_company", "Thales SIX GTS", "factory"),
    ("arms_company", "Route de Guerry", "factory"),                      # a company is not a street
    ("arms_company", "BAE SYSTEMS (OPERATIONS) LIMITED — registered office", "office_building"),
    ("arms_company", "Dassault - Siège social", "office_building"),
    ("arms_company", "Laboratoire d'Astrophysique de Marseille (LAM)", "school"),
    ("lobby_office", "Av. des Arts 21 - Leonardo", "office_building"),
    ("lobby_office", "Rue de la Loi 200 - European Commission", "government_office"),
    ("listed_site", "Some site", "generic_building"),
])
def test_model_type_from_kind_and_name(kind, name, want):
    assert pt.model_type({"kind": kind, "name": name}) == want


def test_company_sector_decides_when_the_name_says_nothing():
    assert pt.model_type({"kind": "arms_company", "name": "CMA CGM", "sector": "Marchandises"}) == "warehouse"
    assert pt.model_type({"kind": "arms_company", "name": "D.C.I.", "sector": "Soutien entreprise"}) == "office_building"
    assert pt.model_type({"kind": "arms_company", "name": "X", "sector": "FORMATION/RECHERCHE"}) == "school"
    assert pt.model_type({"kind": "arms_company", "name": "Y", "sector": "FABRICATION"}) == "factory"


def test_strike_is_the_transport_it_stops():
    def strike(*kinds, topic=""):
        return {"kind": "strike", "name": "Bari (province)", "calls": [{"kind": k, "topic": topic} for k in kinds]}
    assert pt.model_type(strike("strike_ferroviario")) == "train_station"
    assert pt.model_type(strike("strike_aereo", "strike_aereo", "strike_trasporto_merci")) == "airport"
    assert pt.model_type(strike("strike_marittimo")) == "port"
    assert pt.model_type(strike("strike_trasporto_pubblico_locale")) == "bus_depot"
    assert pt.model_type(strike("strike_trasporto_merci")) == "warehouse"
    assert pt.model_type(strike("strike_generale")) == "city"
    assert pt.model_type({"kind": "strike", "name": "Italy (nationwide)", "calls": []}) == "city"


def test_city_named_as_the_place():
    assert pt.model_type({"kind": "gathering", "name": "Annecy", "city": "Annecy"}) == "city"
    assert pt.model_type({"kind": "gathering", "name": "Lieu à préciser", "city": "Redon"}) == "rally"


def test_every_model_type_has_a_model_file_and_a_label():
    root = pathlib.Path(__file__).resolve().parent.parent / "public" / "models" / "place"
    for t in pt.MODEL_TYPES:
        assert (root / f"{t}.glb").exists(), t
        assert pt.model_label(t)
    assert set(pt.FORCED.values()) | set(pt.KIND_DEFAULT.values()) <= set(pt.MODEL_TYPES)
    assert pt.model_label("nonsense") == "Building"


def test_fold():
    assert pt.fold("Schloßstraße") == "schlossstrasse"
    assert pt.fold("Plaça d’Espanya") == "placa d'espanya"
