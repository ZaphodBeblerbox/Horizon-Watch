"""street_reports.py: casual street language → typed, located signals."""
import datetime as dt

import pytest

import street_reports as sr

NOW = dt.datetime(2026, 10, 18, 16, 0, tzinfo=dt.timezone.utc)


def _post(text, mid=1, chan="GJ2026IDF", minutes_ago=5, **kw):
    t = (NOW - dt.timedelta(minutes=minutes_ago)).isoformat()
    return {"channel": chan, "msg_id": mid, "channel_title": kw.pop("title", "GJ 2026 IDF"), "posted_at": t, "text": text,
            "media": kw.pop("media", "none"), "thumb": kw.pop("thumb", None), "summary_en": kw.pop("summary_en", None),
            "lat": kw.pop("lat", None), "lon": kw.pop("lon", None), "precision": kw.pop("precision", None),
            "place": kw.pop("place", None), "country_code": kw.pop("country_code", None), **kw}


PARIS = {"GJ2026IDF": {"city": "Paris", "protest": True}, "GJ2026ARA": {"city": "Lyon", "protest": True}}


def kinds(text):
    return [t["kind"] for t in sr.tactics(text)]


# ── lexicon ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text", ["ça gaze à répu", "ça gaz à Répu", "ÇA GAZE À RÉPU !!!", "ils gazent tout le monde à Bastoche",
                                  "lacrymo partout sur Nation", "on se fait gazer à Châtelet", "gaz lacrymogène place d'Italie",
                                  "están lanzando lacrimógenas en Altamira", "Police fire tear gas at Trafalgar Square",
                                  "မျက်ရည်ယိုဗုံး ပစ်နေတယ် ဆူးလေ"])
def test_tear_gas(text):
    assert kinds(text)[0] == "tear_gas"


@pytest.mark.parametrize("text", ["ça nasse à Répu", "ils sont en train de faire une nasse bd saint germain",
                                  "on est encerclés à Nation", "on peut plus sortir de Bastille",
                                  "nos tienen rodeados en Plaza Venezuela", "we're kettled at Parliament Square"])
def test_kettle(text):
    assert "kettle" in kinds(text)


@pytest.mark.parametrize("text,kind", [
    ("les CRS chargent bd Voltaire", "charge"),
    ("ça charge à Nation", "charge"),
    ("tirs de LBD à Bastille", "lbd"),
    ("canon à eau place de la République", "water_cannon"),
    ("plusieurs interpellations à Châtelet", "arrests"),
    ("barricades rue de Rivoli", "barricade"),
    ("poubelles en feu à Barbès", "fire"),
    ("la ballena en Chacaíto", "water_cannon"),
    ("perdigones en Altamira", "lbd"),
    ("detenidos en Plaza Venezuela", "arrests"),
    ("guarimbas en Chacao", "barricade"),
    ("disparos en Petare", "gunfire"),
])
def test_other_tactics(text, kind):
    assert kind in kinds(text)


@pytest.mark.parametrize("text", ["les flics arrivent à Répu", "les keufs débarquent à Bastoche", "y'a des CRS partout à Nation",
                                  "la BAC remonte bd Magenta", "gendarmes mobiles qui se positionnent à Concorde",
                                  "la GNB llegó a Plaza Venezuela", "colectivos llegando a Petare"])
def test_police_arrival(text):
    assert "police_arrival" in kinds(text)


def test_ca_bouge_is_vague():
    t = sr.tactics("ça bouge à Répu")
    assert t and t[0]["kind"] == "police_arrival" and t[0].get("vague")


@pytest.mark.parametrize("text", ["le prix du gaz augmente", "Macron va charger le gouvernement", "la nation française",
                                  "vive la République", "gas prices in Caracas", "on est fatigués", "bonne soirée à tous"])
def test_not_reports(text):
    reps = sr.read_post(_post(text), chat_city="Paris", protest_chat=True)
    assert reps == [] or all(r["lat"] is None for r in reps)


