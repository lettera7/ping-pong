# GoPro Live Scoreboard — Ping-Pong ITTF

Sistema di rilevamento automatico del punteggio per partite di ping-pong
tramite GoPro Hero 12 Black in modalità live stream.

## Requisiti

- Python 3.11+
- GoPro Hero 12 Black (firmware GoPro Labs)
- Mac M-series (o qualsiasi sistema con ffmpeg)
- ffmpeg 8.x installato

## Setup

```bash
cd /Users/lucavitolo/ping-pong

# Installa dipendenze
pip install -r scoreboard/requirements.txt

# Configura .env
cp scoreboard/.env.example scoreboard/.env
# Modifica API_URL, PLAYER_A, PLAYER_B
```

## Avvio Rapido

### Test senza GoPro (mock video):
```bash
STREAM_MODE=mock python3 -m scoreboard.scoreboard
```

### Live con GoPro:
```bash
# 1. Accendi GoPro e connettiti al WiFi della camera
# 2. Avvia il sistema
STREAM_MODE=live python3 -m scoreboard.scoreboard
```

## Training Modello Custom

```bash
# Genera dataset sintetico
python3 scoreboard/train/generate_synthetic.py --n 5000

# Allena YOLOv8n
python3 scoreboard/train/train.py --epochs 50 --device cpu
```

## Variabili d'Ambiente

| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `STREAM_MODE` | `live` | `live` o `mock` |
| `MOCK_STREAM` | `false` | Se `true`, usa video locale |
| `API_URL` | - | URL base API Vercel |
| `API_SECRET` | - | Bearer token per API |
| `PLAYER_A` | Player A | Nome giocatore lato sinistro |
| `PLAYER_B` | Player B | Nome giocatore lato destro |
| `YOLO_MODEL_PATH` | `scoreboard/models/best.pt` | Path modello |
| `YOLO_CONF_THRESH` | `0.4` | Soglia confidence detection |
| `BEST_OF` | `5` | Numero set (best of) |
| `DEBUG` | `false` | Logging verboso |

## Architettura

Pipeline a 4 thread con backpressure via `queue.Queue`:

1. **StreamAgent** — cattura frame da GoPro (open-gopro SDK) o video mock
2. **DetectionAgent** — YOLOv8 inference (ball, table, net, paddle, player)
3. **TrackerAgent** — Kalman filter tracking + event detection (bounce, net, out)
4. **EventMatchAgent** — FSM regole ITTF + scoring + API POST

## Test

```bash
python3 scoreboard/tests/test_events.py   # FSM ITTF
python3 scoreboard/tests/test_match.py    # Scoring logic
python3 scoreboard/tests/test_e2e.py      # End-to-end pipeline
```

## Troubleshooting

### GoPro non si connette
- Verifica WiFi della camera attivo
- Prova: `curl http://10.5.5.9:8080/gopro/camera/state`
- Se errore, usa `open-gopro` CLI: `gopro-wifi --help`

### matplotlib broken (training)
```bash
pip install --force-reinstall matplotlib numpy
```

### Stream UDP non riceve frame
```bash
# Verifica manualmente
ffmpeg -fflags nobuffer -f mpegts -i udp://@:8554 -frames:v 1 test_frame.jpg
```

## Struttura File

```
scoreboard/
├── __init__.py
├── scoreboard.py      # Pipeline principale (entry point)
├── stream.py          # Modulo cattura frame GoPro/mock
├── tracker.py         # Ball tracker Kalman filter
├── events.py          # FSM event detector ITTF
├── match.py           # Match scoring logic
├── dev_agents.py      # Multi-agent dev helper
├── requirements.txt
├── README.md
├── STATUS.md
├── RULES.md
├── RESEARCH.md
├── models/
│   └── best.pt        # (generato dopo training)
├── train/
│   ├── generate_synthetic.py
│   └── train.py
├── dataset/
│   ├── data.yaml
│   ├── images/{train,val}/
│   └── labels/{train,val}/
├── tests/
│   ├── test_events.py
│   ├── test_match.py
│   └── test_e2e.py
└── test_data/
    └── sample_match.mp4
```
