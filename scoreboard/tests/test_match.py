"""Tests for match.py — ITTF match scoring logic."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from scoreboard.match import Match, MatchConfig


def test_basic_game_win():
    """Player A wins 11-0."""
    m = Match()
    for _ in range(11):
        result = m.register_point("A")

    assert result["game_won"] is True
    assert result["game_winner"] == "A"
    assert m.sets_a == 1
    assert m.score_a == 0  # reset for next game


def test_deuce_game():
    """Game goes to deuce (10-10), needs 2-point lead."""
    m = Match()
    # Get to 10-10
    for _ in range(10):
        m.register_point("A")
        m.register_point("B")

    assert m.score_a == 10
    assert m.score_b == 10
    assert m.is_deuce is True

    # 11-10 not enough
    m.register_point("A")
    assert m.score_a == 11
    assert m.sets_a == 0  # game not won yet

    # 11-11
    m.register_point("B")

    # 12-11
    m.register_point("A")
    assert m.sets_a == 0  # still not won

    # 12-12
    m.register_point("B")

    # 13-12
    m.register_point("A")
    # 13-13
    m.register_point("B")
    # 14-13
    m.register_point("A")
    # 14-14
    m.register_point("B")
    # 15-14
    m.register_point("A")
    # 15-15
    m.register_point("B")
    # 16-15
    m.register_point("A")
    # 16-16
    m.register_point("B")
    # 17-16
    m.register_point("A")
    # 17-17
    m.register_point("B")
    # 18-17 → 18-18 scenario, let's just win it
    result = m.register_point("A")  # 19-17... wait we're at 18-17
    # Actually let me just give A two in a row
    # Reset approach: just ensure 2 point lead wins
    m2 = Match()
    for _ in range(10):
        m2.register_point("A")
        m2.register_point("B")
    # 10-10 deuce
    m2.register_point("A")  # 11-10
    result = m2.register_point("A")  # 12-10
    assert result["game_won"] is True
    assert result["game_winner"] == "A"


def test_service_change_every_2():
    """Service changes every 2 points."""
    m = Match(MatchConfig(first_server="A"))
    assert m.current_server == "A"

    m.register_point("A")  # 1-0, 1 point since change
    assert m.current_server == "A"

    m.register_point("B")  # 1-1, 2 points since change → switch
    assert m.current_server == "B"

    m.register_point("A")  # 2-1
    assert m.current_server == "B"

    m.register_point("A")  # 3-1, switch
    assert m.current_server == "A"


def test_service_change_deuce():
    """At deuce, service changes every 1 point."""
    m = Match(MatchConfig(first_server="A"))
    for _ in range(10):
        m.register_point("A")
        m.register_point("B")
    # 10-10 deuce

    server_before = m.current_server
    m.register_point("A")  # 11-10
    assert m.current_server != server_before  # changed after 1 point


def test_match_best_of_5():
    """Match ends when one player wins 3 sets (best of 5)."""
    m = Match(MatchConfig(best_of=5))

    # Player A wins 3 games
    for game in range(3):
        for _ in range(11):
            m.register_point("A")

    assert m.is_match_over is True
    assert m.winner == "A"
    assert m.sets_a == 3


def test_full_match_simulation():
    """Simulate a complete 3-2 match."""
    m = Match(MatchConfig(best_of=5, player_a_name="Alice", player_b_name="Bob"))

    # Game 1: A wins 11-5
    for _ in range(5):
        m.register_point("A")
        m.register_point("B")
    for _ in range(6):
        m.register_point("A")
    assert m.sets_a == 1

    # Game 2: B wins 11-7
    for _ in range(7):
        m.register_point("B")
        m.register_point("A")
    for _ in range(4):
        m.register_point("B")
    assert m.sets_b == 1

    # Game 3: A wins 11-3
    for _ in range(3):
        m.register_point("A")
        m.register_point("B")
    for _ in range(8):
        m.register_point("A")
    assert m.sets_a == 2

    # Game 4: B wins 11-9
    for _ in range(9):
        m.register_point("B")
        m.register_point("A")
    for _ in range(2):
        m.register_point("B")
    assert m.sets_b == 2

    # Game 5: A wins 11-6
    for _ in range(6):
        m.register_point("A")
        m.register_point("B")
    for _ in range(5):
        m.register_point("A")
    assert m.is_match_over is True
    assert m.winner == "A"
    assert m.sets_a == 3
    assert m.sets_b == 2


def test_to_dict():
    """Serialization includes all required fields."""
    m = Match(MatchConfig(player_a_name="Mario", player_b_name="Luigi"))
    m.register_point("A")
    m.register_point("B")

    d = m.to_dict()
    assert d["score_a"] == 1
    assert d["score_b"] == 1
    assert d["player_a"] == "Mario"
    assert d["player_b"] == "Luigi"
    assert "current_server" in d
    assert "sets_history" in d


if __name__ == "__main__":
    test_basic_game_win()
    test_deuce_game()
    test_service_change_every_2()
    test_service_change_deuce()
    test_match_best_of_5()
    test_full_match_simulation()
    test_to_dict()
    print("✅ Tutti i test match.py passati!")