# ── places ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,pid", [
    ("ça gaze à répu", "republique"), ("on est à Bastoche", "bastille"), ("lacrymo sur Nation", "nation"),
    ("ça charge à Châtelet", "chatelet"), ("nasse gare de l'Est", "gare_de_l_est"), ("ça bouge à Gare du Nord", "gare_du_nord"),
    ("CRS place d'Italie", "italie"), ("on est à la Concorde", "concorde"), ("ça gaze vers Troca", "trocadero"),
    ("les CRS chargent bd Voltaire", "bd_voltaire"), ("ça gaze à St Mich", "saint_michel"),
    ("lacrimógenas en Plaza Altamira", "ccs_altamira"), ("la GNB en Altamira", "ccs_altamira"),
    ("ဆူးလေ မှာ စစ်သားတွေ ရောက်လာ", "ygn_sule"),
])
def test_place(text, pid):
    p = sr.place_in(text, "Paris")
    assert p and p["id"] == pid


def test_strict_aliases_need_a_preposition():
    assert sr.place_in("Vive la République !") is None
    assert sr.place_in("la nation est en colère") is None
    assert sr.place_in("rdv à République")["id"] == "republique"


def test_model_place_resolves_to_the_gazetteer_point():
    p = sr.place_by_name("Place de la République, Paris, France")
    assert p["id"] == "republique" and p["lat"] == 48.8674


# ── signals ────────────────────────────────────────────────────────────────

def test_ca_gaze_a_repu_is_a_titled_located_signal_with_quote_and_translation():
    sigs = sr.build([_post("ça gaze à Répu")], now=NOW, chats=PARIS)
    assert len(sigs) == 1
    s = sigs[0]
    assert s["tactic"] == "tear_gas"
    assert s["title"] == "Tear gas used at Place de la République (Paris)"
    assert (s["lat"], s["lon"]) == (48.8674, 2.3636)
    assert s["area"]["radius_m"] >= 100
    src = s["sources"][0]
    assert src["text"] == "ça gaze à Répu" and src["url"] == "https://t.me/GJ2026IDF/1"
    assert src["translation"].startswith("Tear gas is being fired at Place de la République")
    assert src["translated_by"] == "rule"
    assert "ça gaze à Répu" in s["summary"] and "GJ 2026 IDF" in s["summary"]


def test_model_translation_wins_over_the_gloss():
    s = sr.build([_post("ça gaze à Répu", summary_en="Tear gas being used at République.")], now=NOW, chats=PARIS)[0]
    assert s["sources"][0]["translation"] == "Tear gas being used at République." and s["sources"][0]["translated_by"] == "model"


def test_kettle_at_republique_closes_every_osm_exit():
    s = sr.build([_post("ça nasse à Répu")], now=NOW, chats=PARIS)[0]
    assert s["title"] == "Kettle at Place de la République (Paris) — exits blocked"
    assert s["label"].startswith("Kettled — exits blocked (reported ")
    assert s["exits_from"] == "osm" and len(s["exits"]) >= 8
    names = {e["name"] for e in s["exits"]}
    assert {"Boulevard de Magenta", "Boulevard Voltaire", "Rue du Temple"} <= names
    for e in s["exits"]:
        assert sr.metres(s["lat"], s["lon"], e["lat"], e["lon"]) < 260


def test_kettle_elsewhere_gets_radial_exits():
    s = sr.build([_post("ils font une nasse à Barbès")], now=NOW, chats=PARIS)[0]
    assert s["exits_from"] == "radial" and len(s["exits"]) == sr.FALLBACK_EXITS


def test_kettle_on_a_street_closes_both_ends():
    s = sr.build([_post("Tout ceux présent sur boulevard saint germain attention ils sont entrain de faire une nasse !")],
                 now=NOW, chats=PARIS)[0]
    assert s["tactic"] == "kettle" and s["exits_from"] == "street" and len(s["exits"]) == 2


