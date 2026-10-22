"""The owner's false examples of 2026-10-22 (real production posts), the reject classes, and live_signals:
one event one marker, corroboration, media only as an attachment, no emoji, no generic place."""
import datetime as dt
import json

import pytest

import live_incident as li
import live_signals as ls
import textclean

NOW = dt.datetime(2026, 10, 22, 16, 0, tzinfo=dt.timezone.utc)

RIVOLI = ("Île de France 17:41. Bonjour à tous j’ai besoin d’aide, samedi j’étais sur Paris et j’ai assisté au pillage "
          "d’histoire d’or rue Rivoli au alentour de 2-3h du matin, un pilleur a été interpeller menotté face contre sol. "
          "Je l’ai insulte et de la les policiers dont un avec un lbd m’a viser au niveau du visage j’ai du fuir")
OPINION = "Je finirais par dire LA JEUNESSE EMMERDE LE FRONT NATIONAL, des putains de nazi en costume, NIQUE LE RN"
FOUNDERS = "Justement il faut les combattre sans relâche depuis la Shoah et le RN anciennement FN a était co-fondé par les SS"
MACRON = ("🇫🇷 FLASH - Emmanuel Macron porte une \"atteinte grave et manifestement illégale à la liberté de manifester\", "
          "après les déclarations du président de la République")


def model(**kw):
    a = {"is_live": True, "event_type": "arrest", "event_time": "2026-10-22T15:50:00Z", "certainty": "unverified",
         "location": {"name_as_written": "rue Rivoli", "name_for_geocoder": None, "level": "street", "context_as_written": []},
         "other_places_mentioned": [], "ambiguity_note": None, "evidence_quote_time": "17:41", "evidence_quote_place": "rue Rivoli",
         "evidence_quote_act": "interpeller", "first_hand": True, "reject_class": None, "reject_reason": None, "direction": None}
    a.update(kw)
    return a


# (a) the forwarded header time and a story told in the past
def test_a_header_clock_and_a_past_story_are_not_a_live_arrest():
    assert li.header_clock(RIVOLI) == "17:41"
    v = li.verify(model(), RIVOLI, "2026-10-22T15:41:13+00:00", NOW)
    assert not v["ok"]
    assert any("header" in r for r in v["reasons"]) and any("story" in r for r in v["reasons"])
    assert li.story_cue(RIVOLI)


def test_a_writers_own_clock_is_not_a_header():
    assert li.header_clock("At 01:31 local time (2201 UTC), a launch platform was attacked") is None
    assert li.header_clock("\u26a1\ufe0f At 01:31 local time") is None
    assert li.header_clock("Paris 18:20. Bonjour") == "18:20"


def test_a_witness_of_the_last_minutes_stands():
    t = "Je vois la police qui interpelle des gens en ce moment rue de Rivoli"
    assert li.story_cue(t) is None
    v = li.verify(model(evidence_quote_time="en ce moment", evidence_quote_place="rue de Rivoli", evidence_quote_act="interpelle",
                        location={"name_as_written": "rue de Rivoli", "name_for_geocoder": None, "level": "street", "context_as_written": []}),
                  t, "2026-10-22T15:55:00+00:00", NOW)
    assert v["ok"], v["reasons"]


# (b) the bare word "place"
@pytest.mark.parametrize("w", ["place", "la place", "rue", "the square", "Boulevard", "downtown", "площадь"])
def test_a_kind_of_place_is_not_a_place(w):
    assert textclean.is_generic_place(w)
    t = f"Gilets jaunes en cours sur la {w} maintenant"
    v = li.verify(model(event_type="crowd_movement", location={"name_as_written": w, "name_for_geocoder": None, "level": "street", "context_as_written": []},
                        evidence_quote_time="maintenant", evidence_quote_place=w, evidence_quote_act="Gilets jaunes"), t,
                  "2026-10-22T15:55:00+00:00", NOW)
    assert not v["ok"] and any("kind of place" in r for r in v["reasons"])


def test_named_places_are_places():
    for n in ("place de la République", "rue de Rivoli", "Sorbonne", "Boulevard Magenta"):
        assert not textclean.is_generic_place(n)


