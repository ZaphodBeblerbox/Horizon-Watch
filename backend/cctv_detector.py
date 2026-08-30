#!/usr/bin/env python3
"""
Local CCTV detection server.
Run with: python backend/cctv_detector.py
Requires: pip install websockets yt-dlp ultralytics opencv-python
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import threading
import time

import cv2
import numpy as np
import websockets
from ultralytics import YOLO

# ── Config ─────────────────────────────────────────────────────────────────
MODEL_PATH = "yolov8n.pt"
WEBSOCKET_HOST = "localhost"
WEBSOCKET_PORT = 8765
FRAME_INTERVAL = 0.5        # run detection every 0.5s per stream
CONFIDENCE_THRESHOLD = 0.35
MAX_FRAME_WIDTH = 640       # downscale for speed

# Classes to detect and their display colors (BGR for cv2, hex for frontend)
DETECT_CLASSES = {
    0:  {"name": "person",     "color": "#FF4444"},
    1:  {"name": "bicycle",    "color": "#44FF44"},
    2:  {"name": "car",        "color": "#4444FF"},
    3:  {"name": "motorcycle", "color": "#FF8800"},
    5:  {"name": "bus",        "color": "#FF00FF"},
    6:  {"name": "train",      "color": "#00FFFF"},
    7:  {"name": "truck",      "color": "#FFFF00"},
    16: {"name": "dog",        "color": "#FF88FF"},
    24: {"name": "backpack",   "color": "#88FFFF"},
}

CAMERAS = [
    {
        "id": "cam-kensington",
        "youtubeId": "cWd_niy8Rz8",
        "name": "Kensington Live Webcam",
    },
    {
        "id": "cam-elbo-bar",
        "youtubeId": "YWs0HMRVCBY",
        "name": "Elbo Bar Live",
    },
]

# ── Global state ────────────────────────────────────────────────────────────
connected_clients = set()
latest_detections = {}   # cam_id -> {boxes, timestamp, count}
model = None


# ── WebSocket server ────────────────────────────────────────────────────────
async def ws_handler(websocket):
    connected_clients.add(websocket)
    try:
        # Send latest detections immediately on connect
        for cam_id, det in latest_detections.items():
            await websocket.send(json.dumps({"cam_id": cam_id, **det}))
        async for _ in websocket:
            pass  # we only push, never receive
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)


async def broadcast(message: str):
    if connected_clients:
        await asyncio.gather(
            *[ws.send(message) for ws in connected_clients],
            return_exceptions=True
        )


# ── Frame grabber ────────────────────────────────────────────────────────────
def get_stream_url(youtube_id: str) -> str | None:
    try:
        result = subprocess.run(
            ["yt-dlp", "-f", "best[height<=480]", "-g", "--cookies-from-browser", "safari",
             f"https://www.youtube.com/watch?v={youtube_id}"],
            capture_output=True, text=True, timeout=30
        )
        url = result.stdout.strip().split("\n")[0]
        return url if url else None
    except Exception as e:
        print(f"[yt-dlp] Error getting stream URL: {e}")
        return None


def grab_frame_fast(stream_url: str) -> np.ndarray | None:
    """Grab a single frame via ffmpeg, encoded as MJPEG for fast decode."""
    try:
        cmd = [
            "ffmpeg", "-y",
            "-i", stream_url,
            "-vframes", "1",
            "-f", "image2",
            "-vcodec", "mjpeg",
            "-loglevel", "quiet",
            "pipe:1"
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=10)
        if not result.stdout:
            return None
        arr = np.frombuffer(result.stdout, dtype=np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except Exception:
        return None


# ── Detection loop per camera ─────────────────────────────────────────────
def detection_loop(cam: dict, loop: asyncio.AbstractEventLoop):
    cam_id = cam["id"]
    youtube_id = cam["youtubeId"]
    print(f"[{cam_id}] Starting detection loop")

    stream_url = None
    stream_url_expiry = 0

    while True:
        try:
            # Refresh stream URL every 30 minutes (they expire)
            if time.time() > stream_url_expiry:
                print(f"[{cam_id}] Fetching stream URL...")
                stream_url = get_stream_url(youtube_id)
                if stream_url:
                    stream_url_expiry = time.time() + 1800
                    print(f"[{cam_id}] Stream URL obtained")
                else:
                    print(f"[{cam_id}] Failed to get stream URL, retrying in 30s")
                    time.sleep(30)
                    continue

            frame = grab_frame_fast(stream_url)
            if frame is None:
                print(f"[{cam_id}] Failed to grab frame, refreshing URL")
                stream_url_expiry = 0
                time.sleep(5)
                continue

            # Downscale for speed
            h, w = frame.shape[:2]
            if w > MAX_FRAME_WIDTH:
                scale = MAX_FRAME_WIDTH / w
                frame = cv2.resize(frame, (int(w * scale), int(h * scale)))
                h, w = frame.shape[:2]

            # Run YOLO detection
            results = model(frame, verbose=False, conf=CONFIDENCE_THRESHOLD)
            boxes = []
            for r in results:
                for box in r.boxes:
                    cls_id = int(box.cls[0])
                    if cls_id not in DETECT_CLASSES:
                        continue
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    conf = float(box.conf[0])
                    boxes.append({
                        "x1": x1 / w,   # normalised 0-1
                        "y1": y1 / h,
                        "x2": x2 / w,
                        "y2": y2 / h,
                        "conf": round(conf, 2),
                        "class": DETECT_CLASSES[cls_id]["name"],
                        "color": DETECT_CLASSES[cls_id]["color"],
                    })

            payload = {
                "cam_id": cam_id,
                "boxes": boxes,
                "timestamp": time.time(),
                "count": len(boxes),
            }
            latest_detections[cam_id] = payload

            # Broadcast to all connected WebSocket clients
            asyncio.run_coroutine_threadsafe(
                broadcast(json.dumps(payload)), loop
            )

            if boxes:
                labels = [b["class"] for b in boxes]
                print(f"[{cam_id}] {len(boxes)} detections: {labels}")

        except Exception as e:
            print(f"[{cam_id}] Detection error: {e}")
            time.sleep(5)

        time.sleep(FRAME_INTERVAL)


# ── Main ──────────────────────────────────────────────────────────────────
async def main():
    global model
    print("[CCTV] Loading YOLOv8 model...")
    model = YOLO(MODEL_PATH)
    print("[CCTV] Model loaded")

    loop = asyncio.get_running_loop()

    # Start one detection thread per camera
    for cam in CAMERAS:
        t = threading.Thread(
            target=detection_loop,
            args=(cam, loop),
            daemon=True
        )
        t.start()

    # Start WebSocket server
    print(f"[CCTV] WebSocket server starting on ws://{WEBSOCKET_HOST}:{WEBSOCKET_PORT}")
    async with websockets.serve(ws_handler, WEBSOCKET_HOST, WEBSOCKET_PORT):
        print("[CCTV] Ready. Open Horizon Watch and click a camera.")
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
