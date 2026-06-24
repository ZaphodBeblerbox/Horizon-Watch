#!/usr/bin/env python3
"""
Horizon Watch Drone Surveillance Worker
Run: python3 backend/drone_worker.py

Uses ffmpeg subprocess for frame capture (reliable on macOS ARM with RTMP/HLS),
runs YOLOv8 inference every N seconds, pushes detections to Horizon Watch via SSE.
"""
import cv2
import time
import requests
import argparse
import sys
import subprocess
import numpy as np
import shutil

parser = argparse.ArgumentParser(description='Horizon Watch drone worker')
parser.add_argument('--rtmp',     default='rtmp://127.0.0.1:1935/drone',
                    help='RTMP or HLS stream URL')
parser.add_argument('--api',      default='http://localhost:8000',
                    help='Horizon Watch API base URL')
parser.add_argument('--conf',     type=float, default=0.35,
                    help='Detection confidence threshold')
parser.add_argument('--interval', type=float, default=1.0,
                    help='Seconds between inferences')
parser.add_argument('--model',    default='yolov8n.pt',
                    help='YOLO model: yolov8n.pt (fast) or yolov8s.pt (better)')
parser.add_argument('--width',    type=int, default=1280)
parser.add_argument('--height',   type=int, default=720)
args = parser.parse_args()

print(f"Loading {args.model}...")
try:
    from ultralytics import YOLO
    model = YOLO(args.model)
    print(f"Model ready — {len(model.names)} classes")
except ImportError:
    print("ERROR: pip install ultralytics")
    sys.exit(1)

W, H = args.width, args.height
FFMPEG = shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'

def open_ffmpeg(url):
    cmd = [
        FFMPEG, '-loglevel', 'quiet',
        '-i', url,
        '-vf', f'scale={W}:{H}',
        '-f', 'rawvideo',
        '-pix_fmt', 'bgr24',
        '-r', '10',       # cap at 10fps for stability
        'pipe:1',
    ]
    return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=10**8)

print(f"Connecting to {args.rtmp}...")
proc = None
session = requests.Session()
frame_count     = 0
detection_count = 0
last_inference  = 0
frame_bytes     = W * H * 3

while True:
    if proc is None or proc.poll() is not None:
        if proc is not None:
            print("Stream lost — reconnecting in 3s...")
            time.sleep(3)
        try:
            proc = open_ffmpeg(args.rtmp)
            print("Stream connected. Starting inference...")
            print(f"Conf: {args.conf} | Interval: {args.interval}s | {W}x{H}")
        except Exception as e:
            print(f"ffmpeg launch error: {e}")
            time.sleep(3)
            continue

    raw = proc.stdout.read(frame_bytes)
    if not raw or len(raw) < frame_bytes:
        proc.kill()
        proc = None
        continue

    frame = np.frombuffer(raw, dtype=np.uint8).reshape((H, W, 3))
    frame_count += 1

    now = time.time()
    if now - last_inference < args.interval:
        continue
    last_inference = now

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
            conf_val = float(box.conf[0])
            cls_id   = int(box.cls[0])
            cls_name = model.names.get(cls_id, 'unknown')
            dets.append({
                "class":           cls_name,
                "confidence":      round(conf_val, 3),
                "bbox_normalized": [
                    round(x1/W, 4), round(y1/H, 4),
                    round(x2/W, 4), round(y2/H, 4),
                ],
            })

    detection_count += len(dets)

    if frame_count % 10 == 0:
        classes = [f"{d['class']} {d['confidence']:.0%}" for d in dets]
        summary = ', '.join(classes) if classes else 'none'
        print(f"  frame={frame_count} dets={len(dets)} [{summary}]")

    try:
        session.post(
            f"{args.api}/api/drone/detections",
            json={"detections": dets, "timestamp": now},
            timeout=2,
        )
    except Exception:
        pass
