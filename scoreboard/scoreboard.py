"""
scoreboard.py — GoPro RTSP → YOLOv8 → EasyOCR → POST /api/score
Multi-agent ping-pong scoreboard tracker.

Agents
------
FrameAgent      : captures frames from the GoPro RTSP stream
DetectionAgent  : detects the scoreboard ROI with YOLOv8, OCRs digit pairs
ScoreAgent      : debounces readings and POSTs confirmed scores to the API
"""

import datetime
import logging
import os
import queue
import re
import sys
import threading
import time
from typing import Optional, Tuple

import cv2
import httpx
import easyocr
from dotenv import load_dotenv
from ultralytics import YOLO

load_dotenv()

# ── Configuration ─────────────────────────────────────────────────────────────

GOPRO_RTSP_URL: str = os.getenv("GOPRO_RTSP_URL", "rtsp://10.5.5.9:8554/live")
GOPRO_FPS_LIMIT: float = float(os.getenv("GOPRO_FPS_LIMIT", "2"))
YOLO_MODEL_PATH: str = os.getenv("YOLO_MODEL_PATH", "scoreboard/best.pt")
YOLO_CONF_THRESH: float = float(os.getenv("YOLO_CONF_THRESH", "0.6"))
API_URL: str = os.getenv("API_URL", "").rstrip("/")
API_SECRET: str = os.getenv("API_SECRET", "")
PLAYER_A: str = os.getenv("PLAYER_A", "Player A")
PLAYER_B: str = os.getenv("PLAYER_B", "Player B")
DEBOUNCE_FRAMES: int = int(os.getenv("DEBOUNCE_FRAMES", "5"))
SCORE_RESET_THRESHOLD: int = int(os.getenv("SCORE_RESET_THRESHOLD", "3"))

log = logging.getLogger(__name__)

# ── Agents ────────────────────────────────────────────────────────────────────


