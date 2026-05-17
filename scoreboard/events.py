"""
events.py — Finite-state machine for ITTF event detection.

States: IDLE → SERVE → RALLY → POINT_RESOLVED → IDLE
Detects all scoring events per ITTF 2024 rules.
"""

from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Optional, List
import time


class GameEvent(Enum):
    SERVE_START = "serve_start"
    SERVE_VALID = "serve_valid"
    SERVE_FAULT = "serve_fault"
    SERVE_LET = "serve_let"
    BALL_BOUNCE = "ball_bounce"
    NET_TOUCH = "net_touch"
    BALL_OUT = "ball_out"
    DOUBLE_BOUNCE = "double_bounce"
    POINT_SCORED = "point_scored"


class RallyState(Enum):
    IDLE = auto()
    SERVE = auto()
    RALLY = auto()
    POINT_RESOLVED = auto()


@dataclass
class EventResult:
    event: GameEvent
    player_scored: Optional[str] = None  # "A" or "B"
    detail: str = ""
    timestamp: float = field(default_factory=time.time)


class EventDetector:
    """
    FSM-based event detector following ITTF 2024 rules.

    Players:
        - Player A is on the LEFT side
        - Player B is on the RIGHT side
    """

    def __init__(self, server: str = "A"):
        self.state = RallyState.IDLE
        self.server = server  # "A" or "B"
        self._bounces: List[str] = []  # sides where ball bounced: ["left", "right", ...]
        self._net_touched = False
        self._serve_bounce_count = 0
        self._last_events: List[EventResult] = []
        self._rally_started_at: float = 0.0
        self._point_cooldown: float = 0.0

    @property
    def server_side(self) -> str:
        return "left" if self.server == "A" else "right"

    @property
    def receiver_side(self) -> str:
        return "right" if self.server == "A" else "left"

    def _side_to_player(self, side: str) -> str:
        return "A" if side == "left" else "B"

    def _opponent(self, player: str) -> str:
        return "B" if player == "A" else "A"

    def start_serve(self) -> EventResult:
        """Call when serve motion detected."""
        self.state = RallyState.SERVE
        self._bounces = []
        self._net_touched = False
        self._serve_bounce_count = 0
        self._rally_started_at = time.time()
        result = EventResult(event=GameEvent.SERVE_START, detail=f"Server: {self.server}")
        self._last_events.append(result)
        return result

    def on_bounce(self, side: str) -> Optional[EventResult]:
        """
        Called when ball bounces on a side ('left' or 'right').

        ITTF Service rules:
        - Ball must bounce on server's side first, then receiver's side
        - If ball bounces twice on same side = double bounce = point to opponent

        ITTF Rally rules:
        - Ball must bounce on opponent's side to be a valid return
        - Double bounce on same side = point to the other player
        """
        now = time.time()

        if self.state == RallyState.SERVE:
            self._serve_bounce_count += 1

            if self._serve_bounce_count == 1:
                # First bounce must be on server's side
                if side != self.server_side:
                    return self._score_point(
                        self._opponent(self.server),
                        GameEvent.SERVE_FAULT,
                        "Servizio: primo rimbalzo non sul lato del battitore"
                    )
                self._bounces.append(side)
                return None

            elif self._serve_bounce_count == 2:
                # Second bounce must be on receiver's side
                if self._net_touched:
                    # Net was touched — it's a let
                    self.state = RallyState.IDLE
                    result = EventResult(
                        event=GameEvent.SERVE_LET,
                        detail="Let — servizio tocca rete ma valido"
                    )
                    self._last_events.append(result)
                    return result

                if side != self.receiver_side:
                    return self._score_point(
                        self._opponent(self.server),
                        GameEvent.SERVE_FAULT,
                        "Servizio: secondo rimbalzo non sul lato del ricevitore"
                    )

                # Valid serve — transition to rally
                self.state = RallyState.RALLY
                self._bounces = [side]
                result = EventResult(event=GameEvent.SERVE_VALID, detail="Servizio valido")
                self._last_events.append(result)
                return result

            else:
                # 3+ bounces during serve = fault (ball bounced again on server's side)
                return self._score_point(
                    self._opponent(self.server),
                    GameEvent.DOUBLE_BOUNCE,
                    "Doppio rimbalzo durante il servizio"
                )

        elif self.state == RallyState.RALLY:
            self._bounces.append(side)

            # Double bounce detection: same side bounces consecutively
            if len(self._bounces) >= 2 and self._bounces[-1] == self._bounces[-2]:
                # Player on that side failed to return
                loser = self._side_to_player(side)
                winner = self._opponent(loser)
                return self._score_point(
                    winner,
                    GameEvent.DOUBLE_BOUNCE,
                    f"Doppio rimbalzo lato {side} — punto a Player {winner}"
                )

            # Normal bounce during rally
            result = EventResult(
                event=GameEvent.BALL_BOUNCE,
                detail=f"Rimbalzo lato {side}"
            )
            self._last_events.append(result)
            return result

        return None

    def on_net_touch(self) -> Optional[EventResult]:
        """Called when ball touches/crosses net area."""
        self._net_touched = True

        if self.state == RallyState.RALLY:
            result = EventResult(event=GameEvent.NET_TOUCH, detail="Pallina tocca rete")
            self._last_events.append(result)
            return result

        # During serve, net touch is noted but resolved on next bounce
        return None

    def on_ball_out(self, last_side: str) -> Optional[EventResult]:
        """
        Called when ball goes out of table bounds.

        The player who last hit the ball (ball coming FROM their side) loses the point.
        """
        if self.state == RallyState.SERVE:
            return self._score_point(
                self._opponent(self.server),
                GameEvent.SERVE_FAULT,
                "Servizio fuori dal tavolo"
            )

        elif self.state == RallyState.RALLY:
            # Ball came from last_side going out = that player hit it out
            hitter = self._side_to_player(last_side)
            winner = self._opponent(hitter)
            return self._score_point(
                winner,
                GameEvent.BALL_OUT,
                f"Pallina fuori — colpita da Player {hitter}"
            )

        return None

    def on_miss(self, side: str) -> Optional[EventResult]:
        """Called when ball passes through a side without being returned (timeout)."""
        if self.state == RallyState.RALLY:
            loser = self._side_to_player(side)
            winner = self._opponent(loser)
            return self._score_point(
                winner,
                GameEvent.POINT_SCORED,
                f"Player {loser} non ha risposto"
            )
        return None

    def _score_point(self, winner: str, event: GameEvent, detail: str) -> EventResult:
        """Resolve a point."""
        self.state = RallyState.POINT_RESOLVED
        result = EventResult(
            event=GameEvent.POINT_SCORED,
            player_scored=winner,
            detail=detail,
        )
        self._last_events.append(result)
        # Auto-reset to idle
        self.state = RallyState.IDLE
        self._bounces = []
        self._net_touched = False
        return result

    def force_point(self, winner: str, reason: str = "") -> EventResult:
        """Manually award a point (e.g., from external call)."""
        return self._score_point(winner, GameEvent.POINT_SCORED, reason or "Punto manuale")

    def reset_rally(self):
        """Reset state for new rally."""
        self.state = RallyState.IDLE
        self._bounces = []
        self._net_touched = False
        self._serve_bounce_count = 0

    @property
    def last_events(self) -> List[EventResult]:
        return list(self._last_events[-20:])

    def set_server(self, server: str):
        self.server = server
