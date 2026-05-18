"""
test_practical.py — Test pratico veloce della pipeline completa.

Genera un video che simula un rally con eventi specifici (servizio, rimbalzi, punto),
lancia la pipeline e mostra cosa rileva il modello in tempo reale.

Uso:
    python3 scoreboard/tests/test_practical.py
    python3 scoreboard/tests/test_practical.py --show  # mostra detection live
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import cv2
import numpy as np
from ultralytics import YOLO

from scoreboard.tracker import BallTracker, BallEvent, TableGeometry
from scoreboard.events import EventDetector, GameEvent
from scoreboard.match import Match, MatchConfig


VIDEO_PATH = Path(__file__).parent.parent / "test_data" / "rally_test.mp4"
MODEL_PATH = Path(__file__).parent.parent / "models" / "best.pt"


def generate_rally_video(output: Path, n_frames: int = 200, fps: int = 30):
    """Generate video with realistic rally: serve → bounce → bounce → out."""
    W, H = 640, 480
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(output), fourcc, fps, (W, H))

    # Table layout (matches synthetic training)
    table_x1, table_y1 = 80, 180
    table_x2, table_y2 = 560, 400
    net_x = (table_x1 + table_x2) // 2
    net_top_y = table_y1 - 20

    # Pre-computed trajectory: serve from left, bounce twice, then exit right
    trajectory = []

    # Phase 1: serve (frames 0-30): ball arcs from left up and to right
    for i in range(30):
        t = i / 30.0
        x = 130 + t * 60         # left side
        y = 250 - 60 * np.sin(np.pi * t) + 30 * t  # arc up and slight down
        trajectory.append((x, y))

    # Phase 2: first bounce on left side (frame 30): ball goes up then down
    for i in range(25):
        t = i / 25.0
        x = 190 + t * 100
        y = 350 - 80 * np.sin(np.pi * t)  # rises, then falls
        trajectory.append((x, y))

    # Phase 3: second bounce on right side (frames 55-90)
    for i in range(35):
        t = i / 35.0
        x = 290 + t * 180
        y = 350 - 70 * np.sin(np.pi * t)
        trajectory.append((x, y))

    # Phase 4: rally hit back, third bounce left
    for i in range(30):
        t = i / 30.0
        x = 470 - t * 250
        y = 350 - 60 * np.sin(np.pi * t)
        trajectory.append((x, y))

    # Phase 5: ball goes out (right edge, falling)
    for i in range(30):
        t = i / 30.0
        x = 220 + t * 400
        y = 290 + t * 200
        trajectory.append((x, y))

    # Pad to n_frames
    while len(trajectory) < n_frames:
        trajectory.append(trajectory[-1])

    for i, (bx, by) in enumerate(trajectory[:n_frames]):
        frame = np.full((H, W, 3), (60, 80, 60), dtype=np.uint8)  # green-ish background

        # Draw table (blue)
        cv2.rectangle(frame, (table_x1, table_y1), (table_x2, table_y2), (180, 100, 0), -1)
        cv2.rectangle(frame, (table_x1, table_y1), (table_x2, table_y2), (255, 255, 255), 2)
        # Center line
        cv2.line(frame, (table_x1, (table_y1 + table_y2) // 2),
                 (table_x2, (table_y1 + table_y2) // 2), (255, 255, 255), 1)

        # Draw net (dark vertical band)
        cv2.rectangle(frame, (net_x - 3, net_top_y), (net_x + 3, table_y2), (40, 40, 40), -1)

        # Draw ball (white circle)
        bx_i, by_i = int(bx), int(by)
        cv2.circle(frame, (bx_i, by_i), 7, (255, 255, 255), -1)
        cv2.circle(frame, (bx_i, by_i), 7, (200, 200, 200), 1)

        # Frame number
        cv2.putText(frame, f"frame:{i}", (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 1)

        writer.write(frame)

    writer.release()
    print(f"✅ Video generato: {output} ({n_frames} frame @ {fps}fps)")


def run_pipeline(video_path: Path, model_path: Path, show: bool = False):
    """Run full pipeline on a video file with verbose output."""
    print(f"\n🎬 Caricamento modello: {model_path}")
    model = YOLO(str(model_path))
    print(f"   Classi: {model.names}")

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"❌ Cannot open {video_path}")
        return

    tracker = BallTracker()
    detector = EventDetector(server="A")
    match = Match(MatchConfig(best_of=3, player_a_name="Mario", player_b_name="Luigi"))

    detector.start_serve()

    frame_n = 0
    detections_count = 0
    events_count = 0
    points_scored = 0
    start_time = time.time()
    latencies = []

    print("\n🏓 Avvio pipeline sul video...\n")

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame_n += 1

        t0 = time.time()

        # YOLO inference
        results = model.predict(frame, conf=0.25, verbose=False, imgsz=640)

        ball_dets = []
        table_bbox = None
        net_bbox = None
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0].item())
                conf = float(box.conf[0].item())
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                cx, cy = (x1 + x2) / 2, (y1 + y2) / 2

                if cls_id == 0:  # ball
                    ball_dets.append((cx, cy, conf))
                elif cls_id == 1:  # table
                    table_bbox = (x1, y1, x2, y2)
                elif cls_id == 2:  # net
                    net_bbox = (x1, y1, x2, y2)

        if ball_dets:
            detections_count += 1

        # Update table geometry
        if table_bbox:
            x1, y1, x2, y2 = table_bbox
            nx = (x1 + x2) / 2
            if net_bbox:
                nx = (net_bbox[0] + net_bbox[2]) / 2
            tracker.update_table(TableGeometry(x_min=x1, x_max=x2, y_min=y1, y_max=y2, net_x=nx))

        # Track ball
        state = tracker.update(ball_dets)

        latency_ms = (time.time() - t0) * 1000
        latencies.append(latency_ms)

        # Print state every 10 frames
        if frame_n % 10 == 0:
            print(f"  F{frame_n:3d} | balls={len(ball_dets)} table={'Y' if table_bbox else 'N'} "
                  f"net={'Y' if net_bbox else 'N'} | "
                  f"ball=({state.x:.0f},{state.y:.0f}) v=({state.vx:.1f},{state.vy:.1f}) "
                  f"side={state.side} ev={state.event.value} | {latency_ms:.0f}ms")

        # Process events
        event_result = None
        if state.event == BallEvent.BOUNCE:
            event_result = detector.on_bounce(state.side)
            events_count += 1
            print(f"  🏓 BOUNCE @ {state.side} (frame {frame_n})")
        elif state.event == BallEvent.NET_TOUCH:
            event_result = detector.on_net_touch()
            print(f"  🥅 NET TOUCH (frame {frame_n})")
        elif state.event == BallEvent.OUT_OF_TABLE:
            event_result = detector.on_ball_out(state.side)
            print(f"  ⛔ OUT (frame {frame_n}, last side={state.side})")

        if event_result and event_result.event == GameEvent.POINT_SCORED:
            r = match.register_point(event_result.player_scored)
            points_scored += 1
            name = "Mario" if event_result.player_scored == "A" else "Luigi"
            print(f"  🎯 PUNTO a {name}! Score: {r['score'][0]}-{r['score'][1]} ({event_result.detail})")
            detector.set_server(match.current_server)
            # Skip 30 frames before allowing next point (~1s @ 30fps)
            for _ in range(30):
                ok2, _ = cap.read()
                if not ok2:
                    break
                frame_n += 1
            if not match.is_match_over:
                detector.start_serve()

        # Optional: display frame with detections
        if show:
            vis = frame.copy()
            for bx, by, conf in ball_dets:
                cv2.circle(vis, (int(bx), int(by)), 10, (0, 255, 255), 2)
                cv2.putText(vis, f"{conf:.2f}", (int(bx) + 12, int(by)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1)
            if table_bbox:
                cv2.rectangle(vis, (int(table_bbox[0]), int(table_bbox[1])),
                              (int(table_bbox[2]), int(table_bbox[3])), (0, 255, 0), 2)
            if net_bbox:
                cv2.rectangle(vis, (int(net_bbox[0]), int(net_bbox[1])),
                              (int(net_bbox[2]), int(net_bbox[3])), (255, 0, 255), 2)
            cv2.imshow("Pipeline test", vis)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    if show:
        cv2.destroyAllWindows()

    elapsed = time.time() - start_time
    avg_lat = sum(latencies) / len(latencies) if latencies else 0
    max_lat = max(latencies) if latencies else 0
    fps_real = frame_n / elapsed if elapsed > 0 else 0

    print(f"\n{'=' * 60}")
    print(f"📊 Risultati:")
    print(f"  Frame processati  : {frame_n}")
    print(f"  Frame con ball    : {detections_count} ({100*detections_count/max(frame_n,1):.0f}%)")
    print(f"  Eventi rilevati   : {events_count}")
    print(f"  Punti segnati     : {points_scored}")
    print(f"  Score finale      : Mario {match.score_a} - {match.score_b} Luigi")
    print(f"  Latenza media     : {avg_lat:.1f}ms (max {max_lat:.1f}ms)")
    print(f"  FPS effettivi     : {fps_real:.1f}")
    print(f"  Target latenza    : {'✅ OK' if avg_lat < 500 else '❌ TROPPO ALTA'} (<500ms)")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--show", action="store_true", help="Display frames with detections")
    parser.add_argument("--regen", action="store_true", help="Force regenerate video")
    args = parser.parse_args()

    if not VIDEO_PATH.exists() or args.regen:
        VIDEO_PATH.parent.mkdir(parents=True, exist_ok=True)
        generate_rally_video(VIDEO_PATH)
    else:
        print(f"📹 Video esistente: {VIDEO_PATH}")

    if not MODEL_PATH.exists():
        print(f"❌ Modello non trovato: {MODEL_PATH}")
        sys.exit(1)

    run_pipeline(VIDEO_PATH, MODEL_PATH, show=args.show)
