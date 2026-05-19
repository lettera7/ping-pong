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


def calibrate_table_manual(frame: np.ndarray) -> TableGeometry:
    """
    Open window, ask user to click 4 corners of the table in order:
    1) TOP-LEFT  2) TOP-RIGHT  3) BOTTOM-RIGHT  4) BOTTOM-LEFT
    Returns TableGeometry with corners trapezoid set.
    """
    points = []
    H, W = frame.shape[:2]
    win = "Calibrazione: clicca 4 angoli del tavolo (TL, TR, BR, BL)"

    def on_click(event, x, y, flags, _):
        if event == cv2.EVENT_LBUTTONDOWN and len(points) < 4:
            points.append((x, y))

    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(win, 1280, 720)
    cv2.setMouseCallback(win, on_click)

    labels = ["TL (alto-sx)", "TR (alto-dx)", "BR (basso-dx)", "BL (basso-sx)"]
    while True:
        vis = frame.copy()
        for i, p in enumerate(points):
            cv2.circle(vis, p, 8, (0, 255, 0), -1)
            cv2.putText(vis, str(i + 1), (p[0] + 12, p[1]),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        if len(points) >= 2:
            pts = np.array(points + ([points[0]] if len(points) == 4 else []), np.int32)
            cv2.polylines(vis, [pts.reshape(-1, 1, 2)], False, (0, 255, 0), 2)
        if len(points) < 4:
            msg = f"Clicca: {labels[len(points)]}  ({len(points)}/4)"
            cv2.putText(vis, msg, (20, 50),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2)
        else:
            cv2.putText(vis, "OK premi ENTER (R=reset)",
                        (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)
        cv2.imshow(win, vis)
        k = cv2.waitKey(20) & 0xFF
        if k == 13 and len(points) == 4:  # ENTER
            break
        if k == ord("r"):
            points.clear()
        if k == 27:  # ESC
            cv2.destroyWindow(win)
            return None

    cv2.destroyWindow(win)
    corners = np.array(points, dtype=np.float32)
    x_min = float(corners[:, 0].min())
    x_max = float(corners[:, 0].max())
    y_min = float(corners[:, 1].min())
    y_max = float(corners[:, 1].max())
    top_mid_x = (corners[0, 0] + corners[1, 0]) / 2
    bot_mid_x = (corners[3, 0] + corners[2, 0]) / 2
    net_x = (top_mid_x + bot_mid_x) / 2
    geom = TableGeometry(
        x_min=x_min, x_max=x_max,
        y_min=y_min, y_max=y_max,
        net_x=net_x,
        net_y_top=y_min - 20,
        net_y_bottom=y_max,
    )
    geom.corners = corners  # type: ignore[attr-defined]
    return geom


def detect_table_blue(frame: np.ndarray):
    """
    Detect blue ping-pong table via HSV + shape filtering.
    Returns TableGeometry of best table candidate (lower-half trapezoid).
    """
    H, W = frame.shape[:2]
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

    # Tighter blue range for table (saturated, mid-bright); excludes dim background drapes
    lower = np.array([95, 130, 70])
    upper = np.array([125, 255, 220])
    mask = cv2.inRange(hsv, lower, upper)

    # Restrict search to lower 2/3 of frame (table is on floor, not on ceiling/back wall)
    roi_mask = np.zeros_like(mask)
    roi_mask[int(H * 0.35):, :] = 255
    mask = cv2.bitwise_and(mask, roi_mask)

    # Clean up
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    # Pick largest blob in lower half
    biggest = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(biggest)
    if area < (W * H * 0.03):
        return None

    # Approximate to polygon — table seen in perspective ~ trapezoid (4 vertices)
    epsilon = 0.02 * cv2.arcLength(biggest, True)
    approx = cv2.approxPolyDP(biggest, epsilon, True)

    # Extract corners
    pts = approx.reshape(-1, 2)
    if len(pts) >= 4:
        # Pick 4 extreme corners: top-left, top-right, bottom-right, bottom-left
        center = pts.mean(axis=0)
        # Sort by angle from center
        angles = np.arctan2(pts[:, 1] - center[1], pts[:, 0] - center[0])
        sorted_pts = pts[np.argsort(angles)]
        # We want TL, TR, BR, BL — start from top-most
        top_two_idx = np.argsort(pts[:, 1])[:2]
        bot_two_idx = np.argsort(pts[:, 1])[-2:]
        tl, tr = sorted(pts[top_two_idx], key=lambda p: p[0])
        bl, br = sorted(pts[bot_two_idx], key=lambda p: p[0])
        corners = np.array([tl, tr, br, bl], dtype=np.float32)
    else:
        # Fallback to bounding rect corners
        x, y, w, h = cv2.boundingRect(biggest)
        corners = np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], dtype=np.float32)

    # Build TableGeometry from trapezoid extents
    x_min = float(corners[:, 0].min())
    x_max = float(corners[:, 0].max())
    y_min = float(corners[:, 1].min())
    y_max = float(corners[:, 1].max())

    # Net is at the horizontal middle of the trapezoid, projected at mid-Y
    mid_y = (y_min + y_max) / 2
    # Net x = average of midpoints of top edge and bottom edge
    top_mid_x = (corners[0, 0] + corners[1, 0]) / 2  # TL + TR
    bot_mid_x = (corners[3, 0] + corners[2, 0]) / 2  # BL + BR
    net_x = (top_mid_x + bot_mid_x) / 2

    geom = TableGeometry(
        x_min=x_min, x_max=x_max,
        y_min=y_min, y_max=y_max,
        net_x=net_x,
        net_y_top=y_min - 20,
        net_y_bottom=y_max,
    )
    geom.corners = corners  # type: ignore[attr-defined]
    return geom


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


