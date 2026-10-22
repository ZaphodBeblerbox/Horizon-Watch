"""telegram_signals: calls to act and self-reported positions read from
Telegram posts (French, English, German), forum topics as context, and
many messages merged into one readable signal (the owner, 2026-10-17)."""
import datetime as dt
import sqlite3

import pytest

import event_watch as ew
import general_feed as gf
import telegram_ingest as tg
import telegram_signals as ts

POSTED = "2026-10-17T14:00:00+00:00"          # a Saturday, 16:00 in Paris


# ── intent ──────────────────────────────────────────────────────────────────

def test_immediate_call_to_attack_the_elysee_in_french():
    [i] = ts.read_intents("Allez on va attaquer l'Élysée maintenant !!", POSTED, country="fr")
    assert i["act"] == "attack" and i["target"] == "Palais de l'Élysée"
    assert (i["lat"], i["lon"], i["country"]) == (48.8704, 2.3167, "fr")
    assert i["when_kind"] == "now" and i["immediate"] == 1 and i["starts_utc"] == "2026-10-17T14:00:00Z"


@pytest.mark.parametrize("text", [
    "let's go attack the Élysée Palace right now",
    "Tout le monde à l'Élysée tout de suite, on y va",
    "go go go Élysée",
    "RDV immédiat devant l'Élysée",
])
def test_right_now_in_every_phrasing(text):
    [i] = ts.read_intents(text, POSTED, country="fr")
    assert i["target"] == "Palais de l'Élysée" and i["immediate"] == 1 and i["when_kind"] == "now"


def test_champs_elysees_is_not_the_palace():
    [i] = ts.read_intents("On bloque les Champs-Élysées maintenant", POSTED, country="fr")
    assert i["act"] == "block" and i["target"] == "Avenue des Champs-Élysées"


def test_in_thirty_minutes_is_immediate_tomorrow_is_not():
    [soon] = ts.read_intents("On bloque le périph dans 30 min, rdv Porte Maillot", POSTED, country="fr")
    assert soon["target"] == "Porte Maillot" and soon["when_kind"] == "relative"
    assert soon["starts_utc"] == "2026-10-17T14:30:00Z" and soon["immediate"] == 1
    [later] = ts.read_intents('Les lycéens sont appelés à "PRENDRE LA BASTILLE" demain à 15h.', POSTED, country="fr")
    assert later["act"] == "occupy" and later["target"] == "Place de la Bastille" and later["who"] == "lycéens"
    assert later["starts_utc"] == "2026-10-18T13:00:00Z" and later["immediate"] == 0     # 15:00 CEST


def test_a_weekday_is_the_next_such_day():
    [i] = ts.read_intents("Rassemblement samedi 14h place Bellecour", "2026-10-16T10:00:00+00:00", country="fr")
    assert i["target"] == "Place Bellecour" and i["lat"] == 45.7578 and i["starts_utc"] == "2026-10-17T12:00:00Z"


def test_news_of_an_emergency_meeting_is_not_a_call():
    text = ("🇫🇷 ALERTE INFO - Emmanuel Macron RÉUNIT EN URGENCE plusieurs ministres à l’Élysée ce soir face aux"
            " blocages de lycées et aux manifestations. (LCI)")
    assert ts.read_intents(text, POSTED, country="fr") == []          # read from the live store, 2026-10-07


def test_a_report_is_not_a_plan():
    assert ts.read_intents("Ils attaquent la préfecture", POSTED, country="fr") == []
    assert ts.read_intents("Macron démission", POSTED, country="fr") == []
    assert ts.read_intents("Demain on bloque tout", POSTED, country="fr") == []     # no place: not a located call


def test_german_call():
    [i] = ts.read_intents("Kommt jetzt alle, wir blockieren den Reichstag", POSTED, country="de")
    assert i["act"] == "block" and i["target"] == "Reichstag" and i["immediate"] == 1


# ── positions ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,target", [
    ("on est à Concorde, ça charge", "Place de la Concorde"),
    ("ON EST À LA CONCORDE 🔥", "Place de la Concorde"),
    ("we're at Trafalgar Square, thousands here", "Trafalgar Square"),
    ("Nous sommes rue de Rivoli, ça gaze", "Rue de Rivoli"),
    ("Wir sind am Alexanderplatz", "Alexanderplatz"),
])
def test_self_reported_positions(text, target):
    [p] = ts.read_positions(text, POSTED)
    assert p["target"] == target and p["at_time"] == "2026-10-17T14:00:00Z"


