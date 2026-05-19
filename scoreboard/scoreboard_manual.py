"""
scoreboard_manual.py — Scoreboard assistito con controllo manuale.

Sistema mostra video + tracking palla + tavolo, ma assegnazione punti è MANUALE.

Hotkey:
    A         → punto a Player A (sinistra)
    B         → punto a Player B (destra)
    L         → let (ripeti servizio)
    S         → cambia server manualmente
    SPACE     → pausa/play
    R         → reset rally (no punto, solo nuovo servizio)
    Q / ESC   → quit

Pannello informativo:
    - Score corrente
    - Server corrente
    - Eventi sospetti rilevati dal sistema (bounce, possibile OUT)
    - Suggerimento "punto probabile a X"

Uso:
    python3 scoreboard/scoreboard_manual.py --video scoreboard/openttgames/test_6.mp4
    python3 scoreboard/scoreboard_manual.py --live  # GoPro
"""

import argparse
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import cv2
import numpy as np
from ultralytics import YOLO

from scoreboard.tracker import BallTracker, BallEvent, TableGeometry
from scoreboard.match import Match, MatchConfig
from scoreboard.tests.test_practical import detect_table_blue

MODEL_PATH = Path(__file__).parent / "models" / "best.pt"


class ManualScoreboard:
    def __init__(self, video_path: Path = None, live: bool = False,
                 player_a: str = "Player A", player_b: str = "Player B",
                 best_of: int = 5):
        self.video_path = video_path
        self.live = live

        # Components
        self.model = YOLO(str(MODEL_PATH))
        self.tracker = BallTracker()
        self.match = Match(MatchConfig(
            best_of=best_of,
            player_a_name=player_a,
            player_b_name=player_b,
        ))
        self.table_geom: TableGeometry = None

        # State
        self.paused = False
        self.recent_events = []  # ring of recent ball events
        self.last_bounce_side = None
        self.frames_no_ball = 0
        self.point_suggestion = None  # ("A" or "B", reason)

    def _suggest_point(self, state, frame_n: int):
        """Heuristic: suggest who scored based on recent events."""
        # If ball is OUT and was last seen on side X, suggest opponent
        if state.event == BallEvent.OUT_OF_TABLE:
            loser = "A" if state.side == "left" else "B"
            winner = "B" if loser == "A" else "A"
            self.point_suggestion = (winner, f"OUT da lato {state.side}")
            return

        # If ball is invisible for many frames after rally, suggest point
        if self.frames_no_ball > 60 and self.last_bounce_side:
            loser = "A" if self.last_bounce_side == "left" else "B"
            winner = "B" if loser == "A" else "A"
            self.point_suggestion = (
                winner,
                f"Pallina persa, ultimo bounce {self.last_bounce_side}"
            )

    def _award_point(self, player: str):
        result = self.match.register_point(player)
        name = self.match.config.player_a_name if player == "A" else self.match.config.player_b_name
        print(f"\n🎯 PUNTO a {name}! Score: {result['score'][0]}-{result['score'][1]}")
        if result.get("game_won"):
            gw = result["game_winner"]
            gw_name = self.match.config.player_a_name if gw == "A" else self.match.config.player_b_name
            print(f"🏆 Set vinto da {gw_name}! Sets: {result['sets'][0]}-{result['sets'][1]}")
        if result.get("match_won"):
            print(f"🥇 PARTITA VINTA da {gw_name}!")

        self.point_suggestion = None
        self.frames_no_ball = 0
        self.recent_events.clear()
        self.tracker.reset()

    def _draw_overlay(self, frame: np.ndarray, state, ball_dets: list, frame_n: int):
        """Draw scoreboard overlay on frame."""
        H, W = frame.shape[:2]
        vis = frame.copy()

        # Table bbox
        if self.table_geom:
            cv2.rectangle(vis,
                          (int(self.table_geom.x_min), int(self.table_geom.y_min)),
                          (int(self.table_geom.x_max), int(self.table_geom.y_max)),
                          (0, 255, 0), 2)
            cv2.line(vis,
                     (int(self.table_geom.net_x), int(self.table_geom.y_min)),
                     (int(self.table_geom.net_x), int(self.table_geom.y_max)),
                     (255, 0, 255), 2)

        # Ball detections
        for bx, by, conf in ball_dets:
            cv2.circle(vis, (int(bx), int(by)), 12, (0, 255, 255), 2)
            cv2.putText(vis, f"{conf:.2f}", (int(bx) + 14, int(by)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)

        # Ball trajectory
        trajectory = self.tracker.trajectory
        for i in range(1, len(trajectory)):
            p1 = (int(trajectory[i - 1][0]), int(trajectory[i - 1][1]))
            p2 = (int(trajectory[i][0]), int(trajectory[i][1]))
            cv2.line(vis, p1, p2, (255, 255, 0), 1)

        # Score panel (top-left, large)
        panel_h = 140
        panel = np.zeros((panel_h, W, 3), dtype=np.uint8)

        score_text = f"{self.match.config.player_a_name}: {self.match.score_a}  -  {self.match.score_b} :{self.match.config.player_b_name}"
        cv2.putText(panel, score_text, (20, 50),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 2)

        sets_text = f"Sets: {self.match.sets_a}-{self.match.sets_b}  |  Server: {self.match.current_server}  |  Set {self.match.current_set}"
        cv2.putText(panel, sets_text, (20, 90),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200, 200, 200), 1)

        # Suggestion
        if self.point_suggestion:
            player, reason = self.point_suggestion
            name = self.match.config.player_a_name if player == "A" else self.match.config.player_b_name
            sug_text = f"SUGGERIMENTO: Punto a {name} ({reason}) — premi {player} per confermare"
            cv2.putText(panel, sug_text, (20, 125),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 1)

        # Stack panel above frame
        vis = np.vstack([panel, vis])

        # Hotkey hints (bottom)
        hints = "[A]=punto A  [B]=punto B  [L]=let  [S]=swap server  [SPACE]=pause  [R]=reset rally  [Q]=quit"
        cv2.putText(vis, hints, (10, vis.shape[0] - 15),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

        if self.paused:
            cv2.putText(vis, "PAUSA", (W // 2 - 80, vis.shape[0] // 2),
                        cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 0, 255), 4)

        return vis

    def _process_frame(self, frame: np.ndarray, frame_n: int):
        """Run detection + tracking on one frame."""
        # Update table geometry
        if self.table_geom is None or frame_n % 200 == 0:
            detected = detect_table_blue(frame)
            if detected:
                self.table_geom = detected
                self.tracker.update_table(self.table_geom)

        # YOLO inference
        results = self.model.predict(frame, conf=0.5, verbose=False, imgsz=1280)

        ball_dets_raw = []
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0].item())
                if cls_id != 0:
                    continue
                conf = float(box.conf[0].item())
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                w, h = x2 - x1, y2 - y1
                if 3 <= w <= 50 and 3 <= h <= 50:
                    ball_dets_raw.append((cx, cy, conf))

        # Single best detection
        ball_dets = []
        if ball_dets_raw:
            best = max(ball_dets_raw, key=lambda d: d[2])
            ball_dets = [best]
            self.frames_no_ball = 0
        else:
            self.frames_no_ball += 1

        # Update tracker
        state = self.tracker.update(ball_dets)

        # Track events for suggestion
        if state.event == BallEvent.BOUNCE:
            self.last_bounce_side = state.side
            self.recent_events.append(("bounce", state.side, frame_n))
        elif state.event == BallEvent.NET_TOUCH:
            self.recent_events.append(("net", None, frame_n))
        elif state.event == BallEvent.OUT_OF_TABLE:
            self.recent_events.append(("out", state.side, frame_n))

        self._suggest_point(state, frame_n)
        return state, ball_dets

    def run(self):
        if self.live:
            from scoreboard.stream import live_frames
            frame_iter = live_frames()
        else:
            cap = cv2.VideoCapture(str(self.video_path))
            if not cap.isOpened():
                print(f"❌ Cannot open {self.video_path}")
                return
            def file_iter():
                while True:
                    ok, f = cap.read()
                    if not ok:
                        break
                    yield f
                cap.release()
            frame_iter = file_iter()

        print("\n🏓 Scoreboard manuale avviato")
        print(f"   {self.match.config.player_a_name} vs {self.match.config.player_b_name}")
        print("   Hotkey: A=punto A  B=punto B  L=let  S=swap server  SPACE=pausa  Q=quit\n")

        cv2.namedWindow("Scoreboard manuale", cv2.WINDOW_NORMAL)
        cv2.resizeWindow("Scoreboard manuale", 1280, 800)

        frame_n = 0
        current_frame = None

        for frame in frame_iter:
            if self.match.is_match_over:
                print("🏁 Partita finita!")
                break

            if not self.paused:
                frame_n += 1
                state, ball_dets = self._process_frame(frame, frame_n)
                current_frame = self._draw_overlay(frame, state, ball_dets, frame_n)

            if current_frame is not None:
                cv2.imshow("Scoreboard manuale", current_frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord("q") or key == 27:  # q or ESC
                break
            elif key == ord("a"):
                self._award_point("A")
            elif key == ord("b"):
                self._award_point("B")
            elif key == ord("l"):
                print("🔄 Let — ripeti servizio")
                self.tracker.reset()
            elif key == ord("s"):
                new_server = "B" if self.match.current_server == "A" else "A"
                self.match.current_server = new_server
                print(f"🔁 Server: {new_server}")
            elif key == ord(" "):
                self.paused = not self.paused
                print("⏸️  PAUSA" if self.paused else "▶️  PLAY")
            elif key == ord("r"):
                print("🔄 Reset rally")
                self.tracker.reset()
                self.point_suggestion = None

        cv2.destroyAllWindows()

        print(f"\n📊 Risultato finale:")
        print(f"   {self.match.config.player_a_name}: {self.match.score_a}")
        print(f"   {self.match.config.player_b_name}: {self.match.score_b}")
        print(f"   Sets: {self.match.sets_a}-{self.match.sets_b}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=str, default=None)
    parser.add_argument("--live", action="store_true", help="Use GoPro live stream")
    parser.add_argument("--player-a", default="Mario")
    parser.add_argument("--player-b", default="Luigi")
    parser.add_argument("--best-of", type=int, default=5)
    parser.add_argument("--start-frame", type=int, default=0)
    args = parser.parse_args()

    if not args.video and not args.live:
        print("❌ Specifica --video <path> oppure --live")
        sys.exit(1)

    video = Path(args.video) if args.video else None
    if video and not video.exists():
        print(f"❌ Video non trovato: {video}")
        sys.exit(1)

    sb = ManualScoreboard(
        video_path=video,
        live=args.live,
        player_a=args.player_a,
        player_b=args.player_b,
        best_of=args.best_of,
    )

    # Skip frames if requested
    if args.start_frame > 0 and video:
        import cv2 as cv
        cap = cv.VideoCapture(str(video))
        cap.set(cv.CAP_PROP_POS_FRAMES, args.start_frame)
        # Replace frame iter logic — simpler: use cv2 directly
        cap.release()

    sb.run()


if __name__ == "__main__":
    main()
