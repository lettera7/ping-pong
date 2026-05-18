"""
download_openttgames.py — Download OpenTTGames dataset and convert to YOLO format.

Strategy:
- Download N smallest test videos (faster than 30GB train set)
- Extract frames where ball is annotated
- Convert ball coords → YOLO bbox (single class: ball)
- Build dataset for fine-tuning

Source: https://lab.osai.ai/

Usage:
    python3 scoreboard/train/download_openttgames.py --videos test_2 test_3
    python3 scoreboard/train/download_openttgames.py --all-test
"""

import argparse
import json
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

import cv2
import numpy as np

BASE_URL = "https://lab.osai.ai/datasets/openttgames/data"
DATA_DIR = Path(__file__).parent.parent / "openttgames"
DATASET_DIR = Path(__file__).parent.parent / "dataset_real"
BALL_BBOX_SIZE = 14  # pixels (approx ping-pong ball in 1920x1080)
FRAME_SKIP = 4  # take every Nth frame to reduce dataset size

# All test videos with sizes (MB)
TEST_VIDEOS = {
    "test_1": 1100,
    "test_2": 225,
    "test_3": 488,
    "test_4": 2300,
    "test_5": 720,
    "test_6": 676,
    "test_7": 488,
}


def download(url: str, dest: Path):
    """Stream-download a file with progress."""
    if dest.exists():
        print(f"  ✓ Già presente: {dest.name} ({dest.stat().st_size // 1024 // 1024} MB)")
        return

    print(f"  ⬇️  Download: {url}")
    dest.parent.mkdir(parents=True, exist_ok=True)

    def hook(block_num, block_size, total_size):
        downloaded = block_num * block_size
        if total_size > 0:
            pct = 100 * downloaded / total_size
            mb = downloaded / 1024 / 1024
            total_mb = total_size / 1024 / 1024
            sys.stdout.write(f"\r     {pct:5.1f}%  {mb:6.1f}/{total_mb:.1f} MB")
            sys.stdout.flush()

    urllib.request.urlretrieve(url, dest, reporthook=hook)
    sys.stdout.write("\n")


def download_video(name: str):
    """Download single video + annotations."""
    video_url = f"{BASE_URL}/{name}.mp4"
    zip_url = f"{BASE_URL}/{name}.zip"
    video_dest = DATA_DIR / f"{name}.mp4"
    zip_dest = DATA_DIR / f"{name}.zip"

    print(f"\n📦 {name}")
    download(video_url, video_dest)
    download(zip_url, zip_dest)

    # Extract zip
    extract_dir = DATA_DIR / name
    if not extract_dir.exists():
        print(f"  📂 Estraggo {zip_dest.name}")
        with zipfile.ZipFile(zip_dest, "r") as zf:
            zf.extractall(extract_dir)


def find_annotation(extract_dir: Path, name: str = "ball_markup") -> Path:
    """Locate ball_markup.json or events_markup.json in extracted folder."""
    for p in extract_dir.rglob(f"{name}.json"):
        return p
    return None


