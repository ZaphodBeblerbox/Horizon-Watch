"""telegram_rules + the no-model path of telegram_ingest.classify: posts still
become signals when the OpenAI credit is gone (2026-10-18), and calls to
violence are raised from their words alone. Texts are real production posts
from 2026-10-19 unless marked."""
import datetime as dt
import sqlite3

import pytest

import openai_gate
import telegram_ingest as tg
import telegram_mood_alert as tma
import telegram_rules as tr
import telegram_signals as ts


@pytest.mark.parametrize("text,kind,place,cc", [
    ("عاجل | طيران الاحتلال يشن غارتين على أطراف بلدة برعشيت وبلدة كفر تبنيت، جنوب لبنان.", "strike", "برعشيت", "lb"),
    ("⚡️ Artillery shelling targets the town of Mansouri, southern Lebanon", "strike", "Mansouri", "lb"),
    ("КАБ на Тишки ㅤ  Надіслати новину @Kharkiv_Lifebot 👉ПІДПИСАТИСЯ", "strike", "Тишки", "ua"),
    ("عاجل | قوات الاحتلال تقتحم بلدة عقابا، شمال طوباس.", "movement", "عقابا", "ps"),
    ("⚡️ #Yemen_Saudi_War Yemeni attack in the Saudi capital, Riyadh.", "attack", "Riyadh", "sa"),
    ("Une jeune fille se fait frapper par la police alors qu’elle est immobile.", "unrest", None, None),
])
def test_real_event_posts_are_read_by_rule(text, kind, place, cc):
    x = tr.read(text)
    assert x["relevant"] and x["event_type"] == kind
    if place:
        assert x["places"][0] == place
    if cc:
        assert cc in x["countries"]


@pytest.mark.parametrize("text", [
    "🛸 Кушугум (Запорізька обл.) Загроза застосування БПЛА. Перейдіть в укриття!",     # a warning, not a hit
    "🟢 Відбій тривоги • Бердянський район (Запорізька обл.)",
    "⚡️ Amit Segal: Israel intends to begin its attacks with a wide wave of operations",
    "IRGC Spokesperson: The world will see what will happen!",
    "📰 Kenya : le chef d'une secte reconnu coupable du meurtre de 191 personnes",
    "lol +1",
])
def test_talk_warnings_and_chatter_are_not_events(text):
    assert not tr.read(text)["relevant"]


def test_a_country_or_a_people_is_never_a_place():
    assert tr.places_of("Strikes in Lebanon and on the Saudi border") == []
    assert tr.places_of("Israeli strikes on Gaza City") == ["Gaza City"]


def test_resolve_needs_a_settlement_in_a_named_country(monkeypatch):
    calls = []

    def locate(place, precision, cc):
        calls.append((place, cc))
        if place == "Riyadh, Saudi Arabia":
            return {"lat": 24.7, "lon": 46.7, "display_name": "Riyadh", "class": "place", "type": "city"}, None
        return None, "no"
    monkeypatch.setattr(tg, "locate", locate)
    x = tr.read("⚡️ #Yemen_Saudi_War Yemeni attack in the Saudi capital, Riyadh.")
    hit, place, cc, why = tr.resolve(x, [5])
    assert hit["lat"] == 24.7 and cc == "sa" and why is None
    assert calls[0] == ("Riyadh, Yemen", "ye")          # the first country named is tried first
    # a province of the same name is not a pin
    monkeypatch.setattr(tg, "locate", lambda p, pr, c: ({"lat": 1, "lon": 2, "class": "boundary", "type": "administrative"}, None))
    assert tr.resolve(x, [5])[0] is None
    # no geocoder budget left: unplaced, and it says why
    assert "budget" in tr.resolve(x, [0])[3]


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "akili.db")
    monkeypatch.setattr(tg, "_db_path", lambda: path)
    monkeypatch.setattr(ts, "chat_context", lambda chan: {"country": None, "region": None})
    monkeypatch.setattr(openai_gate, "_QUOTA", {"until": 0.0, "since": None, "hits": 0, "last": None})
    return path


def _post(con, chan, mid, text, media="none", kind="channel", role="aggregator", at=None):
    at = at or dt.datetime.now(dt.timezone.utc).isoformat()
    con.execute("INSERT INTO telegram_posts (channel, msg_id, channel_title, posted_at, text, media, chat_kind, role)"
                " VALUES (?,?,?,?,?,?,?,?)", (chan, mid, chan, at, text, media, kind, role))