def test_not_a_position():
    assert ts.read_positions("je suis à la maison", POSTED) == []
    assert ts.read_positions("on est à fond derrière vous", POSTED) == []


# ── forum topics ────────────────────────────────────────────────────────────

def test_topic_titles_give_region_and_why():
    assert ts.topic_context("📍 Région Bretagne") == {"region": "Bretagne", "why": False}
    assert ts.topic_context("Pourquoi on manifeste")["why"] is True
    assert ts.topic_context("Île-de-France")["region"] == "Île-de-France"
    assert ts.topic_context("General") == {"region": None, "why": False}


def test_a_target_is_geocoded_in_its_topics_region(monkeypatch):
    asked = []
    monkeypatch.setattr(tg, "locate", lambda q, prec, cc: (asked.append((q, cc)) or ({"lat": 48.11, "lon": -1.68}, None)))
    items = ts.read_post("legrandcafe_test", 7, "Rassemblement devant la Préfecture maintenant !", POSTED,
                         topic_title="Région Bretagne", ctx={"country": "fr", "region": None})
    [i] = items
    ts._resolve(i, i.pop("_region"), [5])
    assert asked == [("Préfecture, Bretagne, France", "fr")]
    assert (i["lat"], i["lon"]) == (48.11, -1.68) and i["topic_title"] == "Région Bretagne"


def test_topic_of_a_forum_message():
    class R:
        def __init__(self, **k):
            self.__dict__.update(k)
    assert tg.topic_of(R(reply_to=None)) == 1                                              # General
    assert tg.topic_of(R(reply_to=R(forum_topic=True, reply_to_msg_id=42, reply_to_top_id=None))) == 42
    assert tg.topic_of(R(reply_to=R(forum_topic=True, reply_to_msg_id=99, reply_to_top_id=42))) == 42
    assert tg.topic_title_for({42: "Région Bretagne"}, 42) == "Région Bretagne"
    assert tg.topic_title_for({}, 1) == "General"


# ── unified signals ─────────────────────────────────────────────────────────

ELY = dict(lat=48.8704, lon=2.3167, country="fr", target="Palais de l'Élysée", place="Palais de l'Élysée, Paris, France")


def _row(chan, mid, minute, kind="intent", act="attack", immediate=1, **kw):
    t = (dt.datetime(2026, 10, 17, 14, 0, tzinfo=dt.timezone.utc) + dt.timedelta(minutes=minute)).isoformat()
    base = {"channel": chan, "msg_id": mid, "idx": 0, "kind": kind, "act": act if kind == "intent" else None,
            "when_text": "maintenant" if immediate else None, "when_kind": "now" if immediate else None,
            "starts_utc": t[:19] + "Z" if immediate else None, "immediate": immediate, "at_time": t if kind == "at" else None,
            "who": None, "confidence": 0.8, "topic_id": 5, "topic_title": "Île-de-France", "posted_at": t,
            "channel_title": {"legrandcafe": "Le Grand Café", "GJ2026IDF": "🗼 Île-de-France"}.get(chan, chan),
            "text": f"message {mid}", "role": "group", **ELY}
    base.update(kw)
    return base


def test_many_messages_one_signal():
    rows = [_row("legrandcafe", 1, 0), _row("legrandcafe", 2, 4, act="march"), _row("GJ2026IDF", 9, 10),
            _row("legrandcafe", 3, 12, kind="at", immediate=0)]
    [s] = ts.build(rows)
    assert s["n_messages"] == 4 and s["n_channels"] == 2 and s["n_positions"] == 1
    assert s["intent"]["act"] == "attack" and s["intent"]["immediate"] is True
    assert s["severity_tier"] == "critical"
    assert s["headline"] == "Immediate call to attack Palais de l'Élysée now"
    assert s["summary"].count(".") >= 2 and "4 messages in 2 chats" in s["summary"] and "One says they are already there" in s["summary"]
    assert [x["url"] for x in s["sources"]][:2] == ["https://t.me/legrandcafe/1", "https://t.me/legrandcafe/2"]
    assert s["id"] == "tgu-legrandcafe-1-0"                                  # stable as messages arrive


def test_a_single_immediate_call_is_high_and_notifies():
    [s] = ts.build([_row("legrandcafe", 1, 0)])
    assert s["severity_tier"] == "high"
    post = ts.as_post(s)
    assert post["severity_tier"] == "significant" and post["signal_severity"] == "high"
    card = {"id": post["id"], "kind": "telegram", "sev": post["signal_severity"], "title": post["headline"]}
    assert ew.notifies(card, {"assets": [], "theaters": [], "countries": set()})


