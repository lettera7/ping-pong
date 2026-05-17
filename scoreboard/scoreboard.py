"""
scoreboard.py — GoPro Live → YOLOv8 → Ball Tracker → Events → Score → API

Pipeline multi-agent con queue.Queue per backpressure.
Agents:
  StreamAgent     : cattura frame dal live stream GoPro (o mock)
  DetectionAgent  : YOLOv8 inference per ball/table/net detection
  TrackerAgent    : Kalman filter ball tracking + event detection
  EventAgent      : FSM per regole ITTF
  MatchAgent      : gestione punteggio + invio API
"""

import datetime
import logging
import os
import queue
import sys
import threading
import time
from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import httpx
import numpy as np
from dotenv import load_dotenv
from ultralytics import YOLO

from scoreboard.tracker import BallTracker, BallEvent, BallState, TableGeometry
from scoreboard.events import EventDetector, GameEvent, EventResult
from scoreboard.match import Match, MatchConfig
from scoreboard.stream import live_frames

load_dotenv()

# Configuration
API_URL: str = os.getenv("API_URL", "").rstrip("/")
API_SECRET: str = os.getenv("API_SECRET", "")
PLAYER_A: str = os.getenv("PLAYER_A", "Player A")
PLAYER_B: str = os.getenv("PLAYER_B", "Player B")
YOLO_MODEL_PATH: str = os.getenv("YOLO_MODEL_PATH", "scoreboard/models/best.pt")
YOLO_CONF_THRESH: float = float(os.getenv("YOLO_CONF_THRESH", "0.4"))
DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"
BEST_OF: int = int(os.getenv("BEST_OF", "5"))

log = logging.getLogger("scoreboard")


@dataclass
class FrameData:
    frame: np.ndarray
    timestamp: float


@dataclass
class DetectionData:
    ball_detections: List[Tuple[float, float, float]]  # (x, y, conf)
    table_bbox: Optional[Tuple[float, float, float, float]] = None
    net_bbox: Optional[Tuple[float, float, float, float]] = None
    timestamp: float = 0.0


class StreamAgent(threading.Thread):
    """Captures frames from GoPro or mock video."""

    def __init__(self, out_queue: queue.Queue):
        super().__init__(name="StreamAgent", daemon=True)
        self.out_queue = out_queue
        self.stop_event = threading.Event()
        self._frame_count = 0

    def run(self):
        log.info("📡 StreamAgent: avvio cattura frame")
        try:
            for frame in live_frames():
                if self.stop_event.is_set():
                    break

                data = FrameData(frame=frame, timestamp=time.time())

                if self.out_queue.full():
                    try:
                        self.out_queue.get_nowait()
                    except queue.Empty:
                        pass
                self.out_queue.put_nowait(data)
                self._frame_count += 1

                if self._frame_count % 100 == 0:
                    log.debug(f"StreamAgent: {self._frame_count} frame catturati")

        except Exception as e:
            log.error(f"StreamAgent: errore — {e}")
        log.info("StreamAgent: fermato")


class DetectionAgent(threading.Thread):
    """Runs YOLOv8 inference for ball/table/net detection."""

    CLASS_BALL = 0
    CLASS_TABLE = 1
    CLASS_NET = 2

    def __init__(self, in_queue: queue.Queue, out_queue: queue.Queue):
        super().__init__(name="DetectionAgent", daemon=True)
        self.in_queue = in_queue
        self.out_queue = out_queue
        self.stop_event = threading.Event()

        if os.path.isfile(YOLO_MODEL_PATH):
            self.model = YOLO(YOLO_MODEL_PATH)
            log.info(f"🔍 DetectionAgent: modello caricato da {YOLO_MODEL_PATH}")
        else:
            self.model = YOLO("yolov8n.pt")
            log.warning(f"DetectionAgent: {YOLO_MODEL_PATH} non trovato, uso yolov8n.pt generico")

    def run(self):
        log.info("🔍 DetectionAgent: avvio inference")
        while not self.stop_event.is_set():
            try:
                frame_data: FrameData = self.in_queue.get(timeout=1)
            except queue.Empty:
                continue

            try:
                results = self.model.predict(
                    frame_data.frame,
                    conf=YOLO_CONF_THRESH,
                    verbose=False,
                    imgsz=640,
                )

                det = DetectionData(
                    ball_detections=[],
                    timestamp=frame_data.timestamp,
                )

                for result in results:
                    for box in result.boxes:
                        cls_id = int(box.cls[0])
                        conf = float(box.conf[0])
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        cx = (x1 + x2) / 2
                        cy = (y1 + y2) / 2

                        if cls_id == self.CLASS_BALL:
                            det.ball_detections.append((cx, cy, conf))
                        elif cls_id == self.CLASS_TABLE:
                            det.table_bbox = (x1, y1, x2, y2)
                        elif cls_id == self.CLASS_NET:
                            det.net_bbox = (x1, y1, x2, y2)

                if self.out_queue.full():
                    try:
                        self.out_queue.get_nowait()
                    except queue.Empty:
                        pass
                self.out_queue.put_nowait(det)

            except Exception as e:
                log.warning(f"DetectionAgent: errore inference — {e}")

        log.info("DetectionAgent: fermato")


