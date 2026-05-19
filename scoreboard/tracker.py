"""
tracker.py — Ball tracking with Kalman filter.

Tracks ping-pong ball position, velocity, and detects events:
- Bounce (sudden Y-velocity sign change)
- Net collision (ball near net line)
- Out of table (ball exits table bounds)
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, List, Tuple

import cv2
import numpy as np


class BallEvent(Enum):
    NONE = "none"
    BOUNCE = "bounce"
    NET_TOUCH = "net_touch"
    OUT_OF_TABLE = "out_of_table"


@dataclass
class TableGeometry:
    """Table bounds in pixel coordinates (from detection)."""
    x_min: float = 0.0
    x_max: float = 640.0
    y_min: float = 0.0
    y_max: float = 480.0
    net_x: float = 320.0  # vertical line where net is
    net_y_top: float = 0.0
    net_y_bottom: float = 480.0

    @property
    def left_half(self) -> Tuple[float, float]:
        return (self.x_min, self.net_x)

    @property
    def right_half(self) -> Tuple[float, float]:
        return (self.net_x, self.x_max)

    @property
    def width(self) -> float:
        return self.x_max - self.x_min

    @property
    def height(self) -> float:
        return self.y_max - self.y_min


@dataclass
class BallState:
    """Current state of tracked ball."""
    x: float = 0.0
    y: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    visible: bool = False
    confidence: float = 0.0
    event: BallEvent = BallEvent.NONE
    side: str = "unknown"  # "left" or "right" — which side of table
    frames_since_seen: int = 0


class BallTracker:
    """Kalman filter-based ball tracker with event detection."""

    def __init__(self, table: Optional[TableGeometry] = None):
        self.table = table or TableGeometry()
        self._init_kalman()

        self._history: List[Tuple[float, float]] = []
        self._max_history = 30
        self._frames_lost = 0
        self._max_lost = 15
        self._prev_vy: float = 0.0
        self._prev_side: str = "unknown"
        self._bounce_cooldown: int = 0
        self._event_cooldown: int = 0
        self._last_event: BallEvent = BallEvent.NONE

    def _init_kalman(self):
        # State: [x, y, vx, vy] — position and velocity
        self.kf = cv2.KalmanFilter(4, 2)

        # Transition matrix (constant velocity model)
        self.kf.transitionMatrix = np.array([
            [1, 0, 1, 0],
            [0, 1, 0, 1],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
        ], dtype=np.float32)

        # Measurement matrix (we observe x, y)
        self.kf.measurementMatrix = np.array([
            [1, 0, 0, 0],
            [0, 1, 0, 0],
        ], dtype=np.float32)

        # Process noise
        self.kf.processNoiseCov = np.eye(4, dtype=np.float32) * 1e-2
        self.kf.processNoiseCov[2, 2] = 5e-2
        self.kf.processNoiseCov[3, 3] = 5e-2

        # Measurement noise
        self.kf.measurementNoiseCov = np.eye(2, dtype=np.float32) * 1e-1

        # Initial state
        self.kf.statePre = np.zeros((4, 1), dtype=np.float32)
        self.kf.statePost = np.zeros((4, 1), dtype=np.float32)
        self.kf.errorCovPost = np.eye(4, dtype=np.float32)

    def update_table(self, table: TableGeometry):
        self.table = table

    def _detect_side(self, x: float) -> str:
        if x < self.table.net_x:
            return "left"
        return "right"

    def _detect_bounce(self, vy: float) -> bool:
        if self._bounce_cooldown > 0:
            self._bounce_cooldown -= 1
            return False

        # Bounce = sudden reversal of Y velocity (ball going down then up)
        if self._prev_vy > 3.0 and vy < -1.0:
            self._bounce_cooldown = 5
            return True
        return False

    def _detect_net_touch(self, x: float, y: float) -> bool:
        net_zone = self.table.width * 0.03
        return abs(x - self.table.net_x) < net_zone

    def _detect_out_of_table(self, x: float, y: float) -> bool:
        margin = self.table.width * 0.05
        return (
            x < self.table.x_min - margin
            or x > self.table.x_max + margin
            or y < self.table.y_min - margin
            or y > self.table.y_max + margin
        )

    def update(self, detections: List[Tuple[float, float, float]]) -> BallState:
        """
        Update tracker with new frame detections.

        Args:
            detections: list of (x, y, confidence) for ball candidates

        Returns:
            BallState with current position, velocity, and detected event
        """
        # Predict step
        predicted = self.kf.predict()

        state = BallState()

        if detections:
            # Pick highest confidence detection
            best = max(detections, key=lambda d: d[2])
            bx, by, conf = best

            # Correct Kalman with measurement
            measurement = np.array([[bx], [by]], dtype=np.float32)
            corrected = self.kf.correct(measurement)

            state.x = float(corrected[0].item())
            state.y = float(corrected[1].item())
            state.vx = float(corrected[2].item())
            state.vy = float(corrected[3].item())
            state.visible = True
            state.confidence = conf
            self._frames_lost = 0

            # Update history
            self._history.append((state.x, state.y))
            if len(self._history) > self._max_history:
                self._history.pop(0)

        else:
            # No detection — use prediction only
            self._frames_lost += 1
            state.x = float(predicted[0].item())
            state.y = float(predicted[1].item())
            state.vx = float(predicted[2].item())
            state.vy = float(predicted[3].item())
            state.visible = False
            state.frames_since_seen = self._frames_lost

        # Detect side
        state.side = self._detect_side(state.x)

        # Reset tracker if ball lost too long
        if self._frames_lost > self._max_lost:
            self._init_kalman()
            self._history.clear()
            self._last_event = BallEvent.NONE
            self._event_cooldown = 0
            self._prev_vy = 0.0
            # Mark state as invalid — no events should fire
            state.visible = False
            state.event = BallEvent.NONE
            return state

        # Event cooldown: skip if recent event fired
        if self._event_cooldown > 0:
            self._event_cooldown -= 1
            self._prev_vy = state.vy
            self._prev_side = state.side
            return state

        # Event detection: ONLY on visible detections, not Kalman predictions
        # This prevents fake OUT events from extrapolated coordinates
        if state.visible:
            if self._detect_bounce(state.vy):
                state.event = BallEvent.BOUNCE
                self._event_cooldown = 8
            elif self._detect_net_touch(state.x, state.y):
                state.event = BallEvent.NET_TOUCH
                self._event_cooldown = 10
            elif self._detect_out_of_table(state.x, state.y):
                if self._last_event != BallEvent.OUT_OF_TABLE:
                    state.event = BallEvent.OUT_OF_TABLE
                    self._event_cooldown = 120  # 1s @ 120fps

        self._last_event = state.event
        self._prev_vy = state.vy
        self._prev_side = state.side

        return state

    def reset(self):
        """Reset tracker state."""
        self._init_kalman()
        self._history.clear()
        self._frames_lost = 0
        self._prev_vy = 0.0
        self._bounce_cooldown = 0

    @property
    def trajectory(self) -> List[Tuple[float, float]]:
        return list(self._history)