def test_urgent_signals_become_notification_cards(monkeypatch):
    import main
    urgent = ts.as_post(ts.build([_row("legrandcafe", 1, 0), _row("legrandcafe", 2, 2)])[0])
    timed = ts.as_post(ts.build([_row("c/9", 5, 0, immediate=0, act="gather")])[0])
    monkeypatch.setattr(ts, "posts", lambda hours=72, db_path=None: [urgent, timed])
    monkeypatch.setattr(tg, "published", lambda hours=72: [urgent])
    import live_signals
    monkeypatch.setattr(live_signals, "signals", lambda *a, **k: [])
    monkeypatch.setattr(tg, "statements", lambda hours=72: [])
    main._TG_CARDS_CACHE.clear()
    cards = main._telegram_report_cards(24)
    main._TG_CARDS_CACHE.clear()
    assert cards == []   # one gate (owner, 2026-10-22): calls and positions are no notification; only live signals are


def test_other_places_and_later_hours_stay_apart():
    bastille = dict(lat=48.8532, lon=2.3692, target="Place de la Bastille", place="Place de la Bastille, Paris, France")
    rows = [_row("legrandcafe", 1, 0), _row("legrandcafe", 2, 5, **bastille), _row("legrandcafe", 3, 200)]
    sigs = ts.build(rows)
    assert len(sigs) == 3
    timed = ts.build([_row("legrandcafe", 4, 0, immediate=0, act="gather")])[0]
    assert timed["severity_tier"] == "moderate"


def test_unlocated_targets_merge_by_name():
    noloc = dict(lat=None, lon=None, target="Préfecture de Rennes", place="Préfecture de Rennes")
    [s] = ts.build([_row("c/1", 1, 0, **noloc), _row("c/1", 2, 3, **noloc)])
    assert s["n_messages"] == 2 and s["lat"] is None and s["sources"][0]["url"] is None    # private chat: no t.me link


# ── through the database and the feeds ──────────────────────────────────────

@pytest.fixture
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "akili.db")
    monkeypatch.setattr(tg, "_db_path", lambda: path)
    monkeypatch.setattr(ts, "chat_context", lambda chan: {"country": "fr", "region": None})
    ts.invalidate()
    con = tg._con()
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    posts = [("legrandcafe", 10, "Le Grand Café", now - dt.timedelta(minutes=9), "On va attaquer l'Élysée maintenant", None),
             ("legrandcafe", 11, "Le Grand Café", now - dt.timedelta(minutes=8), "go maintenant !!", 10),
             ("legrandcafe", 12, "Le Grand Café", now - dt.timedelta(minutes=6), "on est devant l'Élysée", None),
             ("legrandcafe", 13, "Le Grand Café", now - dt.timedelta(minutes=5), "lol", None)]
    for chan, mid, title, at, text, reply in posts:
        con.execute("INSERT INTO telegram_posts (channel, msg_id, channel_title, posted_at, text, media, role, chat_kind,"
                    " topic_id, topic_title, reply_to, classified, relevant, headline) VALUES (?,?,?,?,?,'none','group','forum',5,"
                    " 'Île-de-France',?,1,1,?)", (chan, mid, title, at.isoformat(), text, reply, text))
    con.commit()
    con.close()
    yield path
    ts.invalidate()


def test_read_pending_stores_intents_positions_and_replies(db):
    out = ts.read_pending()
    assert out["intents"] == 2 and out["positions"] == 1          # the call, the "go maintenant" reply, the position
    con = sqlite3.connect(db)
    rows = con.execute("SELECT msg_id, kind, act, target, immediate, topic_title, lat FROM telegram_intents ORDER BY msg_id").fetchall()
    assert rows == [(10, "intent", "attack", "Palais de l'Élysée", 1, "Île-de-France", 48.8704),
                    (11, "intent", "attack", "Palais de l'Élysée", 1, "Île-de-France", 48.8704),
                    (12, "at", None, "Palais de l'Élysée", 0, "Île-de-France", 48.8704)]
    assert con.execute("SELECT COUNT(*) FROM telegram_posts WHERE intent_checked=1").fetchone()[0] == 4


