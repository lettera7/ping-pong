# Ping Pong Lettera7 — Documento di Handoff

> Ultimo aggiornamento: 2026-10-06
> Scopo: permettere a chiunque (o a una nuova sessione AI) di riprendere lo sviluppo
> senza ricostruire il contesto da zero. Contiene architettura, "gotcha" non ovvi,
> il codice dell'Apps Script (che **non** è versionato qui) e i problemi aperti.

---

## ⚙️ REGOLA DI PROCESSO — DA SEGUIRE AD OGNI MODIFICA

> **Ogni volta che si fa una modifica al progetto, PRIMA di considerarla conclusa:**
>
> 1. **`git log --oneline ping-pong-7/main..HEAD`** — controlla cosa non è ancora in produzione.
> 2. **`git diff ping-pong-7/main -- src/App.tsx`** (o il file interessato) — verifica
>    l'esatto delta tra locale e produzione per non sovrascrivere nulla.
> 3. **Aggiorna questo HANDOFF.md** con:
>    - le modifiche appena fatte (cosa, perché, dove nel codice)
>    - lo SCRIPT_URL e SHEET_ID correnti (cambiano a ogni nuovo deployment Apps Script)
>    - l'eventuale stato di push (es. "applicato in locale, non ancora in produzione")
> 4. **Committa l'HANDOFF.md** insieme alle modifiche, poi pusha in produzione.
>
> L'handoff è la memoria persistente del progetto tra sessioni — se non viene aggiornato,
> la sessione successiva riparte da dati obsoleti e rischia di fare danni.

---

## 1. Cos'è

PWA (React 18 + TypeScript + Vite) che gestisce una classifica ELO di ping pong
interna a Lettera7. Le partite vengono registrate dal telefono, salvate su un
**Google Sheet** tramite un **Google Apps Script**, e la classifica viene ricalcolata
(ELO, K=24, reset mensile a 1000). C'è anche una sezione "Bollettino" generata da
Claude (Anthropic) e archiviata su Supabase.

Stack:
- **Frontend**: React 18, Vite 6, TypeScript. Tutto il grosso è in `src/App.tsx` (~1200 righe, single-file).
- **Backend partite**: Google Apps Script (web app `doGet`) → Google Sheet. **Esterno, non in questo repo** (vedi §6).
- **Backend bollettini**: funzioni serverless Vercel in `api/` (`bulletins.ts`, `generate.ts`) → Supabase + Anthropic.
- **Hosting**: Vercel.

---

## 2. I due repository GitHub (IMPORTANTE)

| Repo | Branch | Ruolo |
|------|--------|-------|
| `lettera7/ping-pong-7` | `main` | **PRODUZIONE** — è il repo collegato a Vercel. Le modifiche che devono andare live vanno qui. App: https://ping-pong-7.vercel.app |
| `lettera7/ping-pong`   | `claude/ping-pong-artifact-GgTZG` | Repo di sviluppo/artifact. Secondario. |

### ⚠️ Stato push dal container (aggiornato 2026-10-06)

Nelle sessioni **Claude Code on the web** (container remoto) il push è intermittente:

- Tutte le URL `https://github.com/` vengono riscritte da un **proxy git locale**
  (`url."http://local_proxy@127.0.0.1:<porta>/git/".insteadOf=https://github.com/`)
  che cambia porta a ogni sessione. Questo proxy è **autorizzato SOLO per
  `lettera7/ping-pong`**, non per `ping-pong-7`.