class FrameAgent(threading.Thread):
    """Captures frames from a GoPro RTSP stream and forwards them to a queue."""

    def __init__(self, out_queue: "queue.Queue[cv2.typing.MatLike]") -> None:
        super().__init__(name="FrameAgent", daemon=True)
        self.out_queue = out_queue
        self.stop_event = threading.Event()

    def _open_capture(self) -> cv2.VideoCapture:
        cap = cv2.VideoCapture(GOPRO_RTSP_URL, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            log.warning("FrameAgent: could not open RTSP stream: %s", GOPRO_RTSP_URL)
        return cap

    def run(self) -> None:
        log.info("FrameAgent: starting — %s @ %.1f fps max", GOPRO_RTSP_URL, GOPRO_FPS_LIMIT)
        cap = self._open_capture()
        frame_interval = 1.0 / max(GOPRO_FPS_LIMIT, 0.1)

        while not self.stop_event.is_set():
            t0 = time.monotonic()
            try:
                ok, frame = cap.read()
                if not ok or frame is None:
                    log.warning("FrameAgent: read failed — reopening stream in 5 s")
                    cap.release()
                    time.sleep(5)
                    cap = self._open_capture()
                    continue

                # Non-blocking put: drop oldest frame if queue is full
                if self.out_queue.full():
                    try:
                        self.out_queue.get_nowait()
                    except queue.Empty:
                        pass
                self.out_queue.put_nowait(frame)

            except Exception as exc:  # noqa: BLE001
                log.warning("FrameAgent: unexpected error: %s", exc)

            elapsed = time.monotonic() - t0
            time.sleep(max(0.0, frame_interval - elapsed))

        cap.release()
        log.info("FrameAgent: stopped")


class DetectionAgent(threading.Thread):
    """Runs YOLOv8 on frames, crops the scoreboard ROI, OCRs digit pairs."""

    def __init__(
        self,
        in_queue: "queue.Queue[cv2.typing.MatLike]",
        out_queue: "queue.Queue[Tuple[int, int, datetime.datetime]]",
    ) -> None:
        super().__init__(name="DetectionAgent", daemon=True)
        self.in_queue = in_queue
        self.out_queue = out_queue
        self.stop_event = threading.Event()

        # Load YOLOv8 model — fall back to nano weights if custom file missing
        if os.path.isfile(YOLO_MODEL_PATH):
            self.model = YOLO(YOLO_MODEL_PATH)
            log.info("DetectionAgent: loaded model from %s", YOLO_MODEL_PATH)
        else:
            log.warning(
                "DetectionAgent: %s not found — falling back to yolov8n.pt (auto-download)",
                YOLO_MODEL_PATH,
            )
            self.model = YOLO("yolov8n.pt")

        # Instantiate EasyOCR reader once (expensive init)
        log.info("DetectionAgent: initialising EasyOCR reader…")
        self.reader = easyocr.Reader(["en"], gpu=False)
        log.info("DetectionAgent: EasyOCR ready")

    @staticmethod
    def _parse_two_ints(ocr_results: list) -> Optional[Tuple[int, int]]:
        """Extract the first two non-negative integers, sorted left-to-right by x-coordinate."""
        candidates: list[Tuple[float, int]] = []
        for bbox, text, _ in ocr_results:
            # bbox: [[x1,y1],[x2,y1],[x2,y2],[x1,y2]]
            x_center = (bbox[0][0] + bbox[2][0]) / 2
            for match in re.findall(r"\b\d+\b", text):
                candidates.append((x_center, int(match)))
        candidates.sort(key=lambda c: c[0])
        if len(candidates) >= 2:
            return candidates[0][1], candidates[1][1]
        return None

    def run(self) -> None:
        log.info("DetectionAgent: starting")
        while not self.stop_event.is_set():
            try:
                frame = self.in_queue.get(timeout=1)
            except queue.Empty:
                continue

            try:
                results = self.model.predict(frame, conf=YOLO_CONF_THRESH, verbose=False)

                best_box = None
                best_conf: float = -1.0
                for result in results:
                    for box in result.boxes:
                        cls_id = int(box.cls[0])
                        class_name: str = result.names.get(cls_id, "")
                        if "scoreboard" not in class_name.lower():
                            continue
                        conf = float(box.conf[0])
                        if conf > best_conf:
                            best_conf = conf
                            best_box = box

                if best_box is None:
                    log.debug("DetectionAgent: no scoreboard detected in frame")
                    continue

                x1, y1, x2, y2 = (int(v) for v in best_box.xyxy[0])
                roi = frame[y1:y2, x1:x2]
                if roi.size == 0:
                    log.debug("DetectionAgent: empty ROI — skipping")
                    continue

                roi_resized = cv2.resize(roi, (320, 160))
                ocr_results = self.reader.readtext(roi_resized)

                parsed = self._parse_two_ints(ocr_results)
                if parsed is None:
                    log.debug("DetectionAgent: could not parse two integers from OCR output")
                    continue

                score_a, score_b = parsed
                ts = datetime.datetime.utcnow()
                log.debug("DetectionAgent: detected score %d – %d", score_a, score_b)

                if self.out_queue.full():
                    try:
                        self.out_queue.get_nowait()
                    except queue.Empty:
                        pass
                self.out_queue.put_nowait((score_a, score_b, ts))

            except Exception as exc:  # noqa: BLE001
                log.warning("DetectionAgent: error processing frame: %s", exc)

        log.info("DetectionAgent: stopped")


class ScoreAgent(threading.Thread):
    """Debounces and deduplicates score readings, then POSTs confirmed scores."""

    def __init__(
        self, in_queue: "queue.Queue[Tuple[int, int, datetime.datetime]]"
    ) -> None:
        super().__init__(name="ScoreAgent", daemon=True)
        self.in_queue = in_queue
        self.stop_event = threading.Event()

        self.last_posted: Optional[Tuple[int, int]] = None
        self.candidate: Optional[Tuple[int, int]] = None
        self.candidate_count: int = 0

    def _post_score(self, score_a: int, score_b: int, ts: datetime.datetime) -> bool:
        """POST a confirmed score to the API. Returns True on success."""
        if not API_URL:
            log.error("ScoreAgent: API_URL is not set — cannot POST score")
            return False

        payload = {
            "player_a": PLAYER_A,
            "player_b": PLAYER_B,
            "score_a": score_a,
            "score_b": score_b,
            "played_at": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        headers: dict[str, str] = {}
        if API_SECRET:
            headers["Authorization"] = f"Bearer {API_SECRET}"

        try:
            response = httpx.post(
                f"{API_URL}/api/score",
                json=payload,
                headers=headers,
                timeout=10,
            )
            if response.is_success:
                log.info(
                    "ScoreAgent: posted score %d–%d → %s",
                    score_a, score_b, response.status_code,
                )
                return True
            else:
                log.warning(
                    "ScoreAgent: POST failed — status %s body: %s",
                    response.status_code,
                    response.text[:200],
                )
                return False
        except httpx.RequestError as exc:
            log.warning("ScoreAgent: request error: %s", exc)
            return False

    def run(self) -> None:
        log.info("ScoreAgent: starting (debounce=%d frames)", DEBOUNCE_FRAMES)
        while not self.stop_event.is_set():
            try:
                score_a, score_b, ts = self.in_queue.get(timeout=1)
            except queue.Empty:
                continue

            try:
                current = (score_a, score_b)

                # Game-reset detection: (0, 0) always resets last_posted
                if score_a == 0 and score_b == 0:
                    if self.last_posted != (0, 0):
                        log.info("ScoreAgent: game reset detected — clearing last_posted")
                        self.last_posted = None

                # Debounce
                if current == self.candidate:
                    self.candidate_count += 1
                else:
                    self.candidate = current
                    self.candidate_count = 1

                if self.candidate_count >= DEBOUNCE_FRAMES and current != self.last_posted:
                    success = self._post_score(score_a, score_b, ts)
                    if success:
                        self.last_posted = current
                        self.candidate_count = 0  # reset after acceptance

            except Exception as exc:  # noqa: BLE001
                log.warning("ScoreAgent: error handling score: %s", exc)

        log.info("ScoreAgent: stopped")


# ── Entry point ───────────────────────────────────────────────────────────────


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        stream=sys.stdout,
    )

    if not API_URL:
        log.error("API_URL environment variable is required. Set it in .env or the shell.")
        sys.exit(1)

    log.info("Starting GoPro Scoreboard pipeline…")
    log.info("  Stream  : %s", GOPRO_RTSP_URL)
    log.info("  API     : %s", API_URL)
    log.info("  Players : %s vs %s", PLAYER_A, PLAYER_B)

    frame_q: "queue.Queue[cv2.typing.MatLike]" = queue.Queue(maxsize=4)
    detection_q: "queue.Queue[Tuple[int, int, datetime.datetime]]" = queue.Queue(maxsize=16)

    frame_agent = FrameAgent(out_queue=frame_q)
    detection_agent = DetectionAgent(in_queue=frame_q, out_queue=detection_q)
    score_agent = ScoreAgent(in_queue=detection_q)

    for agent in (frame_agent, detection_agent, score_agent):
        agent.daemon = True
        agent.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("Shutting down… (Ctrl-C received)")
        sys.exit(0)


if __name__ == "__main__":
    main()
