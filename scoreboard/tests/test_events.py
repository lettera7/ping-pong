"""Tests for events.py — ITTF event detection FSM."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from scoreboard.events import EventDetector, GameEvent, RallyState


def test_valid_serve():
    """Valid serve: bounce server side, then receiver side."""
    ed = EventDetector(server="A")
    ed.start_serve()

    # First bounce on server's side (left)
    result = ed.on_bounce("left")
    assert result is None  # first bounce OK, no event yet

    # Second bounce on receiver's side (right)
    result = ed.on_bounce("right")
    assert result is not None
    assert result.event == GameEvent.SERVE_VALID
    assert ed.state == RallyState.RALLY


def test_serve_fault_wrong_first_bounce():
    """Serve fault: first bounce on receiver's side."""
    ed = EventDetector(server="A")
    ed.start_serve()

    result = ed.on_bounce("right")  # wrong side
    assert result is not None
    assert result.event == GameEvent.POINT_SCORED
    assert result.player_scored == "B"  # opponent scores


def test_serve_let():
    """Serve let: ball touches net but lands on correct sides."""
    ed = EventDetector(server="A")
    ed.start_serve()

    ed.on_bounce("left")  # server side OK
    ed.on_net_touch()  # touches net
    result = ed.on_bounce("right")  # lands on receiver side

    assert result is not None
    assert result.event == GameEvent.SERVE_LET


def test_double_bounce_rally():
    """Double bounce during rally = point to opponent."""
    ed = EventDetector(server="A")
    ed.start_serve()
    ed.on_bounce("left")
    ed.on_bounce("right")  # serve valid, now in rally

    # Rally: ball bounces on right, then right again (double bounce)
    ed.on_bounce("left")  # valid return bounce
    result = ed.on_bounce("left")  # double bounce!

    assert result is not None
    assert result.event == GameEvent.POINT_SCORED
    assert result.player_scored == "B"  # B scores because A failed (left side)


def test_ball_out_during_rally():
    """Ball goes out during rally."""
    ed = EventDetector(server="A")
    ed.start_serve()
    ed.on_bounce("left")
    ed.on_bounce("right")  # rally starts

    ed.on_bounce("left")  # valid bounce

    # Ball goes out from right side (B hit it out)
    result = ed.on_ball_out("right")
    assert result is not None
    assert result.event == GameEvent.POINT_SCORED
    assert result.player_scored == "A"  # A scores because B hit it out


def test_serve_fault_ball_out():
    """Serve goes directly out of table."""
    ed = EventDetector(server="A")
    ed.start_serve()

    result = ed.on_ball_out("left")
    assert result is not None
    assert result.event == GameEvent.POINT_SCORED
    assert result.player_scored == "B"


def test_server_b():
    """Server B serves from right side."""
    ed = EventDetector(server="B")
    ed.start_serve()

    # First bounce on server's side (right for B)
    result = ed.on_bounce("right")
    assert result is None

    # Second bounce on receiver's side (left for A)
    result = ed.on_bounce("left")
    assert result is not None
    assert result.event == GameEvent.SERVE_VALID


def test_full_rally_sequence():
    """Full rally: serve → multiple bounces → point."""
    ed = EventDetector(server="A")
    ed.start_serve()

    # Valid serve
    ed.on_bounce("left")
    ed.on_bounce("right")

    # Rally exchanges
    ed.on_bounce("left")   # B returns, ball lands on A's side
    ed.on_bounce("right")  # A returns, ball lands on B's side
    ed.on_bounce("left")   # B returns again

    # A fails to return — double bounce on left
    result = ed.on_bounce("left")
    assert result.event == GameEvent.POINT_SCORED
    assert result.player_scored == "B"


if __name__ == "__main__":
    test_valid_serve()
    test_serve_fault_wrong_first_bounce()
    test_serve_let()
    test_double_bounce_rally()
    test_ball_out_during_rally()
    test_serve_fault_ball_out()
    test_server_b()
    test_full_rally_sequence()
    print("✅ Tutti i test events.py passati!")
