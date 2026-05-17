"""
match.py — ITTF match scoring logic.

Manages:
- Game to 11 points (2-point lead at deuce)
- Best-of-N sets (default 5)
- Service rotation (every 2 points; every 1 at deuce)
- Side changes between sets
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
import time


@dataclass
class SetResult:
    score_a: int
    score_b: int
    winner: str  # "A" or "B"


@dataclass
class MatchConfig:
    best_of: int = 5
    points_per_game: int = 11
    first_server: str = "A"
    player_a_name: str = "Player A"
    player_b_name: str = "Player B"


class Match:
    """Full ITTF match state machine."""

    def __init__(self, config: Optional[MatchConfig] = None):
        self.config = config or MatchConfig()

        self.score_a: int = 0
        self.score_b: int = 0
        self.sets_a: int = 0
        self.sets_b: int = 0
        self.current_set: int = 1
        self.current_server: str = self.config.first_server
        self.sets_history: List[SetResult] = []

        self._total_points_in_game: int = 0
        self._points_since_service_change: int = 0
        self._match_over: bool = False
        self._winner: Optional[str] = None
        self._side_a: str = "left"  # Player A starts on left

    @property
    def is_deuce(self) -> bool:
        return (
            self.score_a >= self.config.points_per_game - 1
            and self.score_b >= self.config.points_per_game - 1
        )

    @property
    def is_match_over(self) -> bool:
        return self._match_over

    @property
    def winner(self) -> Optional[str]:
        return self._winner

    @property
    def sets_to_win(self) -> int:
        return (self.config.best_of // 2) + 1

    @property
    def service_interval(self) -> int:
        return 1 if self.is_deuce else 2

    def register_point(self, winner: str) -> Dict[str, Any]:
        """
        Register a point scored by winner ("A" or "B").

        Returns dict with what happened:
        {
            "point": "A" or "B",
            "game_won": bool,
            "game_winner": str or None,
            "match_won": bool,
            "match_winner": str or None,
            "new_server": str,
            "score": (a, b),
            "sets": (sa, sb),
        }
        """
        if self._match_over:
            return {"error": "Match already over"}

        # Award point
        if winner == "A":
            self.score_a += 1
        else:
            self.score_b += 1

        self._total_points_in_game += 1
        self._points_since_service_change += 1

        result: Dict[str, Any] = {
            "point": winner,
            "game_won": False,
            "game_winner": None,
            "match_won": False,
            "match_winner": None,
            "score": (self.score_a, self.score_b),
            "sets": (self.sets_a, self.sets_b),
        }

        # Check game won
        game_won = self._check_game_won()
        if game_won:
            game_winner = "A" if self.score_a > self.score_b else "B"
            result["game_won"] = True
            result["game_winner"] = game_winner

            self.sets_history.append(SetResult(self.score_a, self.score_b, game_winner))

            if game_winner == "A":
                self.sets_a += 1
            else:
                self.sets_b += 1

            result["sets"] = (self.sets_a, self.sets_b)

            # Check match won
            if self._check_match_won():
                self._match_over = True
                self._winner = game_winner
                result["match_won"] = True
                result["match_winner"] = game_winner
            else:
                self._start_new_game()
        else:
            # Service change check
            self._check_service_change()

        result["new_server"] = self.current_server
        return result

    def _check_game_won(self) -> bool:
        a, b = self.score_a, self.score_b
        target = self.config.points_per_game

        if a >= target and a - b >= 2:
            return True
        if b >= target and b - a >= 2:
            return True
        return False

    def _check_match_won(self) -> bool:
        return self.sets_a >= self.sets_to_win or self.sets_b >= self.sets_to_win

    def _check_service_change(self):
        if self._points_since_service_change >= self.service_interval:
            self._toggle_server()
            self._points_since_service_change = 0

    def _toggle_server(self):
        self.current_server = "B" if self.current_server == "A" else "A"

    def _start_new_game(self):
        """Reset scores for new game, swap sides and service."""
        self.score_a = 0
        self.score_b = 0
        self._total_points_in_game = 0
        self._points_since_service_change = 0
        self.current_set += 1

        # Alternate first server each game
        self._toggle_server()

        # Swap sides
        self._side_a = "right" if self._side_a == "left" else "left"

    def to_dict(self) -> Dict[str, Any]:
        """Serialize match state for API."""
        return {
            "score_a": self.score_a,
            "score_b": self.score_b,
            "sets_a": self.sets_a,
            "sets_b": self.sets_b,
            "current_set": self.current_set,
            "current_server": self.current_server,
            "is_deuce": self.is_deuce,
            "is_match_over": self._match_over,
            "winner": self._winner,
            "player_a": self.config.player_a_name,
            "player_b": self.config.player_b_name,
            "side_a": self._side_a,
            "sets_history": [
                {"score_a": s.score_a, "score_b": s.score_b, "winner": s.winner}
                for s in self.sets_history
            ],
        }

    def register_event(self, event) -> Optional[Dict[str, Any]]:
        """Register an EventResult from events.py."""
        from scoreboard.events import GameEvent, EventResult

        if not isinstance(event, EventResult):
            return None

        if event.event == GameEvent.POINT_SCORED and event.player_scored:
            return self.register_point(event.player_scored)

        return None