def convert_to_yolo(
    video_name: str,
    split_train: bool = True,
    train_ratio: float = 0.85,
):
    """Convert a video + annotations to YOLO dataset format."""
    video_path = DATA_DIR / f"{video_name}.mp4"
    ann_dir = DATA_DIR / video_name

    if not video_path.exists():
        print(f"⚠️  {video_path} mancante — skip")
        return 0

    ball_json = find_annotation(ann_dir, "ball_markup")
    if not ball_json:
        print(f"⚠️  ball_markup.json non trovato in {ann_dir} — skip")
        return 0

    print(f"\n🔄 Conversione {video_name}")
    print(f"   Annotazioni: {ball_json}")

    with open(ball_json) as f:
        ball_coords = json.load(f)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"❌ Cannot open {video_path}")
        return 0

    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"   Video: {W}x{H}, {total_frames} frame totali")

    images_train = DATASET_DIR / "images" / "train"
    images_val = DATASET_DIR / "images" / "val"
    labels_train = DATASET_DIR / "labels" / "train"
    labels_val = DATASET_DIR / "labels" / "val"
    for d in (images_train, images_val, labels_train, labels_val):
        d.mkdir(parents=True, exist_ok=True)

    saved = 0
    frame_idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break

        key = str(frame_idx)
        if key in ball_coords and frame_idx % FRAME_SKIP == 0:
            coord = ball_coords[key]
            bx = coord.get("x", -1)
            by = coord.get("y", -1)

            if bx >= 0 and by >= 0:
                # Resize to 640x640 for YOLO
                scale = 640 / max(W, H)
                new_w = int(W * scale)
                new_h = int(H * scale)
                frame_resized = cv2.resize(frame, (new_w, new_h))

                # Pad to square 640x640
                canvas = np.zeros((640, 640, 3), dtype=np.uint8)
                pad_x = (640 - new_w) // 2
                pad_y = (640 - new_h) // 2
                canvas[pad_y:pad_y + new_h, pad_x:pad_x + new_w] = frame_resized

                # Transform ball coords
                bx_new = bx * scale + pad_x
                by_new = by * scale + pad_y
                bw = BALL_BBOX_SIZE * scale
                bh = BALL_BBOX_SIZE * scale

                # Normalize for YOLO
                x_center = bx_new / 640
                y_center = by_new / 640
                w_norm = bw / 640
                h_norm = bh / 640

                # Train/val split
                is_train = (saved % 100) < int(train_ratio * 100)
                img_dir = images_train if is_train else images_val
                lbl_dir = labels_train if is_train else labels_val

                stem = f"{video_name}_{frame_idx:06d}"
                cv2.imwrite(str(img_dir / f"{stem}.jpg"), canvas, [cv2.IMWRITE_JPEG_QUALITY, 85])
                with open(lbl_dir / f"{stem}.txt", "w") as f:
                    f.write(f"0 {x_center:.6f} {y_center:.6f} {w_norm:.6f} {h_norm:.6f}\n")

                saved += 1

                if saved % 200 == 0:
                    print(f"   Salvati {saved} frame...")

        frame_idx += 1

    cap.release()
    print(f"   ✅ {saved} frame estratti da {video_name}")
    return saved


def write_yaml():
    """Write data.yaml for YOLO training."""
    yaml_path = DATASET_DIR / "data.yaml"
    content = f"""path: {DATASET_DIR.resolve()}
train: images/train
val: images/val

nc: 1
names:
  0: ball
"""
    yaml_path.write_text(content)
    print(f"\n📝 data.yaml scritto: {yaml_path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--videos", nargs="+", help="Video names (e.g., test_2 test_3)")
    parser.add_argument("--all-test", action="store_true", help="Download all 7 test videos")
    parser.add_argument("--skip-download", action="store_true", help="Only convert existing")
    args = parser.parse_args()

    if args.all_test:
        videos = list(TEST_VIDEOS.keys())
    elif args.videos:
        videos = args.videos
    else:
        # Default: smallest 2 test videos
        videos = ["test_2", "test_3"]

    total_mb = sum(TEST_VIDEOS.get(v, 0) for v in videos)
    print(f"📋 Video selezionati: {videos}")
    print(f"   Dimensione totale: ~{total_mb} MB")

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if not args.skip_download:
        for v in videos:
            download_video(v)

    total_frames = 0
    for v in videos:
        total_frames += convert_to_yolo(v)

    write_yaml()

    print(f"\n{'=' * 60}")
    print(f"✅ Conversione completata")
    print(f"   Frame totali: {total_frames}")
    print(f"   Dataset: {DATASET_DIR}")
    print(f"\nProssimo step:")
    print(f"   python3 scoreboard/train/train.py --epochs 30 \\")
    print(f"     --data scoreboard/dataset_real/data.yaml")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
