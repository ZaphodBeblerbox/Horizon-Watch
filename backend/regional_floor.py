"""
regional_floor.py — a guaranteed share of the signal pool for a region.

The surface pool keeps the 300 most relevant signals worldwide. Measured
2026-10-10: Africa was 16 of 274 (5%) while wars ran in Sudan, the Sahel,
eastern Congo, Somalia and Nigeria — a busy week anywhere else pushed it off
the end. When the pool overflows, at least `floor` places go to the region
if it has that many candidates; the lowest-ranked items elsewhere make room
and everything keeps its relevance order.
"""
from __future__ import annotations

AFRICA = {
    "algeria", "angola", "benin", "botswana", "burkina faso", "burundi", "cabo verde", "cape verde", "cameroon",
    "central african republic", "chad", "comoros", "congo", "republic of the congo", "democratic republic of the congo",
    "dr congo", "drc", "djibouti", "egypt", "equatorial guinea", "eritrea", "eswatini", "swaziland", "ethiopia",
    "gabon", "gambia", "the gambia", "ghana", "guinea", "guinea-bissau", "côte d'ivoire", "cote d'ivoire",
    "ivory coast", "kenya", "lesotho", "liberia", "libya", "madagascar", "malawi", "mali", "mauritania",
    "mauritius", "morocco", "mozambique", "namibia", "niger", "nigeria", "rwanda", "são tomé and príncipe",
    "sao tome and principe", "senegal", "seychelles", "sierra leone", "somalia", "somaliland", "south africa",
    "south sudan", "sudan", "tanzania", "united republic of tanzania", "togo", "tunisia", "uganda",
    "western sahara", "zambia", "zimbabwe",
}


def in_africa(item: dict) -> bool:
    return str(item.get("location_country") or "").strip().lower() in AFRICA


def apply_floor(ranked: list, keep: int, floor: int, in_region=in_africa) -> list:
    """The first `keep` items, with at least `floor` from the region when the
    candidates allow; order preserved."""
    if len(ranked) <= keep or floor <= 0:
        return ranked[:keep]
    head = list(range(keep))
    have = sum(1 for i in head if in_region(ranked[i]))
    if have >= floor:
        return ranked[:keep]
    extra = [i for i in range(keep, len(ranked)) if in_region(ranked[i])][:floor - have]
    if not extra:
        return ranked[:keep]
    # make room by dropping the lowest-ranked items outside the region
    outside = [i for i in reversed(head) if not in_region(ranked[i])][:len(extra)]
    chosen = sorted(set(head) - set(outside) | set(extra))
    return [ranked[i] for i in chosen]