- Il proxy richiede inoltre una connessione GitHub attiva nella sessione; se scade
  ritorna `401/403` ("GitHub authentication required. Please reconnect your GitHub
  account."). In tal caso l'utente deve **riconnettere GitHub** dall'interfaccia web.
- Tentare di aggirare il proxy con un `GIT_CONFIG_GLOBAL` custom o un PAT inline
  viene **bloccato dal classificatore di sicurezza** (è intenzionale).

**Come andare in PRODUZIONE:** siccome dal container non si pusha su `ping-pong-7`,
usare l'**editor web di GitHub** su `github.com/lettera7/ping-pong-7` → modificare il
file → "Commit changes" su `main`. Vercel fa il deploy in ~15s. Dal Mac (git locale
autenticato) invece si pusha normalmente su entrambi i repo.

> ⚠️ ATTENZIONE: i commit fatti nel container ma non pushati possono andare persi se il
> branch viene resettato tra sessioni. Pusha (o fatti mandare il file) appena possibile.

---

## 3. Flusso dei dati

### Lettura (app → sheet), in `loadData()` `src/App.tsx`
1. **Cache-first**: se ci sono partite in `localStorage`, mostra subito la classifica (0 attesa).
2. `fetch(SCRIPT_URL + "?action=getRatings")` — carica i rating mensili storici (non bloccante).
3. `fetch(SCRIPT_URL)` (senza action) — l'Apps Script restituisce **tutte le partite in JSON**.
   Gira in **background** e aggiorna lo stato quando arriva (non blocca l'apertura).
4. Fallback (solo se non c'era cache): `fetch(SHEET_CSV_URL)` — export CSV pubblico.
5. Fallback finale: `localStorage` (chiave `pp_matches`, o `pp_matches_staging` in staging).

### Scrittura (app → sheet), in `saveMatch()` `src/App.tsx`
```ts
const p = new URLSearchParams({ action: "addMatch", matchId, date, playerA, playerB, scoreA, scoreB });
new Image().src = SCRIPT_URL + "?" + p.toString();
```

---

## 4. ⚠️ GOTCHA CRITICO: perché `new Image()` e NON `fetch()`

Questo è il bug che è costato più tempo. **Non cambiare questo pattern senza leggere qui.**

- Google Apps Script risponde a `doGet` con un **redirect 302 cross-origin** verso
  `script.googleusercontent.com`.
- `fetch(url, { mode: "no-cors" })` **NON segue i redirect cross-origin** in modalità no-cors
  → la richiesta non arriva mai allo script → **nessuna riga scritta, colonna UUID vuota**, in silenzio.
- `new Image().src = url` segue **tutti** i redirect indipendentemente da CORS (è il browser che
  carica una "immagine"), quindi raggiunge sempre lo script. È fire-and-forget: non possiamo
  leggere la risposta, ma la scrittura avviene.

### Conseguenza: i duplicati da iPhone
`new Image().src` è trattato da iOS Safari come caricamento di risorsa immagine. Su rete
lenta/instabile, **Safari ritenta la richiesta HTTP automaticamente 3-5 volte** (a livello
HTTP, non JS). Tutti i retry arrivano prima della prima scrittura → senza protezione si
creano righe duplicate. Questo spiega perché **i duplicati capitavano solo dall'iPhone**.

---

## 5. ⚠️ Deduplicazione (difesa a due livelli)

### Livello 1 — Client (`src/App.tsx`)
In `submitMatch()` si genera **un solo UUID per submit**:
```ts
const matchId = crypto.randomUUID();   // stesso ID su TUTTI i retry di Safari
saveMatch(match, matchId);
```
L'UUID viaggia come parametro `matchId` e finisce nella **colonna G** del foglio.

### Livello 2 — Server (Apps Script, vedi §6)
- `LockService.getScriptLock()` serializza le esecuzioni concorrenti (i retry non corrono in parallelo).
- Prima di scrivere, controlla se il `matchId` esiste già nelle ultime ~50 righe (colonna G).
  Se sì → ritorna `{status:"duplicate"}` senza inserire.

> ⚠️ Bug storico risolto: usare **`getDisplayValues()`** e NON `getValues()` per leggere la
> colonna. `getValues()` ritorna oggetti `Date` per le date → il confronto stringa falliva.

---

## 6. Google Apps Script (ESTERNO — non versionato, copia di riferimento)

Lo script vive su https://script.google.com (non in questo repo). Se va riscritto/redeployato,
questa è la logica di `addMatch`. **Dopo ogni modifica bisogna creare una NUOVA VERSIONE del
deployment** (Deploy → Manage Deployments → edit → "New version"), altrimenti le modifiche non
vanno live e la URL `/exec` continua a servire la versione vecchia.

> ⚠️ **BUG STORICO (riga 11, "action is not defined")**: la dichiarazione di `action`
> DEVE essere difensiva. Con `const action = e.parameter.action` se lo script viene
> eseguito senza `e` (es. pulsante "Run" nell'editor) o senza parametri, lancia
> `TypeError` e **tutte le sincronizzazioni falliscono in silenzio**. Usare sempre:
> `const action = (e && e.parameter && e.parameter.action) || "";`

```javascript
const SHEET_ID = "1TtBJ3nu1QzMLqm3Trrl7VTn_uW79xczifYHaq1YyJ6w";  // foglio LIVE ("Copia di…")

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "";   // difensivo, NON e.parameter.action secco

  if (action === "addMatch") {
    const matchId = e.parameter.matchId;
    const date = e.parameter.date;
    const playerA = e.parameter.playerA;
    const playerB = e.parameter.playerB;
    const scoreA = e.parameter.scoreA;
    const scoreB = e.parameter.scoreB;
    const winner = parseInt(scoreA) > parseInt(scoreB) ? playerA : playerB;
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Matches");
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);                       // serializza i retry concorrenti
      const lastRow = sheet.getLastRow();
      if (matchId && lastRow > 1) {
        const checkRows = Math.min(50, lastRow - 1);
        // getDisplayValues, NON getValues (date come stringa)
        const existing = sheet.getRange(lastRow - checkRows + 1, 1, checkRows, 7).getDisplayValues();
        for (const row of existing) {
          if (row[6] === matchId) {               // colonna G = matchId
            return ContentService.createTextOutput(JSON.stringify({ status: "duplicate", matchId }))
              .setMimeType(ContentService.MimeType.JSON);
          }
        }
      }
      sheet.appendRow([date, playerA, playerB, scoreA, scoreB, winner, matchId || ""]);
    } finally {
      lock.releaseLock();
    }
    return ContentService.createTextOutput(JSON.stringify({ status: "ok", matchId }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // action === "getRatings"  → ritorna la tab dei rating mensili come array 2D JSON
  // action === "setMonthlyRating" → upsert rating mensile (month, year, player, rating)
  // (nessuna action) → ritorna tutte le partite della tab "Matches" come array JSON
}
```

> Se i match non vengono letti dall'app (default doGet) verifica che lo script ritorni un
> **array JSON di partite** e che lo `SHEET_ID` sia corretto.

### URL di deployment correnti
- **Frontend** (`SCRIPT_URL` in `src/App.tsx` riga 6):
  `https://script.google.com/macros/s/AKfycbwSu9ClJ0sOlv-QAvG0HLIHAQmB2PwoDjdwi0pX4FmLmZsbdUlhYw7eUXFScmSAUZVAVA/exec`
- Sovrascrivibile con env `VITE_SCRIPT_URL`. Ogni nuovo deployment Apps Script genera una URL nuova → aggiornare qui.

---

## 7. Struttura del Google Sheet

- Spreadsheet ID: `1TtBJ3nu1QzMLqm3Trrl7VTn_uW79xczifYHaq1YyJ6w` (`SHEET_ID` in `src/App.tsx`, riga 9).
  È il foglio **"Copia di PING PONG — LUNCH LADDER"**, quello LIVE dove l'Apps Script scrive.
  ⚠️ Bug storico: l'app leggeva per errore l'originale `1V4OPHS3…` (congelato al 28/05) →
  mostrava dati vecchi. SHEET_ID nel codice e nell'Apps Script devono coincidere su `1TtBJ3…`.
- Tab **`Matches`**, colonne (l'app usa solo A–E + G): `Date, Player_A, Player_B, Score_A,
  Score_B, Winner, Loser, RA_prev, RB_prev, SA, SB, EA, EB, K, dA, dB, RA_new, RB_new`.
  La colonna **G (matchId/UUID)** è usata per la dedup. Il resto (RA_new ecc.) è ELO precalcolato
  nel foglio, non usato dall'app (che ricalcola da sé).
- Tab **`Rating x mese`**: una colonna per mese (header = nome mese IT: Ottobre, novembre, …,
  luglio, agosto, …), righe = giocatori + righe "1 posto"…"7 posto" per il podio.
  Parsata da `parseRatingsFromSheet()`. È qui che si scrivono le classifiche finali di fine mese.

---

## 8. Logica ELO (`replayMatches`, `currentMonthView`)

- ELO classico, **K = 24** (costante `K` in cima a `App.tsx`).
- **Reset mensile**: all'inizio di ogni nuovo mese tutti tornano a **1000**. La classifica del
  mese corrente è ricalcolata da 1000 in `currentMonthView` (useMemo).
- Formula per match (in ordine cronologico): `eA = 1/(1+10^((rB-rA)/400))`,
  `dA = round(K*((scoreA>scoreB?1:0) - eA))`, `ratings[A] += dA`, `ratings[B] -= dA`. `Math.round` JS.
- In `currentMonthView` il filtro `.filter(([name]) => (matchCounts[name]||0) > 0)` va **PRIMA**
  di `.sort()`/`.map()` — toglie dalla classifica chi non ha giocato nel mese.
- `MONTHLY_HISTORY_FALLBACK` contiene lo storico hardcoded usato se il foglio non risponde.
  I dati dal foglio (`sheetRatings`) hanno priorità e il fallback riempie i buchi.
- Niente pareggi (`scoreA === scoreB` viene rifiutato).

---

## 9. Bollettini (Supabase + Anthropic)

- `api/bulletins.ts`: CRUD bollettini (lista, dettaglio, publish/unpublish/delete) su Supabase.
- `api/generate.ts`: genera il testo del bollettino mensile con Claude (Anthropic).
- Tabella Supabase: `bulletins` (prod) / `bulletins_staging` (staging) — env `SUPABASE_BULLETINS_TABLE`.
- Cron mensile: `.github/workflows/monthly-bulletin.yml` (protetto da `CRON_SECRET`).

> ⚠️ **Supabase free-tier va in PAUSA dopo ~7 giorni di inattività.** Siccome i bollettini
> si generano una volta al mese, il progetto resta inattivo e si rimette in pausa → la
> sezione Bollettino mostra **"TypeError: fetch failed"** (host `<progetto>.supabase.co`
> irraggiungibile). Fix: Supabase dashboard → **Resume project** (~1-2 min). I dati restano
> salvi. Il messaggio statico "Configura su Vercel: ANTHROPIC_API_KEY…" sotto l'errore è
> solo un hint generico, NON significa che le env manchino. Soluzione definitiva: upgrade a
> Pro, oppure un cron settimanale "keep-alive" che fa una query banale a Supabase.

---

## 10. Variabili d'ambiente (vedi `.env.example`)

Frontend (`VITE_`, visibili nel browser): `VITE_IS_STAGING`, `VITE_SCRIPT_URL`, `VITE_SHEET_ID`.
Backend (serverless, segrete): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BULLETINS_TABLE`,
`SCRIPT_URL`, `ANTHROPIC_API_KEY`, `SLACK_WEBHOOK_URL`, `APP_URL`, `CRON_SECRET`.

I valori di produzione sono hardcoded come fallback nel codice; le env servono per override/staging.

---

## 11. PWA / icona home screen

- `index.html`: meta `apple-mobile-web-app-capable`, `apple-touch-icon`, `theme-color`, link al manifest.
- `public/manifest.webmanifest`: nome, colori, icona 512×512.
- `public/apple-touch-icon.png`: **sfondo scuro `#0D0D0D`, "PP" bianco + pallina con una singola
  linea diagonale dritta** (generata via Python stdlib struct+zlib, nessuna dipendenza esterna).
- Header con safe-area iPhone: `minHeight: calc(80px + env(safe-area-inset-top))`,
  `paddingTop: env(safe-area-inset-top)`, logo ancorato a `bottom: 5` (fix overlap icone native).
- `public/lettera7-loader.webm` (311K) è un **asset morto** (il loader è tutto SVG/CSS in
  `Lettera7Loader.tsx`): si può rimuovere.

---

## 12. Deploy

```bash
# Dal Mac (git autenticato): push su ping-pong-7/main → Vercel parte in automatico
git push origin main
# Dal container web: push solo su lettera7/ping-pong; per la PRODUZIONE usare l'editor web di GitHub.
```
Build: `npm run build` → `dist/` (vedi `vercel.json`). Vercel: framework `null`, output `dist`.

---

## 13. Cronologia recente e problemi aperti

### ✅ Fatto (giugno–ottobre 2026)
1. **Apps Script `action is not defined`** risolto con dichiarazione difensiva (§6).
2. **SHEET_ID** corretto su `1TtBJ3…` (foglio "Copia", live) — prima leggeva l'originale congelato.
3. **SCRIPT_URL** aggiornato al nuovo deployment.
4. **Safe area iPhone PWA** (header non più sotto le icone native).
5. **Filtro 0-partite** nella classifica mensile (commit utente `fa5eb7f`).
6. **Perf avvio (ott 2026)**: `loadData` ora è **cache-first** — mostra subito la classifica
   dalla cache `localStorage` e ricarica lo storico in background, senza il `minDelay` di 1,5s.
   Risolve la lentezza all'avvio cresciuta con l'accumularsi delle partite (~160 a maggio → ~540).
   Commit `2b59e79` su `lettera7/ping-pong`. **DA PORTARE IN PRODUZIONE** (ping-pong-7).
7. **Classifiche luglio/agosto 2026** ricalcolate (erano state dimenticate prima del reset):
   - **Luglio**: 1°Domitilla 1159, 2°Stefano 1124, 3°Martina 1082, 4°Luca 1043, 5°Dario 978,
     6°Daniele 848, 7°Domenico 766. (250 partite)
   - **Agosto**: 1°Luca 1071, 2°Domitilla 1009, 3°Stefano 1005, 4°Daniele 1001, 5°Martina 991,
     6°Domenico 988, 7°Dario 935. (26 partite, mese ferie a bassa attività)
   - Da scrivere nelle colonne "luglio"/"agosto" della tab "Rating x mese". **Domenico** è un
     giocatore nuovo senza riga propria in quella tab.

### Da verificare / aperti
- **Portare in produzione** la perf di avvio (punto 6) e, se non già fatto, le colonne
  luglio/agosto nel foglio.
- **Payload Apps Script**: il default `doGet` ritorna tutte le 18 colonne × ~540 righe. Si può
  alleggerire ritornando solo le 5 che servono (date, A, B, scoreA, scoreB) — miglioria futura.
- **Anomalia data "Sera"**: una riga del foglio ha `"Sera"` in colonna A invece di una data. Da bonificare.
- **Pulizia duplicati storici**: possibili duplicati residui su 04/06, 09/06, 10/06, 11/06, 13/05, 14/05, 07/05.
- **App Script non versionato**: vive solo su Google. Questo doc (§6) è l'unica copia di riferimento.

---

## 14. File chiave

| File | Cosa |
|------|------|
| `src/App.tsx` | Tutta l'app. `loadData` (~246, cache-first), `saveMatch`/`submitMatch` (~393/404), ELO in `replayMatches`/`currentMonthView` (~128/460). |
| `src/Lettera7Loader.tsx` | Schermata di caricamento (SVG/CSS, nessun video). |
| `api/bulletins.ts`, `api/generate.ts` | Backend bollettini (Vercel serverless). |
| `index.html`, `public/manifest.webmanifest`, `public/apple-touch-icon.png` | PWA + icona. |
| `.env.example` | Tutte le variabili d'ambiente documentate. |
| `vercel.json` | Config build/deploy. |