def test_out_of_credit_posts_are_read_by_rule_and_placed(db, monkeypatch):
    """The 2026-10-18 failure: every model chunk answered 429
    insufficient_quota and every post stayed unread. Now the gate pauses,
    and the same pass reads them by rule."""
    con = tg._con()
    _post(con, "me_observer_TG", 1, "⚡️ Artillery shelling targets the town of Mansouri, southern Lebanon")
    _post(con, "me_observer_TG", 2, "⚡️ Liberman: I understand that it is very comfortable for President Trump")
    con.commit()
    con.close()

    class Quota(Exception):
        pass

    def broke(rows):
        raise Quota("Error code: 429 - {'error': {'type': 'insufficient_quota', 'code': 'credit_balance_exhausted'}}")
    monkeypatch.setattr(tg, "_model_pass", broke)
    monkeypatch.setattr(tg, "locate", lambda p, pr, cc: ({"lat": 33.2, "lon": 35.2, "display_name": "Mansouri"}, None)
                        if p.startswith("Mansouri") else (None, "no"))
    out = tg.classify()
    assert out["read_by_rule"] == 2 and out["published"] == 1
    assert openai_gate.quota_paused() and openai_gate.status()["credit_exhausted"]
    con = sqlite3.connect(db)
    r = con.execute("SELECT relevant, event_type, lat, read_by, headline FROM telegram_posts WHERE msg_id=1").fetchone()
    assert r[:4] == (1, "strike", 33.2, "rule") and "Mansouri" in r[4]
    assert con.execute("SELECT relevant, read_by FROM telegram_posts WHERE msg_id=2").fetchone() == (0, "rule")
    # the rule-read pin reaches the map like any other
    assert [p["id"] for p in tg.published(24) if p.get("msg_id") == 1] == ["tg-me_observer_TG-1"]


def test_while_paused_the_model_is_not_asked(db, monkeypatch):
    openai_gate.note_error(Exception("insufficient_quota"))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    assert openai_gate.get_client(openai_gate.ENRICH) is None
    openai_gate.note_ok()
    assert not openai_gate.quota_paused()


def test_rule_reading_is_reread_by_the_model_when_it_is_back(db, monkeypatch):
    con = tg._con()
    _post(con, "QudsN", 5, "عاجل | قوات الاحتلال تقتحم بلدة عقابا، شمال طوباس.")
    con.commit()
    con.close()
    monkeypatch.setattr(tg, "_model_pass", lambda rows: None)          # no model
    monkeypatch.setattr(tg, "locate", lambda *a: (None, "no"))
    tg.classify()
    assert sqlite3.connect(db).execute("SELECT read_by FROM telegram_posts").fetchone()[0] == "rule"
    # the model is back: the rule reading is read again, and replaced
    monkeypatch.setattr(openai_gate, "get_client", lambda purpose: object())
    monkeypatch.setattr(tg, "_model_pass", lambda rows: [{"relevant": True, "event_type": "movement", "headline": "Israeli forces raid Aqqaba, north of Tubas",
                                                          "place": "Aqqaba, Tubas, Palestine", "precision": "town", "country_code": "ps"} for _ in rows])
    monkeypatch.setattr(tg, "locate", lambda *a: ({"lat": 32.33, "lon": 35.33, "display_name": "Aqqaba"}, None))
    tg.classify()
    r = sqlite3.connect(db).execute("SELECT read_by, headline, lat FROM telegram_posts").fetchone()
    assert r == ("model", "Israeli forces raid Aqqaba, north of Tubas", 32.33)


def test_call_to_violence_is_raised_by_rule_without_the_mood_model():
    now = dt.datetime(2026, 10, 19, 20, 0, tzinfo=dt.timezone.utc)
    rows = [{"channel": "LeGrandQG", "msg_id": 7, "channel_title": "GJ2026 | Le Grand QG", "posted_at": now.isoformat(),
             "text": "Allez tous à Répu ce soir, on attaque les CRS", "summary_en": None, "headline": None, "place": None,
             "lat": None, "lon": None, "mood_country": "fr", "mood_target": None, "mood_topic": None},
            {"channel": "LeGrandQG", "msg_id": 8, "channel_title": "GJ2026 | Le Grand QG", "posted_at": now.isoformat(),
             "text": "Ils brûlent des voitures à Nantes", "summary_en": None, "headline": None, "place": None,
             "lat": None, "lon": None, "mood_country": "fr", "mood_target": None, "mood_topic": None}]
    alerts = tma.detect_calls(now=now, rows=[], existing=set(), rule_rows=rows)
    assert [a["id"] for a in alerts] == ["TGC-LeGrandQG-7"]
    a = alerts[0]
    assert a["raw"]["rule"] == "telegram_call_to_violence_lexicon"
    # context, never a bare id: the country, the words, the chat
    assert "France" in a["title"] and "attaque les CRS" in a["title"] and "Le Grand QG" in a["title"]
    assert "read by rule" in a["message"]