class TrackerAgent(threading.Thread):
    """Ball tracking with Kalman filter + event detection."""

    def __init__(self, in_queue: queue.Queue, out_queue: queue.Queue):
        super().__init__(name="TrackerAgent", daemon=True)
        self.in_queue = in_queue
        self.out_queue = out_queue
        self.stop_event = threading.Event()
        self.tracker = BallTracker()

    def run(self):
        log.info("🎯 TrackerAgent: avvio tracking")
        while not self.stop_event.is_set():
            try:
                det: DetectionData = self.in_queue.get(timeout=1)
            except queue.Empty:
                continue

            try:
                # Update table geometry if detected
                if det.table_bbox:
                    x1, y1, x2, y2 = det.table_bbox
                    net_x = (x1 + x2) / 2
                    if det.net_bbox:
                        nx1, _, nx2, _ = det.net_bbox
                        net_x = (nx1 + nx2) / 2

                    self.tracker.update_table(TableGeometry(
                        x_min=x1, x_max=x2,
                        y_min=y1, y_max=y2,
                        net_x=net_x,
                    ))

                # Update tracker
                state = self.tracker.update(det.ball_detections)

                if self.out_queue.full():
                    try:
                        self.out_queue.get_nowait()
                    except queue.Empty:
                        pass
                self.out_queue.put_nowait(state)

                if state.event != BallEvent.NONE and DEBUG:
                    log.debug(f"TrackerAgent: evento {state.event.value} @ ({state.x:.0f}, {state.y:.0f})")

            except Exception as e:
                log.warning(f"TrackerAgent: errore — {e}")

        log.info("TrackerAgent: fermato")


