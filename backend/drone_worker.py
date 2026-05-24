#!/usr/bin/env python3
"""
Horizon Watch Drone Surveillance Worker
Run: python3 backend/drone_worker.py

Reads live RTMP stream from mediamtx, runs YOLOv8 inference every N seconds,
pushes detections to Horizon Watch via SSE.
"""
import cv2
import time
import requests
import argparse
import sys

parser = argparse.ArgumentParser(description='Horizon Watch drone worker')
parser.add_argument('--rtmp',     default='rtmp://127.0.0.1:1935/drone',
                    help='RTMP stream URL')
parser.add_argument('--api',      default='https://horizon-watch-production.up.railway.app',
                    help='Horizon Watch API base URL')
parser.add_argument('--conf',     type=float, default=0.35,
                    help='Detection confidence threshold')
parser.add_argument('--interval', type=float, default=0.5,
                    help='Seconds between inferences (0.5 = 2fps)')
parser.add_argument('--model',    default='yolov8n.pt',
                    help='YOLO model: yolov8n.pt (fast) or yolov8s.pt (better)')
args = parser.parse_args()

print(f"Loading {args.model}...")
try:
    from ultralytics import YOLO
    model = YOLO(args.model)
    print(f"Model ready — {len(model.names)} classes")
except ImportError:
    print("ERROR: pip install ultralytics")
    sys.exit(1)

print(f"Connecting to {args.rtmp}...")
cap = cv2.VideoCapture(args.rtmp)

for i in range(15):
    if cap.isOpened():
        break
    print(f"  Waiting for stream... {i+1}/15")
    time.sleep(1)
    cap = cv2.VideoCapture(args.rtmp)

if not cap.isOpened():
    print(f"ERROR: Cannot connect to {args.rtmp}")
    print("Is mediamtx running? Is drone streaming?")
    sys.exit(1)

print("Stream connected. Starting inference...")
print(f"Conf: {args.conf} | Interval: {args.interval}s")
print("")

last_inference  = 0
frame_count     = 0
detection_count = 0
session         = requests.Session()

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        print("Stream lost — reconnecting...")
        time.sleep(2)
        cap = cv2.VideoCapture(args.rtmp)
        continue

    frame_count += 1
    now = time.time()
    if now - last_inference < args.interval:
        continue
    last_inference = now

    h, w = frame.shape[:2]

    try:
        results = model(frame, conf=args.conf, verbose=False, stream=False)
    except Exception as e:
        print(f"Inference error: {e}")
        continue

    dets = []
    for result in results:
        if result.boxes is None:
            continue
        for box in result.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            conf     = float(box.conf[0])
            cls_id   = int(box.cls[0])
            cls_name = model.names.get(cls_id, 'unknown')
            dets.append({
                "class":           cls_name,
                "confidence":      round(conf, 3),
                "bbox_normalized": [
                    round(x1/w, 4), round(y1/h, 4),
                    round(x2/w, 4), round(y2/h, 4),
                ],
            })

    detection_count += len(dets)

    if frame_count % 10 == 0:
        classes = [f"{d['class']} {d['confidence']:.0%}" for d in dets]
        summary = ', '.join(classes) if classes else 'none'
        print(f"  frame={frame_count} dets={len(dets)} [{summary}]")

    try:
        resp = session.post(
            f"{args.api}/api/drone/detections",
            json={"detections": dets, "timestamp": now},
            timeout=2,
        )
        if resp.status_code != 200:
            print(f"  API error: {resp.status_code}")
    except Exception:
        pass

cap.release()
print(f"Worker stopped. frames={frame_count} total_detections={detection_count}")