# (d)/(e) opinions
@pytest.mark.parametrize("t", [OPINION, FOUNDERS])
def test_opinions_are_rejected_by_rule_and_by_the_gate(t):
    assert li.opinion_cue(t)
    d = li.rule_decide("BREAKING " + t, "2026-10-22T15:55:00+00:00", NOW)
    assert not d["ok"] and "opinion" in d["why"]
    v = li.verify(model(), t, "2026-10-22T15:55:00+00:00", NOW)
    assert not v["ok"]


def test_the_model_can_say_opinion_and_the_class_is_kept():
    v = li.verify(model(is_live=False, reject_class="opinion", reject_reason="a view"), OPINION, "2026-10-22T15:55:00+00:00", NOW)
    assert v["reject_class"] == "opinion" and "[opinion]" in v["reasons"][0]


def test_the_rule_path_pins_only_an_act_named_now():
    ok = li.rule_decide("EN DIRECT: lacrymo place de la République, ça gaze maintenant", "2026-10-22T15:55:00+00:00", NOW)
    assert ok["ok"] and ok["act"] == "police_intervention"
    assert not li.rule_decide(MACRON, "2026-10-22T15:55:00+00:00", NOW)["ok"]
    assert not li.rule_decide("BREAKING " + RIVOLI, "2026-10-22T15:55:00+00:00", NOW)["ok"]
    assert not li.rule_decide("maintenant la météo est belle", "2026-10-22T15:55:00+00:00", NOW)["ok"]


def test_act_must_be_quoted_and_be_in_the_vocabulary():
    t = "Police charging protesters right now at Sorbonne"
    base = dict(location={"name_as_written": "Sorbonne", "name_for_geocoder": None, "level": "venue", "context_as_written": []},
                evidence_quote_time="right now", evidence_quote_place="Sorbonne", event_type="police_intervention")
    assert li.verify(model(evidence_quote_act="Police charging", **base), t, "2026-10-22T15:55:00+00:00", NOW)["ok"]
    assert not li.verify(model(evidence_quote_act="tear gas", **base), t, "2026-10-22T15:55:00+00:00", NOW)["ok"]
    assert not li.verify(model(evidence_quote_act="Police charging", **{**base, "event_type": "footage"}), t, "2026-10-22T15:55:00+00:00", NOW)["ok"]


# (g) emoji
def test_emoji_are_stripped():
    assert textclean.strip_emoji("🇫🇷 ALERTE ⚡️ Arrest 🚨 at rue de Rivoli 👮‍♂️") == "ALERTE Arrest at rue de Rivoli"
    assert textclean.strip_emoji(None) == ""
    assert textclean.strip_emoji("Île-de-France, café") == "Île-de-France, café"
    assert not textclean.has_emoji(textclean.strip_emoji("😢😂 ok 1️⃣"))


def test_card_headline_is_short_and_plain():
    assert li.card_headline("police_intervention", "charge de police", "Sorbonne", ["Paris"]) == "Police charge at Sorbonne, Paris"
    assert li.card_headline("arrest", "interpelle", "rue de Rivoli 🚨", ["Paris"]) == "Arrest at rue de Rivoli, Paris"
    assert "report" not in li.card_headline("crowd_movement", "cortège", "Nation", [], {"toward_place": "Bastille"}).lower()
    assert li.card_headline("crowd_movement", "cortège", "Nation", [], {"toward_place": "Bastille"}) == "Crowd at Nation, moving toward Bastille"


# ── live_signals ─────────────────────────────────────────────────────────────

def atom(ch, mid, act, minutes_ago, lat=48.8485, lon=2.3430, name="Sorbonne", first_hand=False, text="x", **kw):
    return {"channel": ch, "msg_id": mid, "topic_id": None, "channel_title": ch, "posted_at": "2026-10-22T15:50:00+00:00",
            "event_time": NOW - dt.timedelta(minutes=minutes_ago), "act": act, "quote": kw.get("quote"), "name": name,
            "context": ["Paris"], "lat": lat, "lon": lon, "text": text, "first_hand": first_hand, "certainty": None,
            "direction": kw.get("direction"), "media": "none", "thumb": None, "read_by": "model", "country_code": "fr"}


