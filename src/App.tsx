import { useState, useEffect, useCallback, CSSProperties } from "react";

const K = 24;
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyqms0XJa93Q48ruSOnYgfm4hi4HJ3B5jLXoZkk2GFIeDFO1eE23glP1RNkZ044vPAj/exec";
const SHEET_ID = "1V4OPHS3g55m5WxOBmPKLkBPvRtCB5jSHJ-c0FvXlN8c";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&sheet=Matches`;
const STORAGE_KEY = "pp_matches";

const Y = "#FEFE54";   // yellow
const K0 = "#0D0D0D";  // black
const GR = "#595959";  // gray — contrasto 7.0:1 su bianco (WCAG AAA)
const GR_ON_DARK = "#B8B8B8"; // grigio per testo su sfondo nero (5.4:1)
const LG = "#F5F5F0";  // light gray

const SEED_MATCHES: RawMatch[] = [
  { date:"05/05/2026", playerA:"Domitilla", playerB:"Stefano",   scoreA:11, scoreB:3  },
  { date:"05/05/2026", playerA:"Domitilla", playerB:"Martina",   scoreA:11, scoreB:8  },
  { date:"05/05/2026", playerA:"Domitilla", playerB:"Stefano",   scoreA:11, scoreB:9  },
  { date:"05/05/2026", playerA:"Dario",     playerB:"Daniele",   scoreA:9,  scoreB:11 },
  { date:"05/05/2026", playerA:"Daniele",   playerB:"Domitilla", scoreA:11, scoreB:6  },
  { date:"05/05/2026", playerA:"Dario",     playerB:"Stefano",   scoreA:11, scoreB:9  },
  { date:"05/05/2026", playerA:"Domitilla", playerB:"Dario",     scoreA:11, scoreB:3  },
  { date:"05/05/2026", playerA:"Stefano",   playerB:"Daniele",   scoreA:11, scoreB:8  },
  { date:"05/05/2026", playerA:"Luca",      playerB:"Daniele",   scoreA:12, scoreB:10 },
  { date:"05/05/2026", playerA:"Luca",      playerB:"Domitilla", scoreA:10, scoreB:12 },
  { date:"05/05/2026", playerA:"Stefano",   playerB:"Luca",      scoreA:10, scoreB:12 },
  { date:"05/05/2026", playerA:"Daniele",   playerB:"Domitilla", scoreA:4,  scoreB:11 },
  { date:"05/05/2026", playerA:"Luca",      playerB:"Domitilla", scoreA:8,  scoreB:11 },
  { date:"05/05/2026", playerA:"Stefano",   playerB:"Luca",      scoreA:8,  scoreB:11 },
  { date:"05/05/2026", playerA:"Domitilla", playerB:"Stefano",   scoreA:11, scoreB:9  },
  { date:"05/05/2026", playerA:"Luca",      playerB:"Domitilla", scoreA:12, scoreB:10 },
  { date:"05/05/2026", playerA:"Stefano",   playerB:"Domitilla", scoreA:6,  scoreB:11 },
  { date:"05/05/2026", playerA:"Luca",      playerB:"Stefano",   scoreA:11, scoreB:7  },
  { date:"05/05/2026", playerA:"Domitilla", playerB:"Luca",      scoreA:7,  scoreB:11 },
  { date:"05/05/2026", playerA:"Luca",      playerB:"Domitilla", scoreA:11, scoreB:7  },
];

const MONTHLY_HISTORY = [
  { month:"Aprile 2026",   winner:"Domitilla", standings:[["Domitilla",1147],["Luca",1034],["Stefano",1020],["Daniele",967],["Dario",947],["Martina",894]] },
  { month:"Marzo 2026",    winner:"Domitilla", standings:[["Domitilla",1084],["Luca",1036],["Dario",973],["Martina",954],["Stefano",953]] },
  { month:"Febbraio 2026", winner:"Domitilla", standings:[["Domitilla",null],["Luca",null],["Stefano",null],["Dario",null],["Martina",null],["Daniele",null]] },
  { month:"Gennaio 2026",  winner:"Luca",      standings:[["Luca",1158],["Daniele",1004],["Dario",1003],["Domitilla",997],["Stefano",946],["Martina",892]] },
  { month:"Dicembre 2025", winner:"Domitilla", standings:[["Domitilla",1046],["Luca",1033],["Daniele",998],["Stefano",994],["Dario",993],["Martina",981],["William",955]] },
  { month:"Novembre 2025", winner:"Domitilla", standings:[["Domitilla",1153],["William",1106],["Luca",1033],["Stefano",970],["Dario",938],["Daniele",928],["Martina",872]] },
  { month:"Ottobre 2025",  winner:"Luca", winnerNote:"(mini-finale)", standings:[["Domitilla",1173],["Luca",1117],["Stefano",1034],["Dario",903],["William",900],["Martina",873]] },
];

type RawMatch = { date: string; playerA: string; playerB: string; scoreA: number; scoreB: number };
type Match = RawMatch & { id: number; winner: string; rA: number; rB: number; newA: number; newB: number; dA: number; dB: number };
type PlayerStats = { rating: number; wins: number; losses: number; matches: number };
type GameState = { players: Record<string, PlayerStats>; matches: Match[] };

function replayMatches(rawMatches: RawMatch[]): GameState {
  const players: Record<string, PlayerStats> = {};
  const matches: Match[] = [];
  rawMatches.forEach((m, i) => {
    const { playerA, playerB, scoreA, scoreB, date } = m;
    if (!playerA || !playerB || isNaN(scoreA) || isNaN(scoreB) || scoreA === scoreB) return;
    if (!players[playerA]) players[playerA] = { rating: 1000, wins: 0, losses: 0, matches: 0 };
    if (!players[playerB]) players[playerB] = { rating: 1000, wins: 0, losses: 0, matches: 0 };
    const rA = players[playerA].rating, rB = players[playerB].rating;
    const sA = scoreA > scoreB ? 1 : 0;
    const eA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
    const dA = Math.round(K * (sA - eA));
    const newA = Math.round(rA + dA), newB = Math.round(rB - dA);
    const winner = scoreA > scoreB ? playerA : playerB;
    matches.push({ id: i, date, playerA, playerB, scoreA, scoreB, winner, rA, rB, newA, newB, dA, dB: -dA });
    players[playerA] = { ...players[playerA], rating: newA, matches: players[playerA].matches + 1, wins: players[playerA].wins + (scoreA > scoreB ? 1 : 0), losses: players[playerA].losses + (scoreB > scoreA ? 1 : 0) };
    players[playerB] = { ...players[playerB], rating: newB, matches: players[playerB].matches + 1, wins: players[playerB].wins + (scoreB > scoreA ? 1 : 0), losses: players[playerB].losses + (scoreA > scoreB ? 1 : 0) };
  });
  return { players, matches };
}

function parseCSV(csv: string): RawMatch[] {
  const lines = csv.trim().split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, "").toLowerCase());
  const idx = {
    date:    headers.findIndex(h => h === "date" || h === "data"),
    playerA: headers.findIndex(h => h === "player_a" || h === "playera"),
    playerB: headers.findIndex(h => h === "player_b" || h === "playerb"),
    scoreA:  headers.findIndex(h => h === "score_a" || h === "scorea"),
    scoreB:  headers.findIndex(h => h === "score_b" || h === "scoreb"),
  };
  if (idx.date < 0) idx.date = 0;
  if (idx.playerA < 0) idx.playerA = 1;
  if (idx.playerB < 0) idx.playerB = 2;
  if (idx.scoreA < 0) idx.scoreA = 3;
  if (idx.scoreB < 0) idx.scoreB = 4;
  return lines.slice(1).map(line => {
    const cols = line.split(",").map(c => c.trim().replace(/"/g, ""));
    return { date: cols[idx.date] ?? "", playerA: cols[idx.playerA] ?? "", playerB: cols[idx.playerB] ?? "", scoreA: parseInt(cols[idx.scoreA]), scoreB: parseInt(cols[idx.scoreB]) };
  }).filter(m => m.playerA && m.playerB && !isNaN(m.scoreA) && !isNaN(m.scoreB));
}

function formatDate(raw: string): string {
  if (!raw) return "";
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const ddmm = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmm) return `${ddmm[1].padStart(2,"0")} ${MONTHS[parseInt(ddmm[2])-1]} ${ddmm[3]}`;
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return `${String(d.getDate()).padStart(2,"0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return raw;
}

function loadFromStorage(): RawMatch[] {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : SEED_MATCHES; } catch { return SEED_MATCHES; }
}
function saveToStorage(m: RawMatch[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(m)); } catch { /* quota */ }
}

