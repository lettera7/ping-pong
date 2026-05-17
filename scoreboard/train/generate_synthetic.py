"""
generate_synthetic.py — Generate synthetic training data for YOLOv8.

Classes: ball(0), table(1), net(2), paddle(3), player(4)

Usage:
    python3 scoreboard/train/generate_synthetic.py --n 5000
    python3 scoreboard/train/generate_synthetic.py --n 100 --preview
"""

import argparse
import random
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

DATASET_DIR = Path(__file__).parent.parent / "dataset"
IMG_SIZE = 640

# Class IDs
CLS_BALL = 0
CLS_TABLE = 1
CLS_NET = 2
CLS_PADDLE = 3
CLS_PLAYER = 4


def random_color(base, variance=30):
    return tuple(
        max(0, min(255, base[i] + random.randint(-variance, variance)))
        for i in range(3)
    )


def draw_table(draw, img_size):
    """Draw a table tennis table in perspective."""
    # Table colors: blue or green
    table_color = random.choice([
        (0, 100, 180),   # blue
        (0, 120, 60),    # green
        (20, 80, 160),   # dark blue
    ])
    table_color = random_color(table_color, 20)

    # Random perspective parameters
    margin_x = random.randint(40, 120)
    margin_y = random.randint(80, 180)
    top_shrink = random.uniform(0.6, 0.85)

    # Table corners (trapezoid for perspective)
    bottom_left = (margin_x, img_size - margin_y)
    bottom_right = (img_size - margin_x, img_size - margin_y)
    top_offset = int((1 - top_shrink) * (img_size - 2 * margin_x) / 2)
    top_y = margin_y + random.randint(0, 40)
    top_left = (margin_x + top_offset, top_y)
    top_right = (img_size - margin_x - top_offset, top_y)

    # Draw table surface
    draw.polygon([top_left, top_right, bottom_right, bottom_left], fill=table_color)

    # White border lines
    draw.line([top_left, top_right], fill="white", width=2)
    draw.line([top_right, bottom_right], fill="white", width=2)
    draw.line([bottom_right, bottom_left], fill="white", width=2)
    draw.line([bottom_left, top_left], fill="white", width=2)

    # Center line (horizontal)
    mid_y = (top_y + img_size - margin_y) // 2
    mid_left_x = (top_left[0] + bottom_left[0]) // 2
    mid_right_x = (top_right[0] + bottom_right[0]) // 2
    draw.line([(mid_left_x, mid_y), (mid_right_x, mid_y)], fill="white", width=1)

    # Table bbox (normalized)
    x_min = min(top_left[0], bottom_left[0]) / img_size
    x_max = max(top_right[0], bottom_right[0]) / img_size
    y_min = top_y / img_size
    y_max = (img_size - margin_y) / img_size

    table_bbox = (
        (x_min + x_max) / 2,
        (y_min + y_max) / 2,
        x_max - x_min,
        y_max - y_min,
    )

    # Net position
    net_x = (mid_left_x + mid_right_x) / 2 / img_size

    return table_bbox, (top_left, top_right, bottom_right, bottom_left), net_x, mid_y


def draw_net(draw, table_corners, img_size):
    """Draw net at center of table."""
    tl, tr, br, bl = table_corners
    # Net goes across the middle
    net_left_x = (tl[0] + bl[0]) // 2
    net_right_x = (tr[0] + br[0]) // 2
    net_y = (tl[1] + bl[1]) // 2

    net_height = random.randint(8, 20)
    net_color = random_color((40, 40, 40), 20)

    # Net as rectangle band
    draw.rectangle(
        [net_left_x, net_y - net_height, net_right_x, net_y],
        fill=net_color,
    )

    # Net bbox
    x_center = (net_left_x + net_right_x) / 2 / img_size
    y_center = (net_y - net_height / 2) / img_size
    w = (net_right_x - net_left_x) / img_size
    h = net_height / img_size

    return (x_center, y_center, w, h)


def draw_ball(draw, img_size, table_corners):
    """Draw a ping-pong ball at random position."""
    # Ball can be anywhere in frame, biased toward table area
    tl, tr, br, bl = table_corners

    if random.random() < 0.8:
        # Ball on/near table
        x = random.randint(min(tl[0], bl[0]), max(tr[0], br[0]))
        y = random.randint(tl[1] - 30, bl[1] + 20)
    else:
        # Ball elsewhere in frame
        x = random.randint(20, img_size - 20)
        y = random.randint(20, img_size - 20)

    radius = random.randint(4, 10)

    # Ball color: white or orange
    ball_color = random.choice([
        random_color((240, 240, 240), 15),
        random_color((255, 140, 0), 20),
    ])

    draw.ellipse(
        [x - radius, y - radius, x + radius, y + radius],
        fill=ball_color,
    )

    # Ball bbox
    x_center = x / img_size
    y_center = y / img_size
    w = (2 * radius) / img_size
    h = (2 * radius) / img_size

    return (x_center, y_center, w, h)


