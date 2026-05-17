# Regole ITTF Applicate — GoPro Live Scoreboard

## Fonte
ITTF Laws of Table Tennis 2024 (Laws 2.06–2.10, 2.11–2.13)

---

## Servizio (Law 2.06)

1. La pallina riposa liberamente sul palmo aperto della mano libera del battitore
2. Il battitore lancia la pallina quasi verticalmente verso l'alto, senza spin, per almeno 16cm
3. La pallina deve rimbalzare PRIMA sul lato del battitore, poi passare sopra/attorno la rete e toccare il lato del ricevitore
4. Se il primo rimbalzo non è sul lato del battitore → fallo (punto avversario)
5. Se il secondo rimbalzo non è sul lato del ricevitore → fallo (punto avversario)

### Implementazione nel sistema:
- FSM stato `SERVE`: primo `on_bounce(server_side)` → OK, secondo `on_bounce(receiver_side)` → SERVE_VALID → transizione a RALLY
- Primo bounce su lato sbagliato → SERVE_FAULT → punto avversario

---

## Let (Law 2.09)

Un let viene chiamato quando:
1. Il servizio tocca la rete ma è altrimenti valido
2. Il servizio viene effettuato quando il ricevitore non è pronto
3. Disturbo esterno

### Implementazione:
- Se `on_net_touch()` durante stato SERVE, e il secondo rimbalzo è valido → SERVE_LET
- Rally ricomincia senza punti assegnati

---

## Punto (Law 2.10)

Un giocatore segna quando l'avversario:
1. Non effettua un servizio valido
2. Non effettua un ritorno valido
3. Colpisce la pallina che esce dal tavolo senza rimbalzare
4. Lascia che la pallina rimbalzi due volte sul proprio lato (double bounce)
5. Tocca la rete
6. Muove la superficie di gioco

### Implementazione:
- `DOUBLE_BOUNCE`: due rimbalzi consecutivi sullo stesso lato → punto avversario
- `BALL_OUT`: pallina esce dal campo → punto a chi non ha colpito per ultimo
- `SERVE_FAULT`: servizio non valido → punto al ricevitore

---

## Sistema di Punteggio (Law 2.11)

- **Game**: primo a 11 punti
- **Deuce**: a 10-10, vince chi ottiene 2 punti di vantaggio
- **Match**: best of N game (configurabile, default 5)
- Vince il match chi raggiunge ⌈N/2⌉ game vinti

### Implementazione:
- `Match._check_game_won()`: verifica `score >= 11 AND diff >= 2`
- `Match._check_match_won()`: verifica `sets >= sets_to_win`

---

## Cambio Servizio (Law 2.13)

- Ogni **2 punti** il servizio passa all'altro giocatore
- A **10-10** (deuce/expedite): il servizio cambia ogni **1 punto**

### Implementazione:
- `Match.service_interval`: 2 normalmente, 1 se `is_deuce`
- `Match._check_service_change()`: conta punti e cambia server

---

## Cambio Campo

- I giocatori cambiano lato tra un game e l'altro
- Nel game decisivo (es. 5° su best-of-5), si cambia a 5 punti

### Implementazione:
- `Match._start_new_game()`: swappa `_side_a` left↔right
