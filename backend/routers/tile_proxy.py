import io
import httpx
from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import Response

router = APIRouter(prefix="/api", tags=["proxy"])

_OIM_BASE = "https://openinframap.org/tiles"
_HEADERS  = {"User-Agent": "NAGINI/2.0 tile-proxy (+https://github.com/nagini)"}

_client: httpx.AsyncClient | None = None

def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=10, follow_redirects=True)
    return _client


# 1×1 transparent PNG — returned for empty / error tiles
_TRANSPARENT_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)

# Colour map: MVT layer name → RGBA tuple (R, G, B, A)
_LAYER_COLORS: dict[str, tuple[int, int, int, int]] = {
    "power_line":            (232, 178,  58, 200),
    "power_cable":           (232, 178,  58, 150),
    "power_substation":      (232, 178,  58, 180),
    "power_plant":           (232, 178,  58, 120),
    "telecoms_line":         ( 46, 204, 113, 150),
    "telecoms_data_center":  ( 46, 204, 113, 180),
    "petroleum_pipeline":    (229,  87,  87, 180),
    "petroleum_well":        (229,  87,  87, 200),
    "water_pipeline":        ( 74, 158, 224, 150),
    "gas_pipeline":          (250, 170,  30, 160),
    "communication_line":    ( 46, 204, 113, 130),
}
_DEFAULT_COLOR: tuple[int, int, int, int] = (180, 180, 180, 100)

_LINE_WIDTH: dict[str, int] = {
    "power_line":       3,
    "power_cable":      2,
    "petroleum_pipeline": 3,
    "gas_pipeline":     3,
    "telecoms_line":    2,
    "water_pipeline":   2,
}


@router.get("/tiles/openinfra/{z}/{x}/{y}.pbf")
async def openinfra_tile(
    z: int = Path(..., ge=0, le=20),
    x: int = Path(..., ge=0),
    y: int = Path(..., ge=0),
):
    url = f"{_OIM_BASE}/{z}/{x}/{y}.pbf"
    try:
        r = await _get_client().get(url, headers=_HEADERS)
    except httpx.RequestError as exc:
        raise HTTPException(502, detail=f"upstream error: {exc}")

    if r.status_code == 404:
        return Response(status_code=204)
    if r.status_code != 200:
        raise HTTPException(502, detail=f"upstream {r.status_code}")

    return Response(
        content=r.content,
        media_type="application/vnd.mapbox-vector-tile",
        headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600"},
    )


@router.get("/tiles/openinfra-render/{z}/{x}/{y}.png")
async def openinfra_render(
    z: int = Path(..., ge=0, le=19),
    x: int = Path(..., ge=0),
    y: int = Path(..., ge=0),
):
    """Fetch OIM PBF tile and render it to a 1024×1024 PNG raster for Cesium ImageryLayer."""
    try:
        import mapbox_vector_tile as _mvt
        from PIL import Image, ImageDraw
    except ImportError:
        return Response(
            content=_TRANSPARENT_PNG,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    # Fetch the PBF
    url = f"{_OIM_BASE}/{z}/{x}/{y}.pbf"
    try:
        r = await _get_client().get(url, headers=_HEADERS)
    except httpx.RequestError:
        return Response(content=_TRANSPARENT_PNG, media_type="image/png")

    if r.status_code != 200 or not r.content:
        return Response(
            content=_TRANSPARENT_PNG,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    try:
        tile_data: dict = _mvt.decode(r.content)
    except Exception:
        return Response(content=_TRANSPARENT_PNG, media_type="image/png")

    size   = 1024
    extent = 4096
    img    = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw   = ImageDraw.Draw(img)

    def tx(v: float) -> int:
        return int(v / extent * size)

    def ty(v: float) -> int:
        return int(size - v / extent * size)

    for layer_name, layer in tile_data.items():
        color = _LAYER_COLORS.get(layer_name, _DEFAULT_COLOR)
        width = _LINE_WIDTH.get(layer_name, 2)

        for feature in layer.get("features", []):
            geom      = feature.get("geometry", {})
            geom_type = geom.get("type", "")
            coords    = geom.get("coordinates", [])

            if geom_type == "LineString":
                pts = [(tx(cx), ty(cy)) for cx, cy in coords]
                if len(pts) >= 2:
                    draw.line(pts, fill=color, width=width)

            elif geom_type == "MultiLineString":
                for line in coords:
                    pts = [(tx(cx), ty(cy)) for cx, cy in line]
                    if len(pts) >= 2:
                        draw.line(pts, fill=color, width=width)

            elif geom_type in ("Point", "MultiPoint"):
                singles = [coords] if geom_type == "Point" else coords
                for cx, cy in singles:
                    sx, sy = tx(cx), ty(cy)
                    r = 4
                    draw.ellipse([sx - r, sy - r, sx + r, sy + r], fill=color)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)

    return Response(
        content=buf.getvalue(),
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/overpass")
async def proxy_overpass(data: str):
    """Proxy Overpass API queries to bypass browser CORS restrictions."""
    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as client:
        try:
            r = await client.get(
                "https://overpass-api.de/api/interpreter",
                params={"data": data},
                headers={"User-Agent": "NAGINI/2.0 overpass-proxy"},
            )
        except httpx.TimeoutException:
            raise HTTPException(504, detail="Overpass timeout")
        except httpx.RequestError as exc:
            raise HTTPException(502, detail=str(exc))

    if r.status_code != 200:
        raise HTTPException(r.status_code, detail="Overpass upstream error")

    return Response(
        content=r.content,
        media_type="application/json",
        headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300"},
    )
