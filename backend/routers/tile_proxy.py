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
        # Empty tile — return 204 so clients don't show an error
        return Response(status_code=204)
    if r.status_code != 200:
        raise HTTPException(502, detail=f"upstream {r.status_code}")

    return Response(
        content=r.content,
        media_type="application/vnd.mapbox-vector-tile",
        headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600"},
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
