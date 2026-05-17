# STATUS — GoPro Live Scoreboard

Data: 2026-05-17

---

## ✅ Cosa Funziona (testato)

| Modulo | File | Test | Stato |
|--------|------|------|-------|
| Stream GoPro + Mock | `stream.py` | Mock mode OK | ✅ |
| Ball Tracker (Kalman) | `tracker.py` | Unit test OK | ✅ |
| Event Detector (FSM ITTF) | `events.py` | 8 test passati | ✅ |
| Match Scoring ITTF | `match.py` | 7 test passati | ✅ |
| Pipeline integrata | `scoreboard.py` | E2E mock OK | ✅ |
| Synthetic data generator | `train/generate_synthetic.py` | 2000 immagini generate | ✅ |
| Dataset YOLO format | `dataset/data.yaml` | Corretto | ✅ |
| Test video sintetico | `test_data/sample_match.mp4` | Generato | ✅ |

---

## ⚠️ Da Testare Live con GoPro

1. **Connessione GoPro Hero 12**: testare `open-gopro` handshake BLE+WiFi
2. **UDP stream capture**: verificare che `udp://@:8554` riceva frame dopo handshake
3. **Fallback ffmpeg**: se `open-gopro` fallisce, testare `ffmpeg -f mpegts -i udp://@:8554`
4. **YOLOv8 custom training**: matplotlib broken nella conda env corrente — fix con:
   ```bash
   pip install --force-reinstall matplotlib numpy
   python3 scoreboard/train/train.py --epochs 20
   ```
5. **Detection accuracy su frame reali**: il modello sintetico è un placeholder
6. **Latenza end-to-end reale**: target <500ms, tracker da solo è <1ms
7. **Illuminazione/angolazione**: il sistema assume vista laterale del tavolo

---

## 🚀 Comandi per Avviare

### Test in modalità mock (senza GoPro):
```bash
cd /Users/lucavitolo/ping-pong
STREAM_MODE=mock python3 -m scoreboard.scoreboard
```

### Live con GoPro:
```bash
cd /Users/lucavitolo/ping-pong
STREAM_MODE=live python3 -m scoreboard.scoreboard
```

### Solo test:
```bash
python3 scoreboard/tests/test_events.py
python3 scoreboard/tests/test_match.py
python3 scoreboard/tests/test_e2e.py
```

### Training modello (dopo fix matplotlib):
```bash
python3 scoreboard/train/generate_synthetic.py --n 5000
python3 scoreboard/train/train.py --epochs 50 --device cpu
```

---

## 🐛 Bug Noti / Limitazioni

1. **matplotlib broken** in conda env (numpy ABI mismatch) — impedisce YOLOv8 training.
   Fix: `pip install --force-reinstall matplotlib numpy` o usare un venv pulito.

2. **Modello non trainato**: `scoreboard/models/best.pt` non esiste ancora. Il sistema usa `yolov8n.pt` generico come fallback (non rileva ball/table/net specificamente).

3. **open-gopro non testato live**: richiede GoPro accesa e connessa via WiFi. Il modulo è implementato ma non verificato.

4. **Tracker sensibilità**: i parametri del Kalman filter (process noise, measurement noise) necessitano tuning con dati reali.

5. **Serve detection**: il sistema non rileva il "motion" del servizio — assume che ogni inizio rally sia un servizio. Serve detection visuale (braccio alzato) richiederebbe pose estimation.

6. **Single camera**: con una sola camera, la profondità non è osservabile. Il sistema usa coordinate 2D proiettate.

---

## Architettura

```
GoPro Hero 12 (WiFi)
       │ UDP :8554
       ▼
┌─────────────┐
│ StreamAgent │ → frame numpy
└─────┬───────┘
      ▼
┌──────────────┐
│DetectionAgent│ → ball (x,y,conf), table bbox, net bbox
└─────┬────────┘
      ▼
┌─────────────┐
│TrackerAgent  │ → BallState (pos, vel, event)
└─────┬───────┘
      ▼
┌──────────────────┐
│EventMatchAgent   │ → ITTF FSM → Score → API POST
└──────────────────┘
```