def test_crs_charge_bd_voltaire_draws_the_street():
    s = sr.build([_post("les CRS chargent bd Voltaire")], now=NOW, chats=PARIS)[0]
    assert s["title"] == "Police charge on Boulevard Voltaire (Paris)"
    assert len(s["street_line"]) >= 2


def test_police_arriving_by_a_named_street_is_an_arrow_from_it():
    s = sr.build([_post("les CRS arrivent par le bd Magenta à Répu")], now=NOW, chats=PARIS)[0]
    assert s["tactic"] == "police_arrival"
    assert s["title"] == "Police moving in at Place de la République (Paris) from Boulevard de Magenta"
    assert 330 < sr.metres(s["lat"], s["lon"], s["from"]["lat"], s["from"]["lon"]) < 430
    # Magenta leaves République to the north-north-west
    b = sr.bearing(s["lat"], s["lon"], s["from"]["lat"], s["from"]["lon"])
    assert 280 < b or b < 20


def test_on_est_a_bastoche_is_a_crowd():
    s = sr.build([_post("on est à Bastoche")], now=NOW, chats=PARIS)[0]
    assert s["tactic"] == "crowd" and s["place_id"] == "bastille"


def test_video_with_a_caption_in_a_protest_chat_is_a_report():
    s = sr.build([_post("les flics arrivent à Répu", media="video", thumb="GJ2026IDF_1.jpg")], now=NOW, chats=PARIS)[0]
    assert s["tactic"] == "police_arrival" and s["media"] == "video" and s["thumb_url"] == "/api/telegram/media/GJ2026IDF_1.jpg"


def test_video_captioned_only_with_a_place_is_footage():
    s = sr.build([_post("République là maintenant 🔥", media="video")], now=NOW, chats=PARIS)
    assert s == [] or s[0]["tactic"] == "footage"
    s = sr.build([_post("Répu là maintenant 🔥", media="video")], now=NOW, chats=PARIS)[0]
    assert s["tactic"] == "footage" and s["title"] == "Footage from Place de la République (Paris)"


def test_captionless_video_right_after_a_report_joins_it():
    a = _post("ça gaze à Répu", mid=10, minutes_ago=6)
    b = _post("", mid=11, minutes_ago=5, media="video", thumb="x.jpg")
    s = sr.build([a, b], now=NOW, chats=PARIS)
    assert len(s) == 1 and s[0]["media"] == "video" and s[0]["thumb_url"] == "/api/telegram/media/x.jpg"
    # the video plays from the message that carries it, not the words before it
    assert s[0]["video_url"] == "/api/telegram/video/GJ2026IDF/11"
    assert s[0]["sources"][0]["media_msg_id"] == 11 and s[0]["sources"][0]["video_url"] == "/api/telegram/video/GJ2026IDF/11"


def test_same_tactic_same_place_is_one_signal_across_chats():
    posts = [_post("ça gaze à Répu", mid=1, minutes_ago=20), _post("lacrymo place de la République", mid=2, minutes_ago=12),
             _post("gaz à répu", mid=7, chan="GJ2026HDF", minutes_ago=3, title="GJ HDF")]
    s = sr.build(posts, now=NOW, chats=PARIS)
    assert len(s) == 1 and s[0]["n_messages"] == 3 and s[0]["n_channels"] == 2
    assert s[0]["severity"] == "critical"


def test_a_report_stays_after_its_validity_but_is_no_longer_current():
    # owner, 2026-10-19: police at Châtelet an hour ago must not be dimmed or
    # gone; the report stays for the read window, `current` only within its validity
    gas = sr.build([_post("ça gaze à Répu", minutes_ago=90)], now=NOW, chats=PARIS)
    assert len(gas) == 1 and gas[0]["current"] is False and gas[0]["valid_min"] == 60
    assert sr.build([_post("ça nasse à Répu", minutes_ago=90)], now=NOW, chats=PARIS)[0]["current"] is True
    assert sr.build([_post("ça gaze à Répu", minutes_ago=7 * 60)], now=NOW, chats=PARIS) == []      # past the 6 h window
    assert sr.build([_post("ça gaze à Répu", minutes_ago=90)], now=NOW, chats=PARIS, keep_min=60) == []


