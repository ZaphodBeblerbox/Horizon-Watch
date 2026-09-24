"""
/api/sentinel/sar-imagery used a date window it never declared.

The raw-bands fetch gained date_from/date_to for change detection, and
the body edit landed on the VISUAL fetch as well — a function whose
signature never took them. Every call raised NameError, the handler
caught it, and the endpoint returned {"error": "name 'date_from' is not
defined"}. SAR imagery had not loaded once.
"""
import inspect
import main as m


def test_the_visual_sar_fetch_declares_the_window_it_uses():
    sig = inspect.signature(m._fetch_sentinel1_image_bytes)
    assert "date_from" in sig.parameters
    assert "date_to" in sig.parameters


def test_the_raw_bands_fetch_declares_it_too():
    sig = inspect.signature(m._fetch_sentinel1_raw_bands_geotiff)
    assert "date_from" in sig.parameters
    assert "date_to" in sig.parameters


def test_neither_uses_a_name_it_has_not_declared():
    # The general form of the bug: any name referenced in these bodies
    # must be a parameter, a local, or a module global.
    for fn in (m._fetch_sentinel1_image_bytes, m._fetch_sentinel1_raw_bands_geotiff):
        src = inspect.getsource(fn)
        params = set(inspect.signature(fn).parameters)
        for name in ("date_from", "date_to", "max_age_days", "bounds"):
            if name in src:
                assert name in params, f"{fn.__name__} uses {name} without declaring it"
