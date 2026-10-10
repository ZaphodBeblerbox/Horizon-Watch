"""Production deploys backend/ alone. Files the frontend owns are copied
into backend/seed; these tests fail the moment a copy drifts."""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def test_data_copies_equal_the_frontends():
    for name in ("world-countries.json", "cable-geo.json", "landing-point-geo.json"):
        with open(os.path.join(HERE, "seed", name), "rb") as a, open(os.path.join(ROOT, "public", "data", name), "rb") as b:
            assert a.read() == b.read(), f"backend/seed/{name} differs from public/data/{name} — copy it again"


def test_interest_regions_equal_the_frontends():
    src = open(os.path.join(ROOT, "src", "state", "interests.js"), encoding="utf-8").read()
    body = re.search(r"export const REGIONS = \{(.*?)\n\}", src, re.S).group(1)
    js = {k: json.loads(v) for k, v in re.findall(r'"([^"]+)":\s*(\[[^\]]*\])', body)}
    copy = json.load(open(os.path.join(HERE, "seed", "interest_regions.json"), encoding="utf-8"))["regions"]
    assert copy == js, "backend/seed/interest_regions.json differs from src/state/interests.js REGIONS"


def test_the_backend_resolves_them_from_seed():
    import paths
    for name in ("world-countries.json", "cable-geo.json", "landing-point-geo.json"):
        assert paths.shared_data(name).parent == paths.SEED_DIR
    from location_extract import country_name_from_code
    assert country_name_from_code("ua") == "Ukraine" and country_name_from_code("ps")
