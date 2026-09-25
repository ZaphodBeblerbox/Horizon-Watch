"""
The two new exporters produce documents, not screenshots.

Both are PDFs built server-side from real fields. What is worth guarding
is not that they render — it is that they stay honest when the data is
thin: a scan that crashed must not be reported as a clean negative, and a
scenario with no laydown must not promise one.
"""
import scenario_export as sx
import imagery_export as ix


# ReportLab ASCII85s then deflates its content streams, so a regex over
# the raw bytes of a normally-built PDF finds no text at all — which looks
# identical to a document that said nothing, and would make every wording
# assertion below pass vacuously. Turning compression off for the test run
# keeps the text literal in the stream; it changes nothing about what the
# exporters put on the page.
import reportlab.rl_config
reportlab.rl_config.pageCompression = 0


def _text(pdf_bytes):
    """The words on the page, for asserting on wording."""
    import re
    words = re.findall(rb"\((?:\\.|[^\\()])*\)", pdf_bytes)
    out = b" ".join(w[1:-1] for w in words)
    return out.decode("latin-1", "replace").replace("\\(", "(").replace("\\)", ")")


# ── scenario ────────────────────────────────────────────────────────────

def test_scenario_pdf_is_a_pdf():
    b = sx.build_pdf({"scenario": {"id": "s1", "name": "Narva", "target": "Estonia",
                                   "aggressor": "Russia"}})
    assert b.startswith(b"%PDF-")


def test_scenario_never_claims_an_unobserved_laydown_was_seen():
    b = sx.build_pdf({"scenario": {"id": "s1", "name": "Narva"},
                      "laydown": {"units": [{"id": "1", "aff": "hostile",
                                             "what": "armour crossing"}]}})
    assert "NOT AN OBSERVED MOVEMENT" in _text(b)


def test_scenario_without_a_laydown_does_not_promise_one():
    # The prior's empty state used to say "the laydown below still
    # describes a course of action" on a page with no laydown on it.
    b = sx.build_pdf({"scenario": {"id": "s1", "name": "Narva"}})
    t = _text(b)
    assert "The laydown below still describes" not in t
    assert "No laydown was drawn" in t


def test_scenario_survives_an_empty_payload():
    assert sx.build_pdf({}).startswith(b"%PDF-")


def test_scenario_reports_unknown_capability_as_unknown():
    b = sx.build_pdf({"scenario": {"id": "s1", "name": "N"},
                      "assessment": {"capabilities": None,
                                     "available": [{"kind": "ground", "label": "Ground",
                                                    "doctrine": "d", "uncertain": []}]}})
    assert "unknown rather than absent" in _text(b)


# ── imagery ─────────────────────────────────────────────────────────────

def _scene(**over):
    base = {"scan": {"scan_id": "sc1", "status": "completed", "instrument": "OPTICAL"},
            "zone": {"name": "Khor Fakkan Port", "bbox": {}},
            "detections": [], "counts": [], "changes": [], "reference_scan_id": None}
    base.update(over)
    return base


def test_imagery_pdf_is_a_pdf():
    assert ix.build_pdf(_scene()).startswith(b"%PDF-")


def test_a_crashed_scan_is_not_reported_as_a_clean_negative():
    # The whole point. "The models ran and returned no object above
    # threshold" is a finding; saying it about a scan that never ran turns
    # a crash into evidence of absence.
    b = ix.build_pdf(_scene(scan={"scan_id": "sc1", "status": "error",
                                  "error_message": "boom"}))
    t = _text(b)
    assert "the models ran and returned no object" not in t
    assert "did not finish" in t
    assert "not a statement that the frame is empty" in t


def test_a_crashed_scan_does_not_claim_to_be_the_first_of_its_area():
    b = ix.build_pdf(_scene(scan={"scan_id": "sc1", "status": "error"}))
    assert "This is the first scan of this area" not in _text(b)


def test_a_completed_empty_scan_does_report_a_clean_negative():
    # The converse must still hold, or the honest case gets lost.
    t = _text(ix.build_pdf(_scene()))
    assert "the models ran and returned no object" in t


def test_undecodable_image_bytes_do_not_raise():
    # A corrupt frame must degrade to words, never to a traceback or a
    # grey box that reads like sensor noise.
    b = ix.build_pdf(_scene(image_b64="not base64 at all !!"))
    assert b.startswith(b"%PDF-")
    assert "No image is stored" in _text(b)
