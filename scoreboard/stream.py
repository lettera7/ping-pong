"""
stream.py — GoPro Hero 12 live preview stream capture.

Provides an iterator of numpy frames from:
1. GoPro via open-gopro SDK (live mode)
2. GoPro via ffmpeg UDP fallback
3. Mock mode: reads from a local video file

Usage:
    python3 -m scoreboard.stream --mock
    python3 -m scoreboard.stream --live
"""

import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterator, Optional

import cv2
import numpy as np

MOCK_VIDEO = Path(__file__).parent / "test_data" / "sample_match.mp4"
TARGET_FPS = 30


def live_frames_gopro(timeout: float = 30.0) -> Iterator[np.ndarray]:
    """Capture frames from GoPro Hero 12 via open-gopro SDK."""
    try:
        from open_gopro import WirelessGoPro
        from open_gopro.constants import Params
    except ImportError:
        print("open-gopro not installed. Falling back to ffmpeg UDP.")
        yield from live_frames_ffmpeg(timeout)
        return

    gopro = WirelessGoPro(enable_wifi=True)
    gopro.open(timeout=int(timeout))

    gopro.http_command.set_preview_stream(mode=Params.Toggle.ENABLE)
    time.sleep(2)

    cap = cv2.VideoCapture("udp://@:8554", cv2.CAP_FFMPEG)
    if not cap.isOpened():
        gopro.close()
        raise RuntimeError("Cannot open UDP preview stream after gopro handshake")

    try:
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                time.sleep(0.01)
                continue
            yield frame
    finally:
        cap.release()
        try:
            gopro.http_command.set_preview_stream(mode=Params.Toggle.DISABLE)
            gopro.close()
        except Exception:
            pass


def live_frames_ffmpeg(timeout: float = 30.0) -> Iterator[np.ndarray]:
    """Capture frames from GoPro UDP stream via ffmpeg subprocess."""
    import subprocess
    import struct

    width, height = 1280, 720

    cmd = [
        "ffmpeg",
        "-fflags", "nobuffer",
        "-flags", "low_delay",
        "-f", "mpegts",
        "-i", "udp://@:8554",
        "-vf", f"scale={width}:{height}",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "-an",
        "pipe:1",
    ]

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        bufsize=width * height * 3 * 2,
    )

    frame_size = width * height * 3
    try:
        while True:
            raw = proc.stdout.read(frame_size)
            if len(raw) < frame_size:
                break
            frame = np.frombuffer(raw, dtype=np.uint8).reshape((height, width, 3))
            yield frame
    finally:
        proc.terminate()
        proc.wait()


def mock_frames(video_path: Optional[Path] = None, loop: bool = True) -> Iterator[np.ndarray]:
    """Read frames from a local video file (mock mode for testing)."""
    path = video_path or MOCK_VIDEO
    if not path.exists():
        raise FileNotFoundError(f"Mock video not found: {path}")

    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or TARGET_FPS
    interval = 1.0 / fps

    try:
        while True:
            t0 = time.monotonic()
            ok, frame = cap.read()
            if not ok:
                if loop:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                break
            yield frame
            elapsed = time.monotonic() - t0
            sleep_t = interval - elapsed
            if sleep_t > 0:
                time.sleep(sleep_t)
    finally:
        cap.release()


def live_frames(timeout: float = 30.0) -> Iterator[np.ndarray]:
    """Main entry point. Returns frame iterator based on env config."""
    mode = os.getenv("STREAM_MODE", "live").lower()

    if mode == "mock" or os.getenv("MOCK_STREAM", "").lower() == "true":
        print("🎬 Modalità MOCK — lettura da video locale")
        yield from mock_frames()
    else:
        print("📡 Modalità LIVE — connessione GoPro Hero 12")
        yield from live_frames_gopro(timeout)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="GoPro stream test")
    parser.add_argument("--mock", action="store_true", help="Use mock video")
    parser.add_argument("--live", action="store_true", help="Use live GoPro")
    parser.add_argument("--show", action="store_true", help="Display frames (requires GUI)")
    args = parser.parse_args()

    if args.mock:
        os.environ["STREAM_MODE"] = "mock"
    elif args.live:
        os.environ["STREAM_MODE"] = "live"

    count = 0
    t0 = time.monotonic()
    for frame in live_frames():
        count += 1
        if args.show:
            cv2.imshow("GoPro Stream", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
        if count % 30 == 0:
            fps = count / (time.monotonic() - t0)
            print(f"  Frame {count} | {frame.shape} | {fps:.1f} fps")
        if count >= 300:
            break

    elapsed = time.monotonic() - t0
    print(f"\n✅ {count} frame catturati in {elapsed:.1f}s ({count/elapsed:.1f} fps)")