def test_regional_chat_reads_its_own_city_first():
    lyon = {"GJ2026ARA": {"city": "Lyon", "protest": True}}
    s = sr.build([_post("ça gaze à Bellecour", chan="GJ2026ARA")], now=NOW, chats=lyon)[0]
    assert s["city"] == "Lyon"


def test_looking_back_is_not_now():
    assert sr.build([_post("hier ça gazait à Répu")], now=NOW, chats=PARIS) == []


def test_model_situation_adds_what_the_rules_missed():
    p = _post("ils bloquent toutes les rues autour de la place", mid=5)
    sits = {("GJ2026IDF", 5): [{"kind": "kettle", "place": "Place de la Bastille, Paris, France", "precision": "site",
                               "lat": 48.853, "lon": 2.369, "country": "fr", "happening": "Police are kettling protesters at Place de la Bastille."}]}
    s = sr.build([p], sits, now=NOW, chats=PARIS)
    assert len(s) == 1 and s[0]["tactic"] == "kettle" and s[0]["place_id"] == "bastille" and s[0]["read_by"] == "model"
    assert s[0]["sources"][0]["translation"].startswith("Police are kettling")


def test_rule_tactic_with_the_models_located_place():
    p = _post("ça gaze ici rue Oberkampf au niveau du métro", lat=48.8650, lon=2.3700, precision="street",
              place="Rue Oberkampf, Paris, France")
    s = sr.build([p], now=NOW, chats=PARIS)[0]
    assert s["tactic"] == "tear_gas" and s["place_id"] == "oberkampf"


# ── Spanish (Venezuela) ────────────────────────────────────────────────────

def test_spanish_reports():
    ve = {"vzla_resiste": {"city": None, "protest": True}}
    posts = [_post("Están lanzando lacrimógenas en Altamira!!", mid=1, chan="vzla_resiste"),
             _post("La GNB llegó a Plaza Venezuela, mucho cuidado", mid=2, chan="vzla_resiste"),
             _post("Hay detenidos en Chacaíto", mid=3, chan="vzla_resiste")]
    s = {x["tactic"]: x for x in sr.build(posts, now=NOW, chats=ve)}
    assert s["tear_gas"]["title"] == "Tear gas used at Plaza Altamira (Plaza Francia) (Caracas)"
    assert s["police_arrival"]["title"] == "Police moving in at Plaza Venezuela (Caracas)"
    assert s["arrests"]["place_id"] == "ccs_chacaito"


def test_cues_for_group_prefilter():
    for t in ("ça gaze à Répu", "ça nasse", "les flics arrivent", "lacrimógenas", "la GNB llegó", "ça bouge à Répu"):
        assert sr.cues(t), t
    for t in ("+1", "mdr", "bonne nuit", "le prix du gaz"):
        assert not sr.cues(t), t


# ── the filters that dropped these posts (2026-10-18) ──────────────────────

def test_short_slang_reaches_the_live_development_pass():
    import telegram_events as te
    for t in ("ça gaze à Répu", "ça nasse à Répu", "les flics arrivent à Répu", "la GNB llegó a Altamira"):
        assert te.situation_cue(t), t


def test_group_prefilter_lets_street_reports_and_spanish_burmese_through():
    import telegram_ingest as tg
    for t in ("ça gaze à Répu", "Répu ça nasse", "les keufs débarquent", "Están lanzando lacrimógenas en Altamira",
              "marcha hacia Miraflores", "ရန်ကုန်မှာ ဆန္ဒပြ", "စစ်ကောင်စီ တပ်တွေ ရောက်လာ"):
        assert tg.group_worth_reading(t), t
    for t in ("+1", "mdr", "jajaja", "buenas noches"):
        assert not tg.group_worth_reading(t), t


