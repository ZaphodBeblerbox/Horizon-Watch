"""rss_pulse.py — the news family of the risk index: countries and
violence/unrest read from EN/ES/PT/FR headlines without a model, stored
once per URL, counted per country so a share can be taken."""
import datetime as dt
import sqlite3

import rss_pulse as rp

NOW = dt.datetime(2026, 10, 18, 12, 0, tzinfo=dt.timezone.utc)


def test_countries_in_spanish_portuguese_french_and_english():
    assert rp.countries_in("Protestas en México y Perú") == ["mx", "pe"]
    assert rp.countries_in("Apoiadores no Brasil") == ["br"]
    assert rp.countries_in("Haïti : la PNH à Port-au-Prince") == ["ht"]
    assert rp.countries_in("Más de 2.000 detenidos en Francia") == ["fr"]
    assert rp.countries_in("Estados Unidos reactiva destacamento en embajada de Caracas") == ["us", "ve"]
    assert rp.countries_in("Junta airstrikes in Sagaing, Myanmar") == ["mm"]
    assert rp.countries_in("República Dominicana y Haití") == ["do", "ht"]


def test_names_that_are_not_the_country():
    assert rp.countries_in("Snow in New Mexico") == []
    assert rp.countries_in("Wildfire in British Columbia") == []
    assert rp.countries_in("Real Madrid gana") == []
    assert rp.countries_in("La ira de los vecinos") == []          # 'ira' is not Iran
    assert "us" not in rp.countries_in("La policía usa gases")    # 'usa' is a verb


def test_violence_and_unrest_in_four_languages():
    assert rp.classify("Asesinan a líder social en el Cauca")["conflict"]
    assert rp.classify("Tiroteio termina com apreensão de fuzis")["conflict"]
    assert rp.classify("Plus de 10 mille déplacés par les violences des gangs")["conflict"]
    assert rp.classify("Six civilians killed in junta airstrikes")["conflict"]
    assert rp.classify("Protestas por el retiro de obras del museo")["unrest"]
    assert rp.classify("Greve geral paralisa São Paulo")["unrest"]


def test_not_violence():
    assert not rp.classify("Dos muertos en accidente de tránsito en Lima")["conflict"]
    assert not rp.classify("Universitario vs Alianza: golazo en la Liga 1 y fútbol")["conflict"]
    assert not rp.classify("Día de Muertos: así luce el altar")["conflict"]
    c = rp.classify("El Banco Mundial y la economía")
    assert not c["conflict"] and not c["unrest"]


def test_an_article_naming_no_country_goes_to_the_outlets_home():
    assert rp.item_countries("Asesinan a líder social", "", "co") == (["co"], True)
    assert rp.item_countries("Asesinan a líder social", "", None) == ([], False)
    assert rp.item_countries("Ataque en Venezuela", "", "co") == (["ve"], False)


def _entry(title, link, days_old=0, summary=""):
    t = (NOW - dt.timedelta(days=days_old)).timetuple()
    return {"title": title, "link": link, "summary": summary, "published_parsed": t}


def test_read_entries_drops_stale_and_untitled():
    feed = {"name": "El Tiempo", "home": "co", "lang": "es"}
    items = rp.read_entries(feed, [
        _entry("Ataque con explosivos en Popayán", "https://x/1"),
        _entry("Old news", "https://x/2", days_old=10),
        _entry("", "https://x/3"),
    ], NOW)
    assert [i["url"] for i in items] == ["https://x/1"]
    assert items[0]["countries"] == ["co"] and items[0]["conflict"] and items[0]["outlet_home"] == "co"


def test_store_counts_once_and_keeps_only_security_items():
    con = rp.connect(":memory:")
    feed = {"name": "El Tiempo", "home": "co", "lang": "es"}
    items = rp.read_entries(feed, [
        _entry("Ataque con explosivos en Popayán", "https://x/1"),
        _entry("El clima del domingo", "https://x/2"),
        _entry("Protestas en Venezuela", "https://x/3"),
    ], NOW)
    assert rp.store(con, items, NOW) == {"new": 3, "kept": 2}
    assert rp.store(con, items, NOW) == {"new": 0, "kept": 0}        # read again: nothing new
    st = rp.country_stats(7, now=NOW, con=con)
    assert st["co"]["total"] == 2 and st["co"]["conflict"] == 1 and st["co"]["domestic_total"] == 2
    assert st["co"]["domestic_conflict"] == 1
    assert st["ve"]["total"] == 1 and st["ve"]["unrest"] == 1 and st["ve"]["domestic_total"] == 0
    assert st["co"]["outlets"] == 1
    rp.prune(con, NOW + dt.timedelta(days=60))
    assert rp.country_stats(7, now=NOW, con=con) == {}


def test_country_stats_without_tables_is_empty():
    assert rp.country_stats(7, now=NOW, con=sqlite3.connect(":memory:")) == {}


def test_national_feeds_are_well_formed():
    import rss_feeds
    urls = [u for _n, u, _c, _l in rss_feeds.NATIONAL_FEEDS]
    assert len(urls) == len(set(urls))
    for name, url, cc, lang in rss_feeds.NATIONAL_FEEDS:
        assert url.startswith("https://"), name
        assert cc is None or len(cc) == 2, name
        assert lang in ("es", "pt", "fr", "en", "my"), name
    homes = {c for _n, _u, c, _l in rss_feeds.NATIONAL_FEEDS}
    for cc in ("ve", "co", "mx", "br", "ec", "pe", "bo", "ar", "cl", "ht", "gt", "hn", "ni", "mm"):
        assert cc in homes, cc
    assert len(rp.feed_list()) > len(rss_feeds.NATIONAL_FEEDS)