def draw_paddle(draw, img_size, table_corners, side="left"):
    """Draw a table tennis paddle."""
    tl, tr, br, bl = table_corners

    if side == "left":
        x = random.randint(bl[0] - 40, (bl[0] + br[0]) // 2 - 20)
    else:
        x = random.randint((bl[0] + br[0]) // 2 + 20, br[0] + 40)

    y = random.randint(bl[1] - 60, bl[1] + 40)

    # Paddle dimensions
    pw = random.randint(20, 35)
    ph = random.randint(25, 40)

    # Paddle colors: red and black sides
    paddle_color = random.choice([
        random_color((180, 30, 30), 20),
        random_color((30, 30, 30), 15),
    ])

    draw.ellipse([x, y, x + pw, y + ph], fill=paddle_color)
    # Handle
    handle_color = random_color((139, 90, 43), 20)
    draw.rectangle([x + pw // 3, y + ph, x + 2 * pw // 3, y + ph + 15], fill=handle_color)

    x_center = (x + pw / 2) / img_size
    y_center = (y + ph / 2) / img_size
    w = pw / img_size
    h = (ph + 15) / img_size

    return (x_center, y_center, w, h)


def draw_player(draw, img_size, side="left"):
    """Draw simplified player silhouette."""
    if side == "left":
        x = random.randint(10, 100)
    else:
        x = random.randint(img_size - 120, img_size - 20)

    y = random.randint(img_size // 3, img_size - 80)

    pw = random.randint(40, 70)
    ph = random.randint(80, 150)

    player_color = random_color((random.randint(50, 200), random.randint(50, 200), random.randint(50, 200)), 30)

    # Simple rectangle body
    draw.rectangle([x, y, x + pw, y + ph], fill=player_color)
    # Head
    head_r = pw // 3
    draw.ellipse([x + pw // 3, y - head_r * 2, x + 2 * pw // 3, y], fill=random_color((200, 160, 130), 20))

    x_center = (x + pw / 2) / img_size
    y_center = (y + ph / 2) / img_size
    w = pw / img_size
    h = (ph + head_r * 2) / img_size

    return (x_center, y_center, w, h)


def generate_image(idx: int, split: str = "train") -> None:
    """Generate one synthetic training image with labels."""
    # Background
    bg_color = random_color((random.randint(60, 180), random.randint(60, 150), random.randint(60, 150)), 40)
    img = Image.new("RGB", (IMG_SIZE, IMG_SIZE), bg_color)
    draw = ImageDraw.Draw(img)

    labels = []

    # Draw table
    table_bbox, table_corners, net_x, net_y = draw_table(draw, IMG_SIZE)
    labels.append((CLS_TABLE, *table_bbox))

    # Draw net
    net_bbox = draw_net(draw, table_corners, IMG_SIZE)
    labels.append((CLS_NET, *net_bbox))

    # Draw ball (90% chance)
    if random.random() < 0.9:
        ball_bbox = draw_ball(draw, IMG_SIZE, table_corners)
        labels.append((CLS_BALL, *ball_bbox))

    # Draw paddles (70% chance each)
    if random.random() < 0.7:
        paddle_bbox = draw_paddle(draw, IMG_SIZE, table_corners, "left")
        labels.append((CLS_PADDLE, *paddle_bbox))
    if random.random() < 0.7:
        paddle_bbox = draw_paddle(draw, IMG_SIZE, table_corners, "right")
        labels.append((CLS_PADDLE, *paddle_bbox))

    # Draw players (50% chance each)
    if random.random() < 0.5:
        player_bbox = draw_player(draw, IMG_SIZE, "left")
        labels.append((CLS_PLAYER, *player_bbox))
    if random.random() < 0.5:
        player_bbox = draw_player(draw, IMG_SIZE, "right")
        labels.append((CLS_PLAYER, *player_bbox))

    # Apply augmentations
    # Brightness variation
    if random.random() < 0.5:
        factor = random.uniform(0.7, 1.3)
        img_np = np.array(img).astype(np.float32) * factor
        img_np = np.clip(img_np, 0, 255).astype(np.uint8)
        img = Image.fromarray(img_np)

    # Motion blur (30% chance)
    if random.random() < 0.3:
        angle = random.choice([0, 45, 90, 135])
        img = img.filter(ImageFilter.GaussianBlur(radius=random.uniform(0.5, 2.0)))

    # Save image
    img_dir = DATASET_DIR / "images" / split
    img_dir.mkdir(parents=True, exist_ok=True)
    img_path = img_dir / f"syn_{idx:06d}.jpg"
    img.save(img_path, quality=85)

    # Save labels
    lbl_dir = DATASET_DIR / "labels" / split
    lbl_dir.mkdir(parents=True, exist_ok=True)
    lbl_path = lbl_dir / f"syn_{idx:06d}.txt"
    with open(lbl_path, "w") as f:
        for label in labels:
            cls_id, xc, yc, w, h = label
            f.write(f"{cls_id} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}\n")


def generate_dataset(n: int = 5000, val_ratio: float = 0.2):
    """Generate full dataset with train/val split."""
    n_val = int(n * val_ratio)
    n_train = n - n_val

    print(f"🎨 Generazione dataset sintetico: {n_train} train + {n_val} val")

    for i in range(n_train):
        generate_image(i, "train")
        if (i + 1) % 500 == 0:
            print(f"  Train: {i+1}/{n_train}")

    for i in range(n_val):
        generate_image(n_train + i, "val")
        if (i + 1) % 100 == 0:
            print(f"  Val: {i+1}/{n_val}")

    # Write data.yaml
    yaml_path = DATASET_DIR / "data.yaml"
    yaml_content = f"""path: {DATASET_DIR.resolve()}
train: images/train
val: images/val

nc: 5
names:
  0: ball
  1: table
  2: net
  3: paddle
  4: player
"""
    yaml_path.write_text(yaml_content)
    print(f"✅ Dataset generato: {yaml_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=5000, help="Number of images")
    parser.add_argument("--preview", action="store_true", help="Show sample images")
    args = parser.parse_args()

    generate_dataset(args.n)

    if args.preview:
        sample = DATASET_DIR / "images" / "train" / "syn_000000.jpg"
        if sample.exists():
            img = cv2.imread(str(sample))
            cv2.imshow("Sample", img)
            cv2.waitKey(0)
            cv2.destroyAllWindows()
