#!/usr/bin/env python3
"""
Drone surveillance worker.
Run locally: python3 backend/drone_worker.py

Reads RTMP stream, runs YOLO every second,
posts detections to Horizon Watch API.
Requires: pip install ultralytics opencv-python pillow requests
"""
import cv2
import time
import requests
import base64
import io
import os

RTMP_URL  = os.environ.get("DRONE_RTMP_URL",  "rtmp://localhost:1935/live/horizon")
HW_API    = os.environ.get("DRONE_API_URL",   "https://horizon-watch-production.up.railway.app")
INTERVAL  = float(os.environ.get("DRONE_INTERVAL", "1.0"))   # seconds between inferences
CONF      = float(os.environ.get("DRONE_CONF",     "0.40"))  # confidence threshold

def frame_to_b64(frame):
    from PIL import Image
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return base64.b64encode(buf.getvalue()).decode()


def main():
    from ultralytics import YOLO
    model = YOLO("yolov8n.pt")   # downloads ~6 MB automatically; COCO classes

    print(f"Connecting to {RTMP_URL}...")
    cap = cv2.VideoCapture(RTMP_URL)

    if not cap.isOpened():
        print("ERROR: failed to open stream — is the drone streaming?")
        return

    print("Stream connected. Starting inference loop...")
    last_inference = 0.0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            print("Stream ended or lost")
            break

        now = time.time()
        if now - last_inference < INTERVAL:
            continue
        last_inference = now

        results = model(frame, conf=CONF, verbose=False)

        detections = []
        for result in results:
            if result.boxes is None:
                continue
            h, w = frame.shape[:2]
            for box in result.boxes:
                x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                conf     = float(box.conf[0])
                cls_id   = int(box.cls[0])
                cls_name = model.names[cls_id]
                detections.append({
                    "class":      cls_name,
                    "confidence": round(conf, 3),
                    "bbox":       [x1, y1, x2, y2],
                    "bbox_normalized": [
                        round(x1 / w, 4),
                        round(y1 / h, 4),
                        round(x2 / w, 4),
                        round(y2 / h, 4),
                    ],
                    "frame_width":  w,
                    "frame_height": h,
                })

        if detections:
            summary = ", ".join(
                f"{d['class']} {d['confidence']:.0%}" for d in detections
            )
            print(f"  {len(detections)} detections: {summary}")

        try:
            requests.post(
                f"{HW_API}/api/drone/detections",
                json={
                    "detections": detections,
                    "timestamp":  now,
                },
                timeout=3,
            )
        except Exception as e:
            print(f"  Push failed: {e}")

    cap.release()
    print("Worker stopped")


if __name__ == "__main__":
    main()
