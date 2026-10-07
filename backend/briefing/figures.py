"""
briefing/figures.py — the figures a briefing carries, drawn from data.

Charts are matplotlib SVG (sharp at any zoom, small), in the report's own
palette; maps are country outlines from geo/countries.geojson with the
places plotted and numbered, in the style of the Trifecta figures (beige
land, quiet water, a scale bar, north arrow). Each returns the SVG markup to
inline into the HTML — the PDF is printed offline, so nothing is fetched.
"""
from __future__ import annotations

import io
import json
import math
from functools import lru_cache
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

INK = "#1b1f24"
RULE = "#c9c5bc"
LAND = "#d9cfbf"
LAND_FOCUS = "#cdbfa8"
WATER = "#f3efe8"
PALETTE = ["#b8892f", "#a85f3a", "#8b3a2f", "#a89f68", "#5f7a5c", "#2f5c90"]

plt.rcParams.update({"font.family": ["DejaVu Sans"], "font.size": 8, "axes.edgecolor": RULE,
                     "axes.labelcolor": INK, "xtick.color": INK, "ytick.color": INK, "axes.spines.top": False,
                     "axes.spines.right": False, "svg.fonttype": "none"})


def _svg(fig) -> str:
    buf = io.StringIO()
    fig.savefig(buf, format="svg", bbox_inches="tight", transparent=True)
    plt.close(fig)
    s = buf.getvalue()
    # laid out with DejaVu Sans (matplotlib cannot read web fonts), shown in
    # the report's Inter — their widths are close enough for chart labels
    s = s.replace("'DejaVu Sans'", "'Inter', 'DejaVu Sans'").replace('"DejaVu Sans"', '"Inter", "DejaVu Sans"')
    return s[s.index("<svg"):]


def bars(labels: list[str], values: list[float], title: str = "", ylabel: str = "", highlight: int | None = None,
         width_in: float = 6.4, height_in: float = 2.6) -> str:
    fig, ax = plt.subplots(figsize=(width_in, height_in))
    colors = [PALETTE[2] if i == highlight else PALETTE[0] for i in range(len(values))]
    b = ax.bar(labels, values, color=colors, width=0.62)
    for rect, v in zip(b, values):
        ax.annotate(f"{v:,.0f}".replace(",", "."), (rect.get_x() + rect.get_width() / 2, rect.get_height()),
                    ha="center", va="bottom", fontsize=7.5, xytext=(0, 2), textcoords="offset points")
    ax.set_ylabel(ylabel)
    if title:
        ax.set_title(title, fontsize=8.5, loc="left", color=INK)
    ax.grid(axis="y", color=RULE, linewidth=0.5)
    ax.set_axisbelow(True)
    return _svg(fig)


def line(xs: list[str], ys: list[float], title: str = "", ylabel: str = "", estimate_from: int | None = None,
         width_in: float = 6.4, height_in: float = 2.4) -> str:
    fig, ax = plt.subplots(figsize=(width_in, height_in))
    n = len(xs) if estimate_from is None else estimate_from + 1
    ax.plot(xs[:n], ys[:n], color=INK, marker="o", markersize=3.5, linewidth=1.2)
    if estimate_from is not None:
        ax.plot(xs[estimate_from:], ys[estimate_from:], color=INK, marker="o", markersize=3.5, linewidth=1.2, linestyle="--", markerfacecolor="white")
    ax.set_ylabel(ylabel)
    if title:
        ax.set_title(title, fontsize=8.5, loc="left", color=INK)
    ax.grid(axis="y", color=RULE, linewidth=0.5)
    return _svg(fig)


@lru_cache(maxsize=1)
def _countries():
    p = Path(__file__).resolve().parent.parent / "geo" / "countries.geojson"
    return json.loads(p.read_text())["features"]


def _rings(geom):
    if geom["type"] == "Polygon":
        return geom["coordinates"]
    if geom["type"] == "MultiPolygon":
        return [r for poly in geom["coordinates"] for r in poly]
    return []


def place_map(points: list[dict], bbox: tuple[float, float, float, float] | None = None, focus_iso: str | None = None,
              width_in: float = 6.0, height_in: float = 3.9, legend_title: str = "", legend: list[str] | None = None) -> str:
    """points: [{lat, lon, n (number shown), label, color?}]; bbox (west, south, east, north)."""
    if not bbox:
        lats = [p["lat"] for p in points] or [50]
        lons = [p["lon"] for p in points] or [10]
        pad = max(1.0, (max(lats) - min(lats)) * 0.25, (max(lons) - min(lons)) * 0.25)
        bbox = (min(lons) - pad, min(lats) - pad, max(lons) + pad, max(lats) + pad)
    w, s, e, n = bbox
    k = math.cos(math.radians((s + n) / 2))                            # equirectangular, squashed by latitude
    fig, ax = plt.subplots(figsize=(width_in, height_in))
    ax.set_facecolor(WATER)
    for f in _countries():
        iso = (f.get("properties") or {}).get("ISO_A2") or (f.get("properties") or {}).get("iso_a2")
        for ring in _rings(f["geometry"]):
            xs = [c[0] * k for c in ring]
            ys = [c[1] for c in ring]
            if max(xs) < w * k or min(xs) > e * k or max(ys) < s or min(ys) > n:
                continue
            ax.fill(xs, ys, color=LAND_FOCUS if focus_iso and iso == focus_iso else LAND, linewidth=0.4, edgecolor="#f7f3ec")
    for p in points:
        ax.plot(p["lon"] * k, p["lat"], "o", color=p.get("color") or PALETTE[2], markersize=6, markeredgecolor="white", markeredgewidth=0.8, zorder=5)
        if p.get("n") is not None:
            ax.annotate(str(p["n"]), (p["lon"] * k, p["lat"]), xytext=(5, 4), textcoords="offset points", fontsize=7.5, color=INK, weight="bold", zorder=6)
    ax.set_xlim(w * k, e * k)
    ax.set_ylim(s, n)
    ax.set_aspect("equal")
    ax.set_xticks([]); ax.set_yticks([])
    for sp in ax.spines.values():
        sp.set_visible(True); sp.set_color(RULE)
    # scale bar: a round distance about a fifth of the width
    km_w = (e - w) * 111 * k
    step = next((v for v in (5, 10, 20, 25, 50, 100, 150, 200, 300, 500, 1000) if v >= km_w / 6), 1000)
    x0, y0 = w * k + (e - w) * k * 0.05, s + (n - s) * 0.06
    ax.plot([x0, x0 + step / 111], [y0, y0], color=INK, linewidth=1.6)
    ax.annotate(f"{step} km", (x0, y0), xytext=(0, 4), textcoords="offset points", fontsize=7)
    ax.annotate("N", (e * k - (e - w) * k * 0.04, n - (n - s) * 0.08), fontsize=8, ha="center", weight="bold")
    if legend:
        txt = (legend_title + "\n" if legend_title else "") + "\n".join(legend)
        ax.text(1.02, 1.0, txt, transform=ax.transAxes, fontsize=7, va="top", ha="left", linespacing=1.5)
    return _svg(fig)