def run_pipeline(video_path: Path, model_path: Path, show: bool = False, max_frames: int = 0,
                 start_frame: int = 0, manual_geom: TableGeometry = None):
    """Run full pipeline on a video file with verbose output."""
    print(f"\n🎬 Caricamento modello: {model_path}")
    model = YOLO(str(model_path))
    print(f"   Classi: {model.names}")

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"❌ Cannot open {video_path}")
        return

    if start_frame > 0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        print(f"⏩ Skip a frame {start_frame}")

    tracker = BallTracker()
    detector = EventDetector(server="A")
    match = Match(MatchConfig(best_of=3, player_a_name="Mario", player_b_name="Luigi"))
    table_geom = manual_geom  # use manual calibration if provided
    if table_geom:
        tracker.update_table(table_geom)
        print(f"📐 Geometria tavolo: x[{table_geom.x_min:.0f}-{table_geom.x_max:.0f}] "
              f"y[{table_geom.y_min:.0f}-{table_geom.y_max:.0f}] net_x={table_geom.net_x:.0f}")

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
        if max_frames and frame_n > max_frames:
            break

        t0 = time.time()

        # Detect table once (skip if manually calibrated)
        if manual_geom is None and (table_geom is None or frame_n % 200 == 0):
            detected = detect_table_blue(frame)
            if detected:
                table_geom = detected
                tracker.update_table(table_geom)

        # YOLO inference (higher conf to filter false positives, imgsz=1280 matches training)
        results = model.predict(frame, conf=0.6, verbose=False, imgsz=1280)

        ball_dets_raw = []
        table_bbox = None
        net_bbox = None
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0].item())
                conf = float(box.conf[0].item())
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                w, h = x2 - x1, y2 - y1

                if cls_id == 0:  # ball
                    ball_dets_raw.append((cx, cy, conf, w, h))
                elif cls_id == 1:
                    table_bbox = (x1, y1, x2, y2)
                elif cls_id == 2:
                    net_bbox = (x1, y1, x2, y2)

        # Filter: realistic ball size (5-30 px) and not static "ghost" detections
        # Track moving detections only — keep top-confidence single ball
        ball_dets = []
        if ball_dets_raw:
            # Filter by size
            ball_dets_raw = [d for d in ball_dets_raw if 3 <= d[3] <= 40 and 3 <= d[4] <= 40]
            if ball_dets_raw:
                best = max(ball_dets_raw, key=lambda d: d[2])
                ball_dets = [(best[0], best[1], best[2])]

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
            # Skip 240 frames before allowing next point (~2s @ 120fps)
            for _ in range(240):
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
            if table_geom:
                corners = getattr(table_geom, "corners", None)
                if corners is not None:
                    pts = corners.astype(int).reshape(-1, 1, 2)
                    cv2.polylines(vis, [pts], isClosed=True, color=(0, 255, 0), thickness=2)
                    # Draw net line between midpoint of top edge and midpoint of bottom edge
                    top_mid = ((corners[0] + corners[1]) / 2).astype(int)
                    bot_mid = ((corners[3] + corners[2]) / 2).astype(int)
                    cv2.line(vis, tuple(top_mid), tuple(bot_mid), (255, 0, 255), 2)
                else:
                    cv2.rectangle(vis,
                                  (int(table_geom.x_min), int(table_geom.y_min)),
                                  (int(table_geom.x_max), int(table_geom.y_max)),
                                  (0, 255, 0), 2)
                    cv2.line(vis,
                             (int(table_geom.net_x), int(table_geom.y_min)),
                             (int(table_geom.net_x), int(table_geom.y_max)),
                             (255, 0, 255), 2)
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
    parser.add_argument("--regen", action="store_true", help="Force regenerate synthetic video")
    parser.add_argument("--video", type=str, default=None, help="Path to custom video file")
    parser.add_argument("--max-frames", type=int, default=0, help="Stop after N frames (0=all)")
    parser.add_argument("--start-frame", type=int, default=0, help="Skip first N frames")
    parser.add_argument("--calibrate", action="store_true",
                        help="Manual table calibration by clicking 4 corners")
    args = parser.parse_args()

    if args.video:
        video = Path(args.video)
        if not video.exists():
            print(f"❌ Video non trovato: {video}")
            sys.exit(1)
        print(f"📹 Video custom: {video}")
    else:
        if not VIDEO_PATH.exists() or args.regen:
            VIDEO_PATH.parent.mkdir(parents=True, exist_ok=True)
            generate_rally_video(VIDEO_PATH)
        else:
            print(f"📹 Video esistente: {VIDEO_PATH}")
        video = VIDEO_PATH

    if not MODEL_PATH.exists():
        print(f"❌ Modello non trovato: {MODEL_PATH}")
        sys.exit(1)

    manual_geom = None
    if args.calibrate:
        cap_tmp = cv2.VideoCapture(str(video))
        if args.start_frame > 0:
            cap_tmp.set(cv2.CAP_PROP_POS_FRAMES, args.start_frame)
        ok, sample = cap_tmp.read()
        cap_tmp.release()
        if not ok:
            print("❌ Impossibile leggere frame per calibrazione")
            sys.exit(1)
        print("\n🎯 Calibrazione manuale tavolo — clicca 4 angoli in ordine TL, TR, BR, BL")
        manual_geom = calibrate_table_manual(sample)
        if manual_geom is None:
            print("❌ Calibrazione annullata")
            sys.exit(1)
        print("✅ Tavolo calibrato")

    run_pipeline(video, MODEL_PATH, show=args.show, max_frames=args.max_frames,
                 start_frame=args.start_frame, manual_geom=manual_geom)