def test_feeds_show_one_signal_not_three_messages(db):
    ts.read_pending()
    posts = tg.feed()["posts"]
    unified = [p for p in posts if p.get("unified")]
    assert len(unified) == 1 and unified[0]["n_messages"] == 3
    assert {p["msg_id"] for p in posts if not p.get("unified")} == {13}           # only what no signal stands for
    assert unified[0]["headline"].startswith("Immediate call to attack Palais de l'Élysée")
    pins = tg.published(24)
    assert [p["id"] for p in pins] == [unified[0]["id"]] and pins[0]["lat"] == 48.8704
    g = gf.feed(db, kinds=("telegram",))["items"]
    assert [i.get("unified") for i in g] == [None, True] or [i.get("unified") for i in g] == [True, None]
    assert not any(i["id"] in ("legrandcafe/10", "legrandcafe/11", "legrandcafe/12") for i in g)


def test_model_fills_a_target_the_rules_missed(db, monkeypatch):
    monkeypatch.setattr(tg, "locate", lambda q, prec, cc: ({"lat": 48.85, "lon": 2.35}, None))
    con = tg._con()
    posted = dt.datetime.now(dt.timezone.utc).isoformat()
    con.execute("INSERT INTO telegram_posts (channel, msg_id, channel_title, posted_at, text) VALUES"
                " ('legrandcafe', 20, 'Le Grand Café', ?, 'Tous chez le Président, on y va')", (posted,))
    assert ts.merge_model(con, "legrandcafe", 20, posted,
                          {"intent": {"act": "march", "target": "Palais de l'Élysée, Paris, France", "when": "now"},
                           "at": "", "country_code": "fr"})
    row = con.execute("SELECT act, target, lat, immediate, source FROM telegram_intents WHERE msg_id=20").fetchone()
    con.close()
    assert row == ("march", "Palais de l'Élysée", 48.8704, 1, "model")


def test_group_chatter_never_reaches_the_model(db, monkeypatch):
    con = tg._con()
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    con.executemany("INSERT INTO telegram_posts (channel, msg_id, channel_title, posted_at, text, media, chat_kind, role)"
                    " VALUES ('GJ2026IDF', ?, 'IDF', ?, ?, 'none', 'group', 'group')",
                    [(30, now, "lol +1"), (31, now, "On bloque la Concorde maintenant")])
    con.commit()
    con.close()
    seen = []
    monkeypatch.setattr(tg, "_model_pass", lambda rows: (seen.extend(r[3] for r in rows) or [{} for _ in rows]))
    out = tg.classify()
    assert seen == [31] and out["group_chatter_skipped"] == 1
    con = sqlite3.connect(db)
    assert con.execute("SELECT unpublished_reason FROM telegram_posts WHERE msg_id=30").fetchone()[0] == tg.GROUP_NO_CUE


def test_polling_runs_hot_while_a_chat_carries_calls(db):
    assert tg.next_interval() == tg.COLD_POLL_S
    con = tg._con()
    con.execute("INSERT INTO telegram_chat_state (channel, last_cue_at) VALUES ('GJ2026IDF', ?)",
                (dt.datetime.now(dt.timezone.utc).isoformat(),))
    con.commit()
    con.close()
    assert tg.next_interval() == tg.HOT_POLL_S


def test_real_posts_from_two_channels_are_one_signal(db):
    """Copied from the live store (2026-10-07): the same call relayed by a
    gilets jaunes channel and a French news relay four minutes apart."""
    con = tg._con()
    con.execute("DELETE FROM telegram_posts")
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    for chan, mid, title, mins, text in [
        ("AlertesInfos", 10012, "AlertesInfos", 4, "🇫🇷 FLASH - Les lycéens d’Île-de-France sont appelés à \"PRENDRE LA BASTILLE\""
                                                     " demain à 15h. (L’Union Étudiante) \n› Ouvrir sur X"),
        ("giletsjaunes2026", 272, "GJ2026", 0, "Les lycéens d’Île-de-France sont appelés à \"PRENDRE LA BASTILLE\" demain à 15h."
                                               " (L’Union Étudiante)")]:
        con.execute("INSERT INTO telegram_posts (channel, msg_id, channel_title, posted_at, text, role) VALUES (?,?,?,?,?,'local')",
                    (chan, mid, title, (now - dt.timedelta(minutes=mins)).isoformat(), text))
    con.commit()
    con.close()
    ts.read_pending()
    [s] = ts.signals(24)
    assert s["n_messages"] == 2 and s["n_channels"] == 2 and s["severity_tier"] == "moderate"
    assert s["headline"].startswith("Call for lycéens to occupy Place de la Bastille at 15:00")
    assert "2 messages in 2 chats" in s["summary"]
