import regional_floor as rf


def it(i, c):
    return {"id": i, "location_country": c}


def test_floor_lifts_the_region_and_keeps_order():
    ranked = [it(i, "France") for i in range(8)] + [it(8, "Sudan"), it(9, "Mali"), it(10, "Spain")]
    out = rf.apply_floor(ranked, keep=5, floor=2)
    assert [x["id"] for x in out] == [0, 1, 2, 8, 9]


def test_no_change_when_enough_or_not_overflowing():
    ranked = [it(0, "Sudan"), it(1, "Mali"), it(2, "France"), it(3, "Chad")]
    assert rf.apply_floor(ranked, keep=3, floor=2) == ranked[:3]
    assert rf.apply_floor(ranked[:2], keep=5, floor=2) == ranked[:2]


def test_names_as_the_pool_writes_them():
    assert rf.in_africa({"location_country": "Democratic Republic of the Congo"})
    assert rf.in_africa({"location_country": "United Republic of Tanzania"})
    assert not rf.in_africa({"location_country": "Yemen"})