def test_keep_message():
    import telegram_ingest as tg
    # a group's captionless video is kept (it belongs to the report before it); a channel's is not
    assert tg.keep_message("", "video", group=True, forwarded=False, role="group")
    assert not tg.keep_message("", "video", group=False, forwarded=False, role="aggregator")
    assert not tg.keep_message("", "none", group=True, forwarded=False, role="group")
    # a forward in a group is kept when it reports the street; in a channel it is not
    assert tg.keep_message("les flics arrivent à Répu", "video", group=True, forwarded=True, role="group")
    assert not tg.keep_message("abonnez-vous à ma chaîne", "video", group=True, forwarded=True, role="group")
    assert not tg.keep_message("les flics arrivent à Répu", "video", group=False, forwarded=True, role="aggregator")
    assert tg.keep_message("communiqué", "none", group=False, forwarded=True, role="official")


def test_unregistered_chat_takes_its_country_from_its_posts():
    import telegram_signals as ts
    assert ts.dominant_country(["ve"] * 6 + ["co"]) == "ve"
    assert ts.dominant_country(["ve", "ve", "mm"]) is None            # too few
    assert ts.dominant_country(["ve"] * 3 + ["mm"] * 3) is None       # no majority


def test_spanish_calls_and_positions():
    import telegram_signals as ts
    when = "2026-10-18T15:00:00+00:00"
    it = ts.read_intents("Vamos todos a trancar la autopista ahora mismo", when, country="ve")
    assert it and it[0]["act"] == "block" and it[0]["immediate"]
    pos = ts.read_positions("Ya estamos en Plaza Altamira, vengan", when, country="ve")
    assert pos and pos[0]["target"].startswith("Plaza Altamira")


def test_bastoche_is_a_landmark_for_positions():
    import telegram_signals as ts
    lm = ts.landmark("on est à Bastoche")
    assert lm and lm["name"] == "Place de la Bastille"


def test_mood_reads_spanish():
    import telegram_mood_alert as ma
    import telegram_unrest as tu
    assert ma.VIOLENT_ACT.search("hay que quemar todo y atacar el palacio")
    assert tu.PROTEST.search("gran marcha en Caracas") and tu.PROTEST.search("ရန်ကုန်တွင် ဆန္ဒပြ")


def test_signals_without_any_model_reading(monkeypatch):
    """Production's model credit can run out: unclassified posts (no
    summary_en, no place, no live-development rows) still become signals."""
    import sqlite3
    monkeypatch.setattr(sr, "chat_contexts", lambda chans: {c: {"city": "Paris", "protest": True} for c in chans})
    con = sqlite3.connect(":memory:")
    con.execute("CREATE TABLE telegram_posts (channel TEXT, msg_id INTEGER, channel_title TEXT, posted_at TEXT, text TEXT,"
                " media TEXT, thumb TEXT, role TEXT, classified INTEGER DEFAULT 0)")
    rows = [("GJ2026IDF", 1, "GJ IDF", (NOW - dt.timedelta(minutes=3)).isoformat(), "ça nasse à Répu", "none", None, "group"),
            ("GJ2026IDF", 2, "GJ IDF", (NOW - dt.timedelta(minutes=2)).isoformat(), "mdr", "none", None, "group")]
    con.executemany("INSERT INTO telegram_posts (channel, msg_id, channel_title, posted_at, text, media, thumb, role)"
                    " VALUES (?,?,?,?,?,?,?,?)", rows)
    sigs = sr.read(con, now=NOW)
    assert [s["title"] for s in sigs] == ["Kettle at Place de la République (Paris) — exits blocked"]
    assert sigs[0]["sources"][0]["translated_by"] == "rule"


def test_as_post_shape():
    s = sr.build([_post("ça gaze à Répu")], now=NOW, chats=PARIS)[0]
    p = sr.as_post(s)
    assert p["category"] == "unrest" and p["headline"] == s["title"] and p["lat"] == s["lat"]
    assert p["sources"][0]["url"] == "https://t.me/GJ2026IDF/1"
