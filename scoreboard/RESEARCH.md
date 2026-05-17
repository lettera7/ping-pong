# Research Notes — GoPro Live Scoreboard

## ITTF Rules (2024)

Source: https://cornilleau-tabletennis.com.au/official-ittf-table-tennis-rules

### Service (Law 2.06)
- Ball rests freely on open palm of server's stationary free hand
- Toss nearly vertically upward without spin, rising at least 16cm
- Server strikes ball as it descends so it touches server's court first, then passes over/around net to receiver's court
- Free arm must clear immediately after toss
- First doubtful service = warning + let; subsequent = point to receiver

### Return (Law 2.07)
- Ball must be struck to pass over/around net assembly and touch opponent's court

### A Let (Law 2.09)
- Service touches net but otherwise good
- Service while receiver not ready (and receiver doesn't attempt)
- External disturbance beyond player control
- Umpire interrupts play

### A Point (Law 2.10) — opponent scores when player:
- Fails to make good service
- Fails to make good return
- Ball passes end line without touching court after being struck
- Obstructs ball
- Strikes ball twice successively
- Touches net assembly
- Moves playing surface
- Free hand touches playing surface
- Double bounce on same side

### Scoring System
- Game to 11 points; at 10-10, first to gain 2-point lead wins
- Match: best of odd number of games (typically 5 or 7)
- Service changes every 2 points
- At 10-10 (expedite/deuce): service changes every 1 point

## GoPro Hero 12 — Preview Stream

Sources:
- https://gopro.github.io/OpenGoPro/python_sdk/
- https://github.com/KonradIT/GoProStream

### Known issues
- RTSP port 8554 does NOT respond to TCP connections on Hero 12
- HTTP API on port 8080 responds to `/gopro/camera/stream/start` but stream port stays closed
- Solution: Use `open-gopro` Python SDK which handles BLE+WiFi handshake

### Stream details
- Preview stream sent via UDP to port 8554
- Format: MPEG-TS (H.264)
- ffmpeg capture: `ffmpeg -fflags nobuffer -f mpegts -i udp://@:8554 -f rawvideo -pix_fmt bgr24 pipe:`
- Alternative: `open-gopro` SDK with `WirelessGoPro` class

### Installation
```bash
pip install open-gopro
```
- Requires Python >= 3.11, < 3.14
- Hero 12 supported via OGP API

## YOLOv8 Ball Detection

Sources:
- https://www.sciencedirect.com/science/article/abs/pii/S1568494624011037
- https://louis.uah.edu/cgi/viewcontent.cgi?article=1507&context=rceu-hcr
- https://link.springer.com/article/10.1007/s10791-025-09899-2

### Key findings
- YOLOv8n (nano) achieves real-time inference on CPU for ball detection
- Enhanced YOLOv8 + Kalman filter achieves mAP 0.91, recovery time 14.8ms
- Synthetic data viable for initial training; fine-tune with real data later
- Ball size in frame: 5-15px typical (640x640 input)
- Motion blur is main challenge — synthetic data should include it
- YOLOv8 better recall than YOLOv9 (prefer for tracking applications)

### Synthetic data approach
- Render table in perspective with random parameters
- Add ball at random positions with realistic size
- Apply motion blur, brightness variation, occlusion
- Label in YOLO format: class x_center y_center width height (normalized)
