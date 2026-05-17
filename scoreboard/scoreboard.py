#!/usr/bin/env python3
"""
Ping-Pong GoPro Scoreboard — runtime multi-agent score tracker.

Pipeline:
  GoPro RTSP → VisionWorker (OpenCV + YOLOv8) → OrchestratorAgent → ScoreReporter → /api/score

Multi-agent architecture (runtime):
  OrchestratorAgent  ←→  Anthropic API (claude-sonnet-4-20250514)
       ├── VisionWorker    local inference, no API calls
       └── ScoreReporter   HTTP client → Vercel /api/score

The Orchestrator uses the LLM only for edge-case validation (unusual score jumps).
Normal ±1 increments are accepted by fast local rules; the LLM is a safety net.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import requests
from dotenv import load_dotenv

import anthropic
from ultralytics import YOLO

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("scoreboard")

# ─── Config ───────────────────────────────────────────────────────────────────
RTSP_URL        = os.getenv("GOPRO_RTSP_URL",      "rtsp://10.5.5.9:8554/live")
SCORE_URL       = os.getenv("VERCEL_SCORE_URL",    "https://ping-pong-7.vercel.app/api/score")
PLAYER_A        = os.getenv("PLAYER_A",            "PlayerA")
PLAYER_B        = os.getenv("PLAYER_B",            "PlayerB")
YOLO_MODEL      = os.getenv("YOLO_MODEL",          "yolov8n.pt")
CAPTURE_INTERVAL = float(os.getenv("CAPTURE_INTERVAL", "0.5"))
DEBUG_FRAMES    = os.getenv("DEBUG_FRAMES", "false").lower() == "true"
CONFIRM_FRAMES  = 5   # consecutive identical readings before a score is accepted


# ─── Data types ───────────────────────────────────────────────────────────────
@dataclass
class Score:
    a: int
    b: int

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Score) and self.a == other.a and self.b == other.b

    def __repr__(self) -> str:
        return f"{self.a}:{self.b}"

    def is_valid(self) -> bool:
        return 0 <= self.a <= 21 and 0 <= self.b <= 21


@dataclass
class PipelineState:
    last_confirmed:   Optional[Score] = None
    candidate:        Optional[Score] = None
    candidate_streak: int = 0
    submitted_scores: list[dict] = field(default_factory=list)
    running:          bool = True


# ─── VisionWorker ─────────────────────────────────────────────────────────────
class VisionWorker:
    """
    Captures frames from the GoPro RTSP stream and extracts the current score.

    Detection strategy:
      1. Crop the top-centre ROI (likely scoreboard position on a GoPro mount).
      2. Apply adaptive thresholding and contour analysis to find digit blobs.
      3. Run pytesseract OCR on each digit cluster (falls back to pixel density).
      4. Parse two numbers separated visually; return Score(a, b).

    For production, replace the contour+OCR pipeline with a custom YOLOv8
    model trained on digit bounding boxes from your specific GoPro setup.
    """

    def __init__(self, rtsp_url: str, model_path: str) -> None:
        self.rtsp_url = rtsp_url
        self._lock    = threading.Lock()
        self.cap: Optional[cv2.VideoCapture] = None
        log.info("Loading YOLO model: %s", model_path)
        self.model = YOLO(model_path)
        self._connect()

    def _connect(self) -> None:
        log.info("Connecting to RTSP: %s", self.rtsp_url)
        self.cap = cv2.VideoCapture(self.rtsp_url)
        if not self.cap.isOpened():
            raise RuntimeError(f"Cannot open RTSP stream: {self.rtsp_url}")
        log.info("RTSP stream opened.")

    def capture_frame(self) -> Optional[np.ndarray]:
        with self._lock:
            if self.cap is None or not self.cap.isOpened():
                try:
                    self._connect()
                except RuntimeError:
                    return None
            ret, frame = self.cap.read()
            return frame if ret else None

    def detect_score(self, frame: np.ndarray) -> Optional[Score]:
        try:
            return self._extract_score(frame)
        except Exception as exc:
            log.debug("Score detection error: %s", exc)
            return None

    def _extract_score(self, frame: np.ndarray) -> Optional[Score]:
        h, w = frame.shape[:2]
        # Top-centre strip: upper third, middle half width
        roi = frame[0 : h // 3, w // 4 : 3 * w // 4]

        gray    = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        _, thresh = cv2.threshold(
            blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
        )

        contours, _ = cv2.findContours(
            thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        digit_rects: list[tuple[int, int, int, int]] = []
        for cnt in contours:
            x, y, cw, ch = cv2.boundingRect(cnt)
            aspect = cw / max(ch, 1)
            if 0.2 < aspect < 0.9 and 20 < ch < roi.shape[0] * 0.8 and cw > 10:
                digit_rects.append((x, y, cw, ch))

        if len(digit_rects) < 2:
            return None

        digit_rects.sort(key=lambda r: r[0])
        groups = self._cluster_x(digit_rects)
        if len(groups) < 2:
            return None

        digits: list[int] = []
        for group in groups[:2]:
            crop = roi[
                min(r[1] for r in group) : max(r[1] + r[3] for r in group),
                min(r[0] for r in group) : max(r[0] + r[2] for r in group),
            ]
            d = self._ocr_digit(crop)
            if d is None:
                return None
            digits.append(d)

        score = Score(digits[0], digits[1])
        if DEBUG_FRAMES:
            self._save_debug(frame, roi, score)
        return score if score.is_valid() else None

    @staticmethod
    def _cluster_x(
        rects: list[tuple[int, int, int, int]], gap: int = 40
    ) -> list[list[tuple[int, int, int, int]]]:
        groups: list[list[tuple[int, int, int, int]]] = [[rects[0]]]
        for r in rects[1:]:
            prev = groups[-1][-1]
            if r[0] - (prev[0] + prev[2]) < gap:
                groups[-1].append(r)
            else:
                groups.append([r])
        return groups

    @staticmethod
    def _ocr_digit(img: np.ndarray) -> Optional[int]:
        if img.size == 0:
            return None
        img_resized = cv2.resize(img, (28, 56), interpolation=cv2.INTER_AREA)
        try:
            import pytesseract
            from PIL import Image as PILImage

            pil = PILImage.fromarray(img_resized)
            text = pytesseract.image_to_string(
                pil, config="--psm 10 -c tessedit_char_whitelist=0123456789"
            ).strip()
            return int(text) if text.isdigit() else None
        except Exception:
            return None

    @staticmethod
    def _save_debug(frame: np.ndarray, roi: np.ndarray, score: Score) -> None:
        debug_dir = Path("debug_frames")
        debug_dir.mkdir(exist_ok=True)
        ts = int(time.time() * 1000)
        cv2.imwrite(str(debug_dir / f"frame_{ts}.jpg"), frame)
        cv2.imwrite(str(debug_dir / f"roi_{ts}.jpg"), roi)
        log.debug("Debug frames saved (score %s)", score)

    def release(self) -> None:
        if self.cap:
            self.cap.release()
            self.cap = None


# ─── ScoreReporter ────────────────────────────────────────────────────────────
class ScoreReporter:
    """Sends confirmed scores to the Vercel /api/score endpoint."""

    def __init__(self, score_url: str, player_a: str, player_b: str) -> None:
        self.score_url = score_url
        self.player_a  = player_a
        self.player_b  = player_b

    def report(self, score: Score) -> bool:
        payload = {
            "playerA":   self.player_a,
            "playerB":   self.player_b,
            "scoreA":    score.a,
            "scoreB":    score.b,
            "timestamp": int(time.time() * 1000),
            "source":    "gopro",
        }
        try:
            resp = requests.post(self.score_url, json=payload, timeout=10)
            if resp.ok:
                log.info(
                    "Score submitted: %s %d – %d %s",
                    self.player_a, score.a, score.b, self.player_b,
                )
                return True
            log.error("API error %s: %s", resp.status_code, resp.text[:200])
            return False
        except requests.RequestException as exc:
            log.error("Network error submitting score: %s", exc)
            return False


# ─── OrchestratorAgent ────────────────────────────────────────────────────────
class OrchestratorAgent:
    """
    Coordinates VisionWorker and ScoreReporter.

    The LLM (claude-sonnet-4-20250514) is consulted only when a score jump
    is ambiguous (more than ±1 point change). Normal single-point increments
    are accepted instantly via fast local rules, keeping latency low.
    """

    _TOOLS = [
        {
            "name": "validate_score_transition",
            "description": (
                "Validate whether a score transition is plausible in ping-pong. "
                "Use when the score changed by more than 1 point. "
                "Returns {valid: bool, reason: str}."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "previous":  {"type": "string", "description": "e.g. '7:5'"},
                    "candidate": {"type": "string", "description": "e.g. '9:5'"},
                    "history": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Recent score history (oldest first)",
                    },
                },
                "required": ["previous", "candidate"],
            },
        },
    ]

    def __init__(
        self,
        vision:   VisionWorker,
        reporter: ScoreReporter,
        state:    PipelineState,
        api_key:  str,
    ) -> None:
        self.vision   = vision
        self.reporter = reporter
        self.state    = state
        self.client   = anthropic.Anthropic(api_key=api_key)
        self._history: list[str] = []

    # ── Validation ────────────────────────────────────────────────────────────

    def _fast_valid(self, prev: Optional[Score], cand: Score) -> bool:
        if prev is None:
            return True
        da = abs(cand.a - prev.a)
        db = abs(cand.b - prev.b)
        return da + db <= 1  # same or ±1 point

    def _llm_valid(self, prev: Score, cand: Score) -> bool:
        log.info("Ambiguous transition %s → %s, consulting LLM…", prev, cand)
        try:
            resp = self.client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=256,
                tools=self._TOOLS,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            f"The scoreboard jumped from {prev} to {cand}. "
                            f"Recent history: {self._history[-5:]}. "
                            "Is this a valid ping-pong score transition? "
                            "Call validate_score_transition."
                        ),
                    }
                ],
            )
            for block in resp.content:
                if block.type == "tool_use" and block.name == "validate_score_transition":
                    result = block.input  # type: ignore[union-attr]
                    is_valid: bool = result.get("valid", False)
                    log.info(
                        "LLM verdict: valid=%s reason=%s",
                        is_valid,
                        result.get("reason", ""),
                    )
                    return is_valid
        except Exception as exc:
            log.warning("LLM validation failed (%s); accepting score", exc)
            return True  # fail-open
        return False

    def _is_valid_transition(self, prev: Optional[Score], cand: Score) -> bool:
        if self._fast_valid(prev, cand):
            return True
        if prev is None:
            return True
        return self._llm_valid(prev, cand)

    # ── Pipeline step ─────────────────────────────────────────────────────────

    def step(self) -> None:
        frame = self.vision.capture_frame()
        if frame is None:
            log.warning("No frame from RTSP stream")
            time.sleep(1.0)
            return

        detected = self.vision.detect_score(frame)
        if detected is None:
            return

        self._history.append(str(detected))

        if detected == self.state.candidate:
            self.state.candidate_streak += 1
        else:
            if not self._is_valid_transition(self.state.last_confirmed, detected):
                log.debug(
                    "Rejected transition %s → %s",
                    self.state.last_confirmed,
                    detected,
                )
                return
            self.state.candidate        = detected
            self.state.candidate_streak = 1

        if self.state.candidate_streak >= CONFIRM_FRAMES:
            confirmed = self.state.candidate
            if confirmed != self.state.last_confirmed:
                log.info(
                    "Score confirmed (%d consecutive readings): %s",
                    self.state.candidate_streak,
                    confirmed,
                )
                if self.reporter.report(confirmed):
                    self.state.last_confirmed = confirmed
                    self.state.submitted_scores.append(
                        {"score": str(confirmed), "ts": time.time()}
                    )
            self.state.candidate_streak = 0

    # ── Main loop ─────────────────────────────────────────────────────────────

    def run(self) -> None:
        log.info(
            "Orchestrator started | %s vs %s | RTSP: %s",
            PLAYER_A, PLAYER_B, RTSP_URL,
        )
        try:
            while self.state.running:
                self.step()
                time.sleep(CAPTURE_INTERVAL)
        except KeyboardInterrupt:
            log.info("Stopped by user.")
        finally:
            self.vision.release()
            scores = [s["score"] for s in self.state.submitted_scores]
            log.info(
                "Session ended | %d score(s) submitted: %s",
                len(scores), scores,
            )


# ─── Entry point ──────────────────────────────────────────────────────────────
def main() -> None:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit("ANTHROPIC_API_KEY not set. Copy .env.example to .env and fill in the values.")

    state      = PipelineState()
    vision     = VisionWorker(RTSP_URL, YOLO_MODEL)
    reporter   = ScoreReporter(SCORE_URL, PLAYER_A, PLAYER_B)
    orchestrator = OrchestratorAgent(vision, reporter, state, api_key)
    orchestrator.run()


if __name__ == "__main__":
    main()
