"""
sentinel_tiles.py — fetch a Sentinel AOI at the sensor's own resolution
instead of squashing it into one thumbnail.

THE PROBLEM THIS SOLVES. `_fetch_sentinel_image_bytes` renders any bounding
box into a single image of at most 2048 pixels a side. That is a fixed
pixel budget applied to a variable area, so the ground resolution silently
collapses as the AOI grows. Measured against the zones actually in the
database:

    AOI span      rendered      ground res     a 100m ship is
    ------------  ------------  -------------  ----------------
    0.06 deg      512 px         11.8 m/px      8.5 px
    0.30 deg     1024 px         32.5 m/px      3.1 px
    2.00 deg     2048 px         97.0 m/px      1.0 px   <- ZONE-001

Sentinel-2's native resolution is 10 m/px. At 97 m/px a large vessel is one
pixel and no model, however good, can find it. This is why detections were
poor on the big zones: the detector was never shown the data. Swapping in a
better model would have changed nothing.

THE FIX is the same one the Esri/Overwatch path already uses: cover the AOI
with a grid of requests, each at native resolution, and run detection on
each. The difference is that Sentinel tiles cost API quota rather than a
free basemap fetch, so the grid needs a real budget and has to say honestly
when it cannot cover an area rather than quietly dropping to a thumbnail.

WHY NOT JUST RAISE THE PIXEL CAP. The Sentinel Hub Process API refuses a
request above 2500 px a side. At 10 m/px that is a hard ceiling of 25 km per
request, whatever we ask for. Covering ZONE-001 (199 x 111 km) therefore
takes a grid, not a bigger image.

EVERY NUMBER HERE IS GEOMETRY, deliberately: the functions below take and
return plain values and touch no network, so the tiling can be tested
exactly rather than inferred from a scan's output.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

# Sentinel-2 optical: 10 m/px for the visible bands (B02/B03/B04).
# Sentinel-1 GRD IW: 10 m/px pixel spacing.
NATIVE_M_PER_PX = 10.0

# Sentinel Hub Process API hard ceiling per request, in pixels per side.
# Asking for more is refused outright, so this bounds tile size, not policy.
MAX_REQUEST_PX = 2500

# Leave headroom under the API ceiling: an exactly-2500px request has no room
# for the rounding that projecting degrees to pixels introduces.
TILE_PX = 2048

M_PER_DEG_LAT = 111_320.0


def m_per_deg_lon(lat: float) -> float:
    """Metres per degree of longitude shrinks towards the poles."""
    return M_PER_DEG_LAT * max(0.01, math.cos(math.radians(lat)))


@dataclass
class Tile:
    """One fetchable sub-area of an AOI, at native resolution."""
    ix: int
    iy: int
    west: float
    south: float
    east: float
    north: float
    width_px: int
    height_px: int

    @property
    def bounds(self) -> dict:
        return {"west": self.west, "south": self.south,
                "east": self.east, "north": self.north}

    @property
    def m_per_px(self) -> float:
        lat_mid = (self.north + self.south) / 2
        width_m = abs(self.east - self.west) * m_per_deg_lon(lat_mid)
        return width_m / max(1, self.width_px)


@dataclass
class TilePlan:
    """The full plan for covering an AOI, including why it is what it is.

    Carries the honest numbers rather than just the tiles: a caller that
    cannot afford the plan needs to say what it would have cost.
    """
    tiles: list[Tile] = field(default_factory=list)
    cols: int = 0
    rows: int = 0
    m_per_px: float = NATIVE_M_PER_PX
    area_km2: float = 0.0
    refused: str | None = None          # set when the AOI exceeds the budget
    degraded_to_m_per_px: float | None = None   # set when resolution was traded away

    @property
    def count(self) -> int:
        return len(self.tiles)

    @property
    def api_requests(self) -> int:
        """One Sentinel Hub Process API request per tile. This is the number
        that costs quota, so it is the number worth showing."""
        return len(self.tiles)

    @property
    def estimated_seconds(self) -> float:
        """Rough wall-clock, for a progress bar's initial estimate.

        Calibrated from a real run: one 1207x1336 tile over Khor Fakkan took
        4.0s end to end including fetch, decode and detection. Tiles are
        serialised through the single imagery worker, so cost is linear in
        tile count rather than parallel. Deliberately an over-estimate:
        a bar that finishes early is better than one that stalls at 99%.
        """
        return round(len(self.tiles) * 4.5, 1)

    def describe(self) -> str:
        """One line a UI can show before committing to the scan."""
        if self.refused:
            return self.refused
        res = f"{self.m_per_px:.0f} m/px"
        if self.degraded_to_m_per_px:
            res += f" (coarsened from {NATIVE_M_PER_PX:.0f} m/px to fit a budget)"
        mins = self.estimated_seconds / 60.0
        eta = (f"{self.estimated_seconds:.0f}s" if self.estimated_seconds < 90
               else f"about {mins:.0f} min")
        return (f"{self.count} tile(s) ({self.cols}x{self.rows}) covering "
                f"{self.area_km2:,.0f} km² at {res} — {self.api_requests} API "
                f"request(s), roughly {eta}")


def plan_tiles(bounds: dict, *, target_m_per_px: float = NATIVE_M_PER_PX,
               tile_px: int = TILE_PX, max_tiles: int | None = None,
               allow_degrade: bool = False) -> TilePlan:
    """Cover `bounds` with native-resolution tiles.

    NO TILE CAP BY DEFAULT, by explicit product decision (2026-09-19): a big
    area should take longer, not arrive blurred. A cap silently trades away
    the thing the scan exists to produce — resolution — and the whole reason
    this module was written is that the old single-image path did exactly
    that. A slow scan with a progress bar is a scan; a fast one that cannot
    resolve a ship is not.

    So `max_tiles` defaults to None (unlimited) and `allow_degrade` to False.
    Both remain available for a caller that would genuinely rather have a
    coarse answer now — a preview, say — but neither is the default.

    What replaces the cap is COST, MADE VISIBLE. Each tile is one Sentinel
    Hub Process API request, so a plan reports how many requests and roughly
    how long it will take before anything is fetched. The caller can then
    show it, or think again, with real numbers rather than a policy someone
    guessed at.
    """
    west, south = float(bounds["west"]), float(bounds["south"])
    east, north = float(bounds["east"]), float(bounds["north"])
    if east <= west or north <= south:
        return TilePlan(refused="bounds are empty or inverted")

    lat_mid = (north + south) / 2
    width_m = (east - west) * m_per_deg_lon(lat_mid)
    height_m = (north - south) * M_PER_DEG_LAT
    area_km2 = (width_m / 1000.0) * (height_m / 1000.0)

    tile_px = min(int(tile_px), MAX_REQUEST_PX)
    mpp = float(target_m_per_px)
    degraded = None

    def grid_for(res_m_per_px: float) -> tuple[int, int]:
        span_m = tile_px * res_m_per_px          # ground covered by one tile
        return (max(1, math.ceil(width_m / span_m)),
                max(1, math.ceil(height_m / span_m)))

    cols, rows = grid_for(mpp)
    if max_tiles is not None and cols * rows > max_tiles:
        if not allow_degrade:
            return TilePlan(
                cols=cols, rows=rows, m_per_px=mpp, area_km2=area_km2,
                refused=(
                    f"covering {area_km2:,.0f} km² at {mpp:.0f} m/px needs "
                    f"{cols * rows} tiles ({cols}x{rows}), over the budget of "
                    f"{max_tiles}. Draw a smaller area, or allow a coarser scan."
                ),
            )
        # Coarsen just enough to fit, and record that we did. Scaling
        # resolution by sqrt of the overshoot is the smallest step that
        # brings a 2-D grid inside the budget.
        overshoot = (cols * rows) / max_tiles
        mpp = mpp * math.sqrt(overshoot)
        cols, rows = grid_for(mpp)
        while cols * rows > max_tiles and mpp < 200:  # noqa: has max_tiles
            mpp *= 1.15
            cols, rows = grid_for(mpp)
        if cols * rows > max_tiles:
            return TilePlan(
                cols=cols, rows=rows, m_per_px=mpp, area_km2=area_km2,
                refused=(
                    f"{area_km2:,.0f} km² cannot be covered within {max_tiles} "
                    f"tiles even at {mpp:.0f} m/px — draw a smaller area."
                ),
            )
        degraded = mpp

    # Build the grid. Tiles are equal in degrees so their seams line up
    # exactly; the last column/row is not shrunk, because a short tile would
    # arrive at a different scale and quietly change the detector's input.
    dlon = (east - west) / cols
    dlat = (north - south) / rows
    tiles: list[Tile] = []
    for iy in range(rows):
        for ix in range(cols):
            t_west = west + ix * dlon
            t_east = t_west + dlon
            t_south = south + iy * dlat
            t_north = t_south + dlat
            t_lat_mid = (t_north + t_south) / 2
            w_px = int(round((t_east - t_west) * m_per_deg_lon(t_lat_mid) / mpp))
            h_px = int(round((t_north - t_south) * M_PER_DEG_LAT / mpp))
            tiles.append(Tile(
                ix=ix, iy=iy,
                west=t_west, south=t_south, east=t_east, north=t_north,
                width_px=max(32, min(MAX_REQUEST_PX, w_px)),
                height_px=max(32, min(MAX_REQUEST_PX, h_px)),
            ))

    return TilePlan(tiles=tiles, cols=cols, rows=rows, m_per_px=mpp,
                    area_km2=area_km2, degraded_to_m_per_px=degraded)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def merge_detections(detections: list[dict], *, radius_m: float = 60.0) -> list[dict]:
    """Collapse duplicates produced by the same object appearing in two tiles.

    A tiled scan sees objects near a seam twice. Deduplicating by geographic
    proximity rather than by pixel box is what makes the merge correct across
    tiles that were never in the same image.

    The survivor is the highest-confidence copy. Ties keep the first, so the
    result is stable across runs — an unstable ordering would make change
    detection between two scans report churn that did not happen.
    """
    if not detections:
        return []

    ordered = sorted(
        enumerate(detections),
        key=lambda p: (-(p[1].get("confidence") or 0.0), p[0]),
    )
    kept: list[dict] = []
    for _, det in ordered:
        lat, lon = det.get("centroid_lat"), det.get("centroid_lon")
        if lat is None or lon is None:
            kept.append(det)
            continue
        dup = False
        for k in kept:
            klat, klon = k.get("centroid_lat"), k.get("centroid_lon")
            if klat is None or klon is None:
                continue
            # Only the same KIND of object is a duplicate: a vessel and a
            # storage tank at one location are two findings, not one seen
            # twice.
            if k.get("object_type") != det.get("object_type"):
                continue
            if haversine_m(lat, lon, klat, klon) <= radius_m:
                dup = True
                k["merged_count"] = k.get("merged_count", 1) + 1
                break
        if not dup:
            kept.append(det)
    return kept


# ── running a plan ────────────────────────────────────────────────────────
#
# Orchestration only: the fetch and the detector are passed in. That keeps
# the tiling testable without a network or a model, which matters because
# the failure modes worth testing here (a tile that fails to fetch, a tile
# with no detections, duplicates on a seam) are all about bookkeeping rather
# than about imagery.

def _advance(job_id, done, detections):
    """Advance the bar. A failed tile still advances it — a bar that freezes
    on the one tile that broke is the least useful moment to stop reporting."""
    if not job_id:
        return
    try:
        import imagery_runtime as _ir
        _ir.update_progress(job_id, done, detections=detections)
    except Exception:
        pass


async def run_tiled_scan(plan: "TilePlan", *, fetch_tile, detect_tile,
                         on_progress=None, job_id: str | None = None) -> dict:
    """Fetch and detect over every tile in `plan`, then merge.

    `fetch_tile(tile) -> dict` must return {"image": <decoded image>} or
    {"error": "..."}; `detect_tile(image, bbox_dict) -> list[dict]`.

    A TILE THAT FAILS IS RECORDED, NOT SKIPPED SILENTLY. If three of twenty
    tiles never arrived, the scan covered 85% of the AOI and the caller has
    to be able to say so — otherwise "no detections in that corner" is
    indistinguishable from "never looked at that corner", which is the
    failure this project has hit repeatedly in other subsystems.
    """
    if plan.refused:
        return {"status": "error", "error_message": plan.refused,
                "detections": [], "tiles_total": 0, "tiles_ok": 0}

    # Register the bar before the first fetch: a scan that shows nothing for
    # its first tile looks hung, and with no tile cap a legitimate scan can
    # run for minutes.
    if job_id:
        try:
            import imagery_runtime as _ir
            _ir.start_progress(job_id, len(plan.tiles), label=plan.describe())
        except Exception:
            pass

    detections: list[dict] = []
    failed: list[dict] = []
    ok = 0

    for i, tile in enumerate(plan.tiles):
        try:
            got = await fetch_tile(tile)
        except Exception as e:                      # noqa: BLE001
            got = {"error": f"{type(e).__name__}: {e}"}
        if not got or got.get("error"):
            failed.append({"ix": tile.ix, "iy": tile.iy,
                           "reason": (got or {}).get("error", "no image returned")})
            _advance(job_id, i + 1, len(detections))
            continue
        bbox = {"min_lon": tile.west, "min_lat": tile.south,
                "max_lon": tile.east, "max_lat": tile.north}
        try:
            found = await detect_tile(got["image"], bbox) or []
        except Exception as e:                      # noqa: BLE001
            failed.append({"ix": tile.ix, "iy": tile.iy,
                           "reason": f"detection failed: {type(e).__name__}: {e}"})
            _advance(job_id, i + 1, len(detections))
            continue
        for d in found:
            d.setdefault("tile", {"ix": tile.ix, "iy": tile.iy})
        detections.extend(found)
        ok += 1
        if on_progress:
            on_progress(i + 1, len(plan.tiles), len(detections))
        if job_id:
            try:
                import imagery_runtime as _ir
                _ir.update_progress(job_id, i + 1, detections=len(detections))
            except Exception:
                pass

    if job_id:
        try:
            import imagery_runtime as _ir
            _ir.finish_progress(job_id, note=f"{ok}/{len(plan.tiles)} tiles")
        except Exception:
            pass

    merged = merge_detections(detections)
    coverage = ok / len(plan.tiles) if plan.tiles else 0.0
    return {
        "status": "completed" if ok else "error",
        "error_message": None if ok else "every tile failed to fetch or detect",
        "detections": merged,
        "raw_detection_count": len(detections),
        "tiles_total": len(plan.tiles),
        "tiles_ok": ok,
        "tiles_failed": failed,
        "coverage_fraction": round(coverage, 3),
        "m_per_px": round(plan.m_per_px, 1),
        "degraded": plan.degraded_to_m_per_px is not None,
    }
