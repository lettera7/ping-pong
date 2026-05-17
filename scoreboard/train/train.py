"""
train.py — Train YOLOv8n on synthetic ping-pong dataset.

Usage:
    python3 scoreboard/train/train.py
    python3 scoreboard/train/train.py --epochs 20 --batch 8
"""

import argparse
import os
import sys
from pathlib import Path

os.environ["MPLBACKEND"] = "Agg"

# Workaround: patch matplotlib import if broken
try:
    import matplotlib
except ImportError:
    pass

from ultralytics import YOLO

DATASET_DIR = Path(__file__).parent.parent / "dataset"
MODELS_DIR = Path(__file__).parent.parent / "models"


def train(epochs: int = 50, batch: int = 16, imgsz: int = 640, device: str = "cpu"):
    data_yaml = DATASET_DIR / "data.yaml"
    if not data_yaml.exists():
        print(f"❌ Dataset non trovato: {data_yaml}")
        print("   Esegui prima: python3 scoreboard/train/generate_synthetic.py")
        sys.exit(1)

    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"🏋️ Training YOLOv8n — {epochs} epochs, batch {batch}, device {device}")
    print(f"   Dataset: {data_yaml}")

    model = YOLO("yolov8n.pt")

    results = model.train(
        data=str(data_yaml),
        epochs=epochs,
        batch=batch,
        imgsz=imgsz,
        device=device,
        project=str(MODELS_DIR),
        name="pingpong",
        exist_ok=True,
        verbose=True,
        patience=10,
        save=True,
        plots=False,
    )

    # Copy best model
    best_src = MODELS_DIR / "pingpong" / "weights" / "best.pt"
    best_dst = MODELS_DIR / "best.pt"
    if best_src.exists():
        import shutil
        shutil.copy2(best_src, best_dst)
        print(f"✅ Modello salvato: {best_dst}")

    # Save metrics
    metrics_path = MODELS_DIR / "metrics.txt"
    with open(metrics_path, "w") as f:
        f.write(f"Epochs: {epochs}\n")
        f.write(f"Batch: {batch}\n")
        f.write(f"Image size: {imgsz}\n")
        f.write(f"Device: {device}\n")
        if hasattr(results, "results_dict"):
            for k, v in results.results_dict.items():
                f.write(f"{k}: {v}\n")
    print(f"📊 Metriche salvate: {metrics_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--device", default="cpu", help="cpu or mps")
    args = parser.parse_args()

    train(args.epochs, args.batch, args.imgsz, args.device)