class EventMatchAgent(threading.Thread):
    """Combines event detection FSM and match scoring. Posts to API."""

    def __init__(self, in_queue: queue.Queue):
        super().__init__(name="EventMatchAgent", daemon=True)
        self.in_queue = in_queue
        self.stop_event = threading.Event()

        self.match = Match(MatchConfig(
            best_of=BEST_OF,
            player_a_name=PLAYER_A,
            player_b_name=PLAYER_B,
            first_server="A",
        ))
        self.event_detector = EventDetector(server="A")
        self._serve_started = False
        self._frames_since_bounce = 0
        self._last_post_time = 0.0

    def run(self):
        log.info("🏓 EventMatchAgent: avvio gestione partita")
        log.info(f"   {PLAYER_A} vs {PLAYER_B} — best of {BEST_OF}")

        # Auto-start first serve
        self.event_detector.start_serve()
        self._serve_started = True

        while not self.stop_event.is_set():
            try:
                state: BallState = self.in_queue.get(timeout=1)
            except queue.Empty:
                continue

            try:
                event_result = None

                if state.event == BallEvent.BOUNCE:
                    event_result = self.event_detector.on_bounce(state.side)
                elif state.event == BallEvent.NET_TOUCH:
                    event_result = self.event_detector.on_net_touch()
                elif state.event == BallEvent.OUT_OF_TABLE:
                    event_result = self.event_detector.on_ball_out(state.side)

                if event_result and event_result.event == GameEvent.POINT_SCORED:
                    match_result = self.match.register_point(event_result.player_scored)
                    self._log_point(event_result, match_result)
                    self._post_score()

                    # Update server in event detector
                    self.event_detector.set_server(self.match.current_server)

                    # Start next serve
                    if not self.match.is_match_over:
                        self.event_detector.start_serve()

                elif event_result and event_result.event == GameEvent.SERVE_LET:
                    log.info("🔄 Let — si ripete il servizio")
                    self.event_detector.start_serve()

            except Exception as e:
                log.warning(f"EventMatchAgent: errore — {e}")

        log.info("EventMatchAgent: fermato")

    def _log_point(self, event: EventResult, match_result: dict):
        winner = event.player_scored
        name = PLAYER_A if winner == "A" else PLAYER_B
        score = match_result["score"]
        sets = match_result["sets"]

        log.info(
            f"🎯 PUNTO a {name}! "
            f"Score: {score[0]}-{score[1]} | "
            f"Set: {sets[0]}-{sets[1]} | "
            f"{event.detail}"
        )

        if match_result.get("game_won"):
            gw = match_result["game_winner"]
            gw_name = PLAYER_A if gw == "A" else PLAYER_B
            log.info(f"🏆 Set vinto da {gw_name}! Sets: {sets[0]}-{sets[1]}")

        if match_result.get("match_won"):
            mw = match_result["match_winner"]
            mw_name = PLAYER_A if mw == "A" else PLAYER_B
            log.info(f"🥇 PARTITA VINTA da {mw_name}!")

    def _post_score(self):
        if not API_URL:
            return

        now = time.time()
        if now - self._last_post_time < 1.0:
            return

        payload = {
            "player_a": PLAYER_A,
            "player_b": PLAYER_B,
            "score_a": self.match.score_a,
            "score_b": self.match.score_b,
            "sets_a": self.match.sets_a,
            "sets_b": self.match.sets_b,
            "current_server": self.match.current_server,
            "current_set": self.match.current_set,
            "played_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

        headers = {}
        if API_SECRET:
            headers["Authorization"] = f"Bearer {API_SECRET}"

        try:
            resp = httpx.post(
                f"{API_URL}/api/score",
                json=payload,
                headers=headers,
                timeout=5,
            )
            if resp.is_success:
                log.debug(f"API: score inviato → {resp.status_code}")
            else:
                log.warning(f"API: errore {resp.status_code}")
            self._last_post_time = now
        except httpx.RequestError as e:
            log.warning(f"API: errore connessione — {e}")


def main():
    logging.basicConfig(
        level=logging.DEBUG if DEBUG else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        stream=sys.stdout,
    )

    log.info("=" * 60)
    log.info("🏓 GoPro Live Scoreboard — Avvio sistema")
    log.info("=" * 60)
    log.info(f"  Giocatori : {PLAYER_A} vs {PLAYER_B}")
    log.info(f"  Modello   : {YOLO_MODEL_PATH}")
    log.info(f"  API       : {API_URL or '(non configurato)'}")
    log.info(f"  Best of   : {BEST_OF}")
    log.info(f"  Debug     : {DEBUG}")
    log.info("=" * 60)

    # Queues with backpressure
    frame_q = queue.Queue(maxsize=4)
    detection_q = queue.Queue(maxsize=8)
    tracker_q = queue.Queue(maxsize=16)

    # Create agents
    stream_agent = StreamAgent(out_queue=frame_q)
    detection_agent = DetectionAgent(in_queue=frame_q, out_queue=detection_q)
    tracker_agent = TrackerAgent(in_queue=detection_q, out_queue=tracker_q)
    event_match_agent = EventMatchAgent(in_queue=tracker_q)

    agents = [stream_agent, detection_agent, tracker_agent, event_match_agent]

    for agent in agents:
        agent.start()
        log.info(f"  ✓ {agent.name} avviato")

    try:
        while True:
            time.sleep(1)
            if event_match_agent.match.is_match_over:
                log.info("🏁 Partita terminata!")
                break
    except KeyboardInterrupt:
        log.info("\n⏹️  Arresto sistema (Ctrl+C)")

    for agent in agents:
        agent.stop_event.set()

    time.sleep(1)
    log.info("👋 Sistema terminato")


if __name__ == "__main__":
    main()