def test_three_signals_at_the_sorbonne_are_one_marker():
    atoms = [atom("a", 1, "police_intervention", 8, quote="charge", text="police charge la Sorbonne"),
             atom("b", 2, "arrest", 6, lat=48.8486, lon=2.3432, quote="interpelle", text="arrestations en cours"),
             atom("c", 3, "crowd_movement", 12, lat=48.8483, lon=2.3428, quote="foule", text="la foule devant la fac")]
    out = ls.build(atoms, now=NOW)
    assert len(out) == 1
    s = out[0]
    assert s["act"] == "arrest" and s["title"] == "Arrest at Sorbonne, Paris" and s["count"] == 3
    assert {x["act"] for x in s["lines"]} == {"police_intervention", "crowd_movement"}
    assert s["corroboration"]["n_sources"] == 3 and s["corroboration"]["line"] == "Corroborated by 3 sources" and not s["muted"]


def test_far_apart_or_far_in_time_are_two_markers():
    out = ls.build([atom("a", 1, "arrest", 5), atom("b", 2, "arrest", 5, lat=48.86, lon=2.36, name="Bastille")], now=NOW)
    assert len(out) == 2
    out = ls.build([atom("a", 1, "arrest", 5), atom("b", 2, "arrest", 5 + 90)], now=NOW)
    assert len(out) == 1                                                       # the 95-min-old one has left the window; one remains


def test_a_forward_is_not_a_second_source():
    t = "Police charge la Sorbonne en ce moment, beaucoup de gaz et de monde"
    out = ls.build([atom("a", 1, "police_intervention", 5, text=t), atom("b", 2, "police_intervention", 4, text=t + " (via a)")], now=NOW)
    assert out[0]["corroboration"]["n_sources"] == 1


def test_uncorroborated_high_impact_is_muted_not_hidden_and_eyewitness_is_labelled():
    out = ls.build([atom("a", 1, "shots_fired", 5, text="coups de feu rue X")], now=NOW)
    assert len(out) == 1 and out[0]["muted"] and out[0]["corroboration"]["line"] == "1 source, unverified"
    out = ls.build([atom("a", 1, "shots_fired", 5, first_hand=True)], now=NOW)
    assert not out[0]["muted"] and out[0]["corroboration"]["line"] == "Eyewitness, unverified"


def test_signals_leave_after_an_hour_a_crowd_after_three():
    assert ls.build([atom("a", 1, "arrest", 61)], now=NOW) == []
    assert len(ls.build([atom("a", 1, "arrest", 59)], now=NOW)) == 1
    assert len(ls.build([atom("a", 1, "crowd_movement", 100), atom("a", 2, "crowd_movement", 30)], now=NOW)) == 1
    # reports more than an hour apart are two crowds: the old one is gone, the new one stands
    assert [s["id"] for s in ls.build([atom("a", 1, "crowd_movement", 200), atom("a", 2, "crowd_movement", 30)], now=NOW)] == ["ls-a-2"]
    # a crowd reported without a gap of an hour for over three hours leaves
    chain = [atom("a", i, "crowd_movement", m) for i, m in enumerate((200, 150, 100, 50, 10))]
    assert ls.build(chain, now=NOW) == []


def test_cards_are_clean():
    s = ls.build([atom("a", 1, "arrest", 5, first_hand=True, name="rue de Rivoli 🚨")], now=NOW)
    c = ls.notification_cards(s)[0]
    assert c["title"] == "Arrest at rue de Rivoli, Paris" and c["reason"] == "Eyewitness, unverified" and "kind" in c and c["kind"] == "telegram"
    assert not textclean.has_emoji(json.dumps(s, ensure_ascii=False))


def test_the_announcement_geocoder_does_not_resolve_the_word_place():
    """Owner (b): the announcement place was "Place, France", found by the geocoder as a hamlet called Place."""
    import telegram_ingest as tg
    hit, why = tg.locate("Place, France", "city", "fr")
    assert hit is None and "kind of place" in why
