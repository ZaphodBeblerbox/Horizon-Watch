"""
briefing/countries.py — country names in the issue's language.

geo/countries.geojson names countries in English; a German issue should
say "Vereinigte Arabische Emirate", a French one "Émirats arabes unis".
The countries the interest regions name and Europe; any other keeps its
English name.
"""
_T = """United Arab Emirates|Vereinigte Arabische Emirate|Émirats arabes unis
Germany|Deutschland|Allemagne
France|Frankreich|France
United Kingdom|Vereinigtes Königreich|Royaume-Uni
United States of America|Vereinigte Staaten|États-Unis
Netherlands|Niederlande|Pays-Bas
Belgium|Belgien|Belgique
Luxembourg|Luxemburg|Luxembourg
Switzerland|Schweiz|Suisse
Austria|Österreich|Autriche
Italy|Italien|Italie
Spain|Spanien|Espagne
Portugal|Portugal|Portugal
Poland|Polen|Pologne
Czechia|Tschechien|Tchéquie
Czech Republic|Tschechien|Tchéquie
Slovakia|Slowakei|Slovaquie
Hungary|Ungarn|Hongrie
Romania|Rumänien|Roumanie
Bulgaria|Bulgarien|Bulgarie
Greece|Griechenland|Grèce
Turkey|Türkei|Turquie
Ukraine|Ukraine|Ukraine
Russia|Russland|Russie
Belarus|Belarus|Biélorussie
Moldova|Moldau|Moldavie
Georgia|Georgien|Géorgie
Estonia|Estland|Estonie
Latvia|Lettland|Lettonie
Lithuania|Litauen|Lituanie
Finland|Finnland|Finlande
Sweden|Schweden|Suède
Norway|Norwegen|Norvège
Denmark|Dänemark|Danemark
Ireland|Irland|Irlande
Serbia|Serbien|Serbie
Croatia|Kroatien|Croatie
Kosovo|Kosovo|Kosovo
Yemen|Jemen|Yémen
Saudi Arabia|Saudi-Arabien|Arabie saoudite
Eritrea|Eritrea|Érythrée
Djibouti|Dschibuti|Djibouti
Somalia|Somalia|Somalie
Ethiopia|Äthiopien|Éthiopie
Sudan|Sudan|Soudan
South Sudan|Südsudan|Soudan du Sud
Egypt|Ägypten|Égypte
Iran|Iran|Iran
Iraq|Irak|Irak
Kuwait|Kuwait|Koweït
Bahrain|Bahrain|Bahreïn
Qatar|Katar|Qatar
Oman|Oman|Oman
Israel|Israel|Israël
Palestine|Palästina|Palestine
Lebanon|Libanon|Liban
Syria|Syrien|Syrie
Jordan|Jordanien|Jordanie
Mali|Mali|Mali
Burkina Faso|Burkina Faso|Burkina Faso
Niger|Niger|Niger
Chad|Tschad|Tchad
Mauritania|Mauretanien|Mauritanie
Nigeria|Nigeria|Nigeria
Democratic Republic of the Congo|Demokratische Republik Kongo|République démocratique du Congo
Rwanda|Ruanda|Rwanda
Uganda|Uganda|Ouganda
Burundi|Burundi|Burundi
United Republic of Tanzania|Tansania|Tanzanie
Kenya|Kenia|Kenya
Taiwan|Taiwan|Taïwan
China|China|Chine
Philippines|Philippinen|Philippines
Vietnam|Vietnam|Viêt Nam
Malaysia|Malaysia|Malaisie
Japan|Japan|Japon
North Korea|Nordkorea|Corée du Nord
South Korea|Südkorea|Corée du Sud
India|Indien|Inde
Pakistan|Pakistan|Pakistan
Afghanistan|Afghanistan|Afghanistan
Bangladesh|Bangladesch|Bangladesh
Myanmar|Myanmar|Birmanie
Sri Lanka|Sri Lanka|Sri Lanka
Nepal|Nepal|Népal
Venezuela|Venezuela|Venezuela
Colombia|Kolumbien|Colombie
Mexico|Mexiko|Mexique
Brazil|Brasilien|Brésil
Ecuador|Ecuador|Équateur
Peru|Peru|Pérou
Haiti|Haiti|Haïti
Cuba|Kuba|Cuba
Libya|Libyen|Libye
Tunisia|Tunesien|Tunisie
Algeria|Algerien|Algérie
Morocco|Marokko|Maroc
Indonesia|Indonesien|Indonésie
Singapore|Singapur|Singapour
Australia|Australien|Australie
Canada|Kanada|Canada"""
NAMES = {}
for _line in _T.splitlines():
    en, de, fr = _line.split("|")
    NAMES[en] = {"en": en, "de": de, "fr": fr}


def name(country: str | None, lang: str) -> str:
    if not country:
        return ""
    return (NAMES.get(country) or {}).get(lang, country)