// ── UI primitives ──────────────────────────────────────────────────────────

function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const btn: CSSProperties = { width: 48, height: 48, background: "none", border: "none", fontSize: 24, cursor: "pointer", color: K0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, userSelect: "none" };
  return (
    <div role="group" aria-label={label} style={{ display: "flex", alignItems: "center", background: LG, flex: 1, justifyContent: "space-between" }}>
      <button type="button" aria-label={`Diminuisci punteggio ${label}`} style={btn} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
      <span aria-live="polite" aria-atomic="true" style={{ fontSize: 32, fontWeight: 500, minWidth: 40, textAlign: "center", fontFamily: "inherit" }}>{value}</span>
      <button type="button" aria-label={`Aumenta punteggio ${label}`} style={btn} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

function Toast({ msg }: { msg: string }) {
  return (
    <div role="status" aria-live="polite" style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", background: K0, color: Y, padding: "12px 20px", fontSize: 13, letterSpacing: "0.05em", zIndex: 999, whiteSpace: "nowrap", pointerEvents: "none" }}>
      {msg}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────

export default function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [view, setView] = useState<"standings" | "match" | "history" | "result">("standings");
  const [standingsTab, setStandingsTab] = useState<"current" | "history">("current");
  const [pA, setPA] = useState(""); const [pB, setPB] = useState("");
  const [sA, setSA] = useState(0); const [sB, setSB] = useState(0);
  const [newPlayer, setNewPlayer] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ winner: string; pA: string; pB: string; scoreA: number; scoreB: number; dA: number; dB: number; newA: number; newB: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  function showFlash(msg: string) { setFlash(msg); setTimeout(() => setFlash(null), 2500); }

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(SCRIPT_URL);
      if (!res.ok) throw new Error();
      const matches: RawMatch[] = await res.json();
      if (Array.isArray(matches) && matches.length > 0) {
        saveToStorage(matches);
        setState(replayMatches(matches));
        setLoading(false); return;
      }
    } catch { /* fallback */ }
    try {
      const res = await fetch(SHEET_CSV_URL);
      if (res.ok) {
        const parsed = parseCSV(await res.text());
        if (parsed.length > 0) { saveToStorage(parsed); setState(replayMatches(parsed)); setLoading(false); return; }
      }
    } catch { /* fallback */ }
    setState(replayMatches(loadFromStorage()));
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function saveMatch(match: Match) {
    setSaving(true);
    saveToStorage([...loadFromStorage(), { date: match.date, playerA: match.playerA, playerB: match.playerB, scoreA: match.scoreA, scoreB: match.scoreB }]);
    try {
      const p = new URLSearchParams({ action: "addMatch", date: match.date, playerA: match.playerA, playerB: match.playerB, scoreA: String(match.scoreA), scoreB: String(match.scoreB) });
      new Image().src = SCRIPT_URL + "?" + p.toString();
      showFlash("Partita salvata");
    } catch { showFlash("Salvato in locale"); }
    setSaving(false);
  }

  function submitMatch() {
    if (!state) return;
    if (!pA || !pB || pA === pB) return showFlash("Scegli due giocatori diversi");
    if (sA === sB) return showFlash("Niente pareggi");
    const { players, matches } = state;
    const rA = players[pA]?.rating ?? 1000, rB = players[pB]?.rating ?? 1000;
    const eA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
    const dA = Math.round(K * ((sA > sB ? 1 : 0) - eA));
    const newA = Math.round(rA + dA), newB = Math.round(rB - dA);
    const winner = sA > sB ? pA : pB;
    const date = new Date().toLocaleDateString("it-IT");
    const match: Match = { id: Date.now(), date, playerA: pA, playerB: pB, scoreA: sA, scoreB: sB, winner, rA, rB, newA, newB, dA, dB: -dA };
    setState({
      players: {
        ...players,
        [pA]: { ...(players[pA] ?? { rating: 1000, wins: 0, losses: 0, matches: 0 }), rating: newA, matches: (players[pA]?.matches ?? 0) + 1, wins: (players[pA]?.wins ?? 0) + (sA > sB ? 1 : 0), losses: (players[pA]?.losses ?? 0) + (sB > sA ? 1 : 0) },
        [pB]: { ...(players[pB] ?? { rating: 1000, wins: 0, losses: 0, matches: 0 }), rating: newB, matches: (players[pB]?.matches ?? 0) + 1, wins: (players[pB]?.wins ?? 0) + (sB > sA ? 1 : 0), losses: (players[pB]?.losses ?? 0) + (sA > sB ? 1 : 0) },
      },
      matches: [...matches, match],
    });
    setLastResult({ winner, pA, pB, scoreA: sA, scoreB: sB, dA, dB: -dA, newA, newB });
    setPA(""); setPB(""); setSA(0); setSB(0);
    saveMatch(match);
    setView("result");
  }

  function addPlayer() {
    if (!state) return;
    const name = newPlayer.trim();
    if (!name || state.players[name]) return showFlash("Nome non valido o già esistente");
    setState({ ...state, players: { ...state.players, [name]: { rating: 1000, wins: 0, losses: 0, matches: 0 } } });
    setNewPlayer(""); showFlash(name + " aggiunto");
  }

  const W: CSSProperties = { minHeight: "100dvh", background: "#fff", color: K0, fontFamily: "'Lettera7Diatype', 'Helvetica Neue', sans-serif", maxWidth: 600, margin: "0 auto", paddingBottom: 72, position: "relative" };

  if (loading) return (
    <div style={{ ...W, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
      <img src="/lettera7-01.png" alt="Lettera7" style={{ width: 120 }} />
      <div style={{ fontSize: 10, letterSpacing: "0.3em", color: GR, textTransform: "uppercase" }}>Caricamento…</div>
    </div>
  );

  const { players, matches } = state!;
  const standings = Object.entries(players).sort((a, b) => b[1].rating - a[1].rating);
  const [first, ...rest] = standings;

  return (
    <div style={W}>
      {flash && <Toast msg={flash} />}

      {/* ── HEADER (Figma: 80px) ───────────────────────────────────── */}
      <header style={{ height: 80, padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1.5px solid ${K0}`, position: "relative" }}>
        {/* Left: PING PONG / ELO / K=24 — 12px Medium, line-height 12px */}
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 500, lineHeight: "12px", textTransform: "uppercase", letterSpacing: "0.02em" }}>Ping Pong</span>
          <span style={{ fontSize: 12, fontWeight: 500, lineHeight: "16px", textTransform: "uppercase", letterSpacing: "0.02em" }}>ELO</span>
          <span style={{ fontSize: 12, fontWeight: 500, lineHeight: "12px", textTransform: "uppercase", letterSpacing: "0.02em" }}>K=24</span>
        </div>
        {/* Center: logo 94×70, top:5 */}
        <img src="/lettera7-01.png" alt="Lettera7" style={{ position: "absolute", left: "50%", top: 5, transform: "translateX(-50%)", width: 94, height: 70, objectFit: "contain" }} />
        {/* Right: yellow UPDATE button 71×48 */}
        <button type="button" onClick={loadData} aria-label="Aggiorna dati" style={{ background: Y, border: "none", width: 71, height: 48, fontFamily: "inherit", fontSize: 12, fontWeight: 500, letterSpacing: "0.02em", textTransform: "uppercase", cursor: "pointer", color: K0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          Update
        </button>
      </header>

      <main id="main">

      {/* ── RESULT ─────────────────────────────────────────────────── */}
      {view === "result" && lastResult && (
        <div>
          <div style={{ background: K0, padding: "40px 20px 32px" }}>
            <div style={{ fontSize: 9, letterSpacing: "0.3em", color: GR_ON_DARK, textTransform: "uppercase", marginBottom: 8 }}>Risultato</div>
            <div style={{ fontSize: 52, letterSpacing: "-0.03em", lineHeight: 1, color: Y, marginBottom: 4 }}>{lastResult.winner}</div>
            <div style={{ fontSize: 72, letterSpacing: "-0.04em", lineHeight: 1, color: "#fff" }}>{lastResult.scoreA}–{lastResult.scoreB}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: `1.5px solid ${K0}` }}>
            {([{ name: lastResult.pA, d: lastResult.dA, r: lastResult.newA }, { name: lastResult.pB, d: lastResult.dB, r: lastResult.newB }]).map((p, i) => (
              <div key={p.name} style={{ padding: "20px 20px", borderRight: i === 0 ? `1.5px solid ${K0}` : "none", background: p.name === lastResult.winner ? Y : "#fff" }}>
                <div style={{ fontSize: 10, letterSpacing: "0.2em", color: p.name === lastResult.winner ? K0 : GR, textTransform: "uppercase", marginBottom: 6 }}>{p.name}</div>
                <div style={{ fontSize: 36, letterSpacing: "-0.02em", lineHeight: 1 }}>{p.r}</div>
                <div style={{ fontSize: 14, marginTop: 4, color: p.d >= 0 ? "#1a7a1a" : "#c0392b" }}>{p.d >= 0 ? "+" : ""}{p.d}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: "16px 20px", display: "flex", gap: 12 }}>
            <button type="button" onClick={() => setView("match")} style={solidBtn(K0, "#fff")}>Nuova partita</button>
            <button type="button" onClick={() => setView("standings")} style={solidBtn(Y, K0)}>Classifica</button>
          </div>
        </div>
      )}

      {/* ── STANDINGS ──────────────────────────────────────────────── */}
      {view === "standings" && (
        <div>
          {/* Tab row — Figma: 48px height, 12px Medium */}
          <div role="tablist" aria-label="Tipologia classifica" style={{ display: "flex", height: 48, borderBottom: `1.5px solid ${K0}` }}>
            {(["current", "history"] as const).map(t => {
              const active = standingsTab === t;
              return (
                <button key={t} type="button" role="tab" aria-selected={active} onClick={() => setStandingsTab(t)} style={{ flex: 1, height: 48, background: active ? Y : "#fff", border: "none", borderRight: t === "current" ? `1.5px solid ${K0}` : "none", fontFamily: "inherit", fontSize: 12, fontWeight: 500, letterSpacing: "0.02em", textTransform: "uppercase", cursor: "pointer", color: active ? K0 : GR }}>
                  {t === "current" ? "Maggio 2026" : "Storico mensile"}
                </button>
              );
            })}
          </div>

          {standingsTab === "current" && (
            <>
              {/* #1 hero card — Figma: 94px tall, yellow full bleed */}
              {first && (
                <section aria-label="Primo classificato" style={{ background: Y, height: 94, position: "relative", borderBottom: `1.5px solid ${K0}` }}>
                  <div style={{ position: "absolute", left: 20, top: 40, fontSize: 16, fontWeight: 500, lineHeight: 1 }}>1°</div>
                  <h1 style={{ position: "absolute", left: 48, top: 20, fontSize: 36, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1, fontFamily: "inherit", margin: 0 }}>{first[0]}</h1>
                  <div style={{ position: "absolute", right: 20, top: 28, fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1 }} aria-label={`Punteggio ELO ${first[1].rating}`}>{first[1].rating}</div>
                  <div style={{ position: "absolute", left: 48, top: 62, fontSize: 8, fontWeight: 300, letterSpacing: "0.05em", lineHeight: 1 }} aria-label={`${first[1].matches} partite, ${first[1].wins} vittorie, ${first[1].losses} sconfitte`}>
                    {first[1].matches}P · {first[1].wins}V · {first[1].losses}S · {first[1].matches ? Math.round(first[1].wins / first[1].matches * 100) : 0}%
                  </div>
                </section>
              )}

              {/* Remaining players — Figma: 56px row */}
              <ol style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Altri giocatori in classifica">
                {rest.map(([name, p], i) => (
                  <li key={name} style={{ height: 56, position: "relative", borderBottom: `1.5px solid #e8e8e8` }}>
                    <span aria-label={`Posizione ${i + 2}`} style={{ position: "absolute", left: 20, top: 19, fontSize: 12, fontWeight: 500, lineHeight: 1 }}>{i + 2}°</span>
                    <span style={{ position: "absolute", left: 48, top: 14, fontSize: 18, fontWeight: 500, letterSpacing: "-0.01em", lineHeight: 1 }}>{name}</span>
                    <span aria-label={`${p.matches} partite, ${p.wins} vittorie, ${p.losses} sconfitte`} style={{ position: "absolute", left: 48, top: 36, fontSize: 8, fontWeight: 300, color: GR, letterSpacing: "0.05em", lineHeight: 1 }}>{p.matches}P · {p.wins}V · {p.losses}S · {p.matches ? Math.round(p.wins / p.matches * 100) : 0}%</span>
                    <span aria-label={`Punteggio ${p.rating}`} style={{ position: "absolute", right: 20, top: 18, fontSize: 22, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1 }}>{p.rating}</span>
                  </li>
                ))}
              </ol>

              {/* Add player — Figma exact */}
              <form onSubmit={(e) => { e.preventDefault(); addPlayer(); }} style={{ borderTop: `1.5px solid ${K0}`, padding: "0 20px" }}>
                <label htmlFor="new-player" style={{ display: "block", fontSize: 8, fontWeight: 300, letterSpacing: "0.15em", color: GR, textTransform: "uppercase", marginTop: 20, marginBottom: 6 }}>
                  Aggiungi giocatore
                </label>
                <div style={{ display: "flex", gap: 0, marginBottom: 20 }}>
                  <input
                    id="new-player"
                    name="newPlayer"
                    type="text"
                    value={newPlayer}
                    onChange={e => setNewPlayer(e.target.value)}
                    placeholder="Nome"
                    autoComplete="off"
                    style={{ flex: 1, height: 48, background: LG, border: "none", padding: "0 12px", fontSize: 14, fontWeight: 300, fontFamily: "inherit", color: K0, outline: "none" }}
                  />
                  <button type="submit" aria-label="Aggiungi giocatore" style={{ width: 48, height: 48, background: K0, color: "#fff", border: "none", fontFamily: "inherit", fontSize: 20, fontWeight: 300, cursor: "pointer", flexShrink: 0 }}>+</button>
                </div>
              </form>
            </>
          )}

          {standingsTab === "history" && (() => {
            const wins: Record<string, number> = {};
            MONTHLY_HISTORY.forEach(m => { if (m.winner) wins[m.winner] = (wins[m.winner] || 0) + 1; });
            const [champ, champWins] = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
            return (
              <>
                {/* Champion banner */}
                <div style={{ background: K0, padding: "24px 20px", borderBottom: `1.5px solid ${K0}` }}>
                  <div style={{ fontSize: 9, letterSpacing: "0.3em", color: GR_ON_DARK, textTransform: "uppercase", marginBottom: 6 }}>Campione Overall</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 32, color: Y, letterSpacing: "-0.02em" }}>{champ}</div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 36, color: Y, letterSpacing: "-0.02em", lineHeight: 1 }}>{champWins}</div>
                      <div style={{ fontSize: 9, color: GR_ON_DARK, letterSpacing: "0.2em", textTransform: "uppercase", marginTop: 2 }}>mesi vinti</div>
                    </div>
                  </div>
                </div>
                {/* Monthly list */}
                {MONTHLY_HISTORY.map(month => (
                  <div key={month.month} style={{ borderBottom: `1px solid #e8e8e8` }}>
                    <div style={{ background: LG, padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>{month.month}</div>
                      {month.winner && <div style={{ background: Y, fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", padding: "4px 8px", color: K0 }}><span aria-hidden="true">🏆 </span>{month.winner}{month.winnerNote ? " " + month.winnerNote : ""}</div>}
                    </div>
                    {month.standings.map(([name, rating], i) => (
                      <div key={name as string} style={{ display: "flex", alignItems: "center", padding: "12px 20px", borderTop: "1px solid #efefef", gap: 14 }}>
                        <span style={{ fontSize: 10, color: i === 0 ? K0 : GR, width: 22, flexShrink: 0 }}>{i + 1}°</span>
                        <span style={{ flex: 1, fontSize: 15, fontWeight: i === 0 ? 500 : 300 }}>{name as string}</span>
                        <span style={{ fontSize: 16 }}>{rating ?? "–"}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            );
          })()}
        </div>
      )}

      {/* ── MATCH ──────────────────────────────────────────────────── */}
      {view === "match" && (
        <div>
          {/* Yellow header */}
          <div style={{ background: Y, padding: "24px 20px 20px", borderBottom: `1.5px solid ${K0}` }}>
            <div style={{ fontSize: 9, letterSpacing: "0.3em", textTransform: "uppercase", color: K0, opacity: 0.7, marginBottom: 4 }}>Registra</div>
            <h1 style={{ fontSize: 28, letterSpacing: "-0.02em", fontWeight: 500, fontFamily: "inherit" }}>Nuova partita</h1>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); submitMatch(); }} style={{ padding: "20px" }} noValidate>
            {/* Player selectors */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "end", marginBottom: 20 }}>
              <div>
                <label htmlFor="player-a" style={labelStyle}>Giocatore A</label>
                <select id="player-a" name="playerA" value={pA} onChange={e => setPA(e.target.value)} style={selectStyle} required aria-required="true">
                  <option value="">—</option>
                  {Object.keys(players).filter(n => n !== pB).map(n => <option key={n}>{n}</option>)}
                </select>
              </div>
              <div aria-hidden="true" style={{ fontSize: 11, color: GR, paddingBottom: 14, letterSpacing: "0.1em" }}>VS</div>
              <div>
                <label htmlFor="player-b" style={labelStyle}>Giocatore B</label>
                <select id="player-b" name="playerB" value={pB} onChange={e => setPB(e.target.value)} style={selectStyle} required aria-required="true">
                  <option value="">—</option>
                  {Object.keys(players).filter(n => n !== pA).map(n => <option key={n}>{n}</option>)}
                </select>
              </div>
            </div>

            {/* ELO preview */}
            {pA && pB && (
              <div role="status" aria-live="polite" style={{ display: "flex", justifyContent: "space-between", background: LG, padding: "10px 14px", marginBottom: 20, fontSize: 11 }}>
                <span style={{ letterSpacing: "0.05em" }}>{pA} <span style={{ color: GR }}>{players[pA]?.rating ?? 1000}</span></span>
                <span style={{ letterSpacing: "0.05em" }}>{pB} <span style={{ color: GR }}>{players[pB]?.rating ?? 1000}</span></span>
              </div>
            )}

            {/* Score steppers */}
            <fieldset style={{ border: "none", padding: 0, margin: 0, marginBottom: 28 }}>
              <legend style={{ ...labelStyle, marginBottom: 8 }}>Punteggio</legend>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center" }}>
                <Stepper value={sA} onChange={setSA} label={pA || "Giocatore A"} />
                <span aria-hidden="true" style={{ fontSize: 11, color: GR, letterSpacing: "0.1em" }}>–</span>
                <Stepper value={sB} onChange={setSB} label={pB || "Giocatore B"} />
              </div>
            </fieldset>

            <button type="submit" disabled={saving} style={solidBtn(saving ? GR : K0, "#fff")}>
              {saving ? "Salvataggio…" : "Registra partita"}
            </button>
          </form>
        </div>
      )}

      {/* ── HISTORY ────────────────────────────────────────────────── */}
      {view === "history" && (
        <div>
          <div style={{ background: K0, padding: "24px 20px 20px", borderBottom: `1.5px solid ${K0}` }}>
            <div style={{ fontSize: 9, letterSpacing: "0.3em", textTransform: "uppercase", color: GR_ON_DARK, marginBottom: 4 }}>Archivio</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 style={{ fontSize: 28, color: "#fff", letterSpacing: "-0.02em", fontWeight: 500, fontFamily: "inherit" }}>Storico partite</h2>
              <div style={{ fontSize: 11, color: GR_ON_DARK }}>{matches.length} partite</div>
            </div>
          </div>
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Elenco partite">
            {[...matches].reverse().map((m) => (
              <li key={m.id} style={{ padding: "14px 20px", borderBottom: `1px solid #e8e8e8`, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, letterSpacing: "-0.01em" }} aria-label={`${m.winner} ha vinto contro ${m.winner === m.playerA ? m.playerB : m.playerA}`}>
                    <span style={{ fontWeight: m.winner === m.playerA ? 500 : 300, color: m.winner === m.playerA ? K0 : GR }}>{m.playerA}</span>
                    <span aria-hidden="true" style={{ color: "#999", margin: "0 6px", fontWeight: 300 }}>·</span>
                    <span style={{ fontWeight: m.winner === m.playerB ? 500 : 300, color: m.winner === m.playerB ? K0 : GR }}>{m.playerB}</span>
                  </div>
                  <div style={{ fontSize: 10, color: GR, marginTop: 4, letterSpacing: "0.1em", display: "flex", gap: 10 }}>
                    <time>{formatDate(m.date)}</time>
                    <span style={{ color: m.dA >= 0 ? "#1a7a1a" : "#c0392b" }} aria-label={`${m.playerA} ${m.dA >= 0 ? "guadagna" : "perde"} ${Math.abs(m.dA)} punti ELO`}>{m.playerA} {m.dA >= 0 ? "+" : ""}{m.dA}</span>
                  </div>
                </div>
                <div style={{ fontSize: 20, letterSpacing: "-0.02em", flexShrink: 0 }} aria-label={`Punteggio finale ${m.scoreA} a ${m.scoreB}`}>{m.scoreA}–{m.scoreB}</div>
              </li>
            ))}
            {matches.length === 0 && <li style={{ padding: "40px 20px", textAlign: "center", fontSize: 13, color: GR }}>Nessuna partita registrata</li>}
          </ol>
        </div>
      )}

      </main>

      {/* ── BOTTOM NAV — Figma: 72px tall ───────────────────────────── */}
      <nav aria-label="Navigazione principale" style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 600, height: 72, background: "#fff", borderTop: `1.5px solid ${K0}`, display: "flex", zIndex: 100, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {([
          { id: "standings", label: "Classifica", icon: "◈" },
          { id: "match",     label: "Partita",    icon: "◉" },
          { id: "history",   label: "Storico",    icon: "◫" },
        ] as const).map(t => {
          const active = view === t.id || (view === "result" && t.id === "standings");
          return (
            <button key={t.id} type="button" onClick={() => setView(t.id)} aria-current={active ? "page" : undefined} style={{ flex: 1, height: 71, background: active ? Y : "#fff", border: "none", borderRight: t.id !== "history" ? `1.5px solid ${K0}` : "none", cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, position: "relative" }}>
              <span aria-hidden="true" style={{ fontSize: 16, fontWeight: 300, color: K0, lineHeight: 1 }}>{t.icon}</span>
              <span style={{ fontSize: 8, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: K0, lineHeight: 1 }}>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

const solidBtn = (bg: string, color: string): CSSProperties => ({
  display: "block", width: "100%", padding: "16px 0", background: bg, color, border: "none",
  fontFamily: "'Lettera7Diatype', 'Helvetica Neue', sans-serif", fontSize: 11,
  letterSpacing: "0.2em", textTransform: "uppercase", cursor: "pointer", transition: "opacity 0.15s",
});

const inputStyle: CSSProperties = {
  width: "100%", background: LG, border: "none", borderBottom: `2px solid ${K0}`,
  color: K0, padding: "12px 10px", fontSize: 16, fontFamily: "'Lettera7Diatype', 'Helvetica Neue', sans-serif",
  outline: "none",
};

const selectStyle: CSSProperties = {
  width: "100%", background: LG, border: "none", borderBottom: `2px solid ${K0}`,
  color: K0, padding: "12px 10px", fontSize: 15, fontFamily: "'Lettera7Diatype', 'Helvetica Neue', sans-serif",
  appearance: "none", outline: "none", cursor: "pointer",
};

const labelStyle: CSSProperties = {
  display: "block", fontSize: 11, letterSpacing: "0.2em", color: GR, textTransform: "uppercase", marginBottom: 8,
};
