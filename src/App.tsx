import { useState, useEffect, useCallback, useMemo } from "react";

const K = 24;
const IS_STAGING = window.location.hostname === "localhost";
const SCRIPT_URL = import.meta.env.VITE_SCRIPT_URL ?? "https://script.google.com/macros/s/AKfycbyHZqlAgOyybQOIfuKf58XczbKCl3EE1WXRIFab0kEptnBu4uSLuAhAX85kX2ZlyD9DLw/exec";
const YELLOW = "#F5E642";
const BLACK = "#0D0D0D";
const GRAY = "#888";
const LGRAY = "#f5f5f5";
const STORAGE_KEY = IS_STAGING ? "pp_matches_staging" : "pp_matches";
const RATINGS_KEY = "pp_monthly_ratings";
const MONTHS_IT = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

function getCurrentMonthLabel(): string {
  const now = new Date();
  return `${MONTHS_IT[now.getMonth()]} ${now.getFullYear()}`;
}

function getMatchMonthLabel(dateStr: string): string {
  const parts = dateStr.split("/");
  if (parts.length !== 3) return "";
  const m = parseInt(parts[1]) - 1;
  const y = parseInt(parts[2]);
  if (isNaN(m) || isNaN(y) || m < 0 || m > 11) return "";
  return `${MONTHS_IT[m]} ${y}`;
}

const SEED_MATCHES = [
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

type RawMatch = { date: string; playerA: string; playerB: string; scoreA: number; scoreB: number };
type Match = RawMatch & { id: number; winner: string; rA: number; rB: number; newA: number; newB: number; dA: number; dB: number };
type PlayerStats = { rating: number; wins: number; losses: number; matches: number };
type GameState = { players: Record<string, PlayerStats>; matches: Match[] };
type MonthlyRecord = { month: string; winner: string; winnerNote?: string; standings: [string, number | null][] };

// Source of truth for historical months — winners manually curated
const MONTHLY_HISTORY_FALLBACK: MonthlyRecord[] = [
  { month:"Maggio 2026",   winner:"Luca",      standings:[["Luca",1154],["Domitilla",1122],["Stefano",1004],["Martina",955],["Daniele",895],["Dario",870]] },
  { month:"Aprile 2026",   winner:"Domitilla", standings:[["Domitilla",1147],["Luca",1034],["Stefano",1020],["Daniele",967],["Dario",947],["Martina",894]] },
  { month:"Marzo 2026",    winner:"Domitilla", standings:[["Domitilla",1084],["Luca",1036],["Dario",973],["Martina",954],["Stefano",953]] },
  { month:"Febbraio 2026", winner:"Domitilla", standings:[["Domitilla",null],["Luca",null],["Stefano",null],["Dario",null],["Martina",null],["Daniele",null]] },
  { month:"Gennaio 2026",  winner:"Luca",      standings:[["Luca",1158],["Daniele",1004],["Dario",1003],["Domitilla",997],["Stefano",946],["Martina",892]] },
  { month:"Dicembre 2025", winner:"Domitilla", standings:[["Domitilla",1046],["Luca",1033],["Daniele",998],["Stefano",994],["Dario",993],["Martina",981],["William",955]] },
  { month:"Novembre 2025", winner:"Domitilla", standings:[["Domitilla",1153],["William",1106],["Luca",1033],["Stefano",970],["Dario",938],["Daniele",928],["Martina",872]] },
  { month:"Ottobre 2025",  winner:"Luca",      winnerNote:"(mini-finale)", standings:[["Domitilla",1173],["Luca",1117],["Stefano",1034],["Dario",903],["William",900],["Martina",873]] },
];

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

function loadFromStorage(): RawMatch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : SEED_MATCHES;
  } catch {
    return SEED_MATCHES;
  }
}

function saveToStorage(matches: RawMatch[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(matches));
  } catch { /* quota exceeded */ }
}

function loadCachedRatings(): MonthlyRecord[] {
  try {
    const raw = localStorage.getItem(RATINGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function parseRatingsFromSheet(table: (string | number)[][]): MonthlyRecord[] {
  if (table.length < 2) return [];
  const monthMap: Record<string, number> = {};
  MONTHS_IT.forEach((m, i) => { monthMap[m.toLowerCase()] = i; });
  const headers = table[0];
  const playerRows = table.slice(1).filter(r => {
    const name = String(r[0] || "").trim();
    return name && !name.toLowerCase().includes("posto");
  });
  const records: MonthlyRecord[] = [];
  let year = 2025;
  let prevMonthIdx = -1;
  for (let col = 1; col < headers.length; col++) {
    const hdr = String(headers[col] || "").toLowerCase().trim();
    const monthIdx = monthMap[hdr];
    if (monthIdx === undefined) continue;
    if (prevMonthIdx !== -1 && monthIdx < prevMonthIdx) year++;
    prevMonthIdx = monthIdx;
    const standings: [string, number | null][] = playerRows
      .map(r => {
        const name = String(r[0] || "").trim();
        const v = r[col];
        const rating = typeof v === "number" ? v : parseInt(String(v || ""));
        return [name, isNaN(rating) ? null : rating] as [string, number | null];
      })
      .filter(([, r]) => r !== null)
      .sort((a, b) => (b[1] as number) - (a[1] as number));
    if (standings.length === 0) continue;
    const monthName = `${MONTHS_IT[monthIdx]} ${year}`;
    // Preserve manually curated winner (handles mini-finale etc.)
    const fallback = MONTHLY_HISTORY_FALLBACK.find(h => h.month === monthName);
    records.push({
      month: monthName,
      winner: fallback?.winner ?? standings[0][0],
      winnerNote: fallback?.winnerNote,
      standings,
    });
  }
  return records.reverse();
}

function computeMonthlyHistory(): MonthlyRecord[] {
  const sheet = loadCachedRatings();
  if (sheet.length > 0) {
    const sheetMonths = new Set(sheet.map(r => r.month));
    return [...sheet, ...MONTHLY_HISTORY_FALLBACK.filter(h => !sheetMonths.has(h.month))];
  }
  return MONTHLY_HISTORY_FALLBACK;
}

function syncMonthlyRatingsToSheet(monthName: string, standings: [string, number | null][]) {
  const SYNC_KEY = `pp_synced_${monthName}`;
  const last = localStorage.getItem(SYNC_KEY);
  if (last && Date.now() - parseInt(last) < 3600000) return;
  standings.forEach(([name, rating]) => {
    if (rating === null) return;
    const params = new URLSearchParams({ action: "setMonthlyRating", month: monthName, player: name, rating: String(rating) });
    new Image().src = SCRIPT_URL + "?" + params.toString();
  });
  localStorage.setItem(SYNC_KEY, String(Date.now()));
}

function maybeSyncCompletedMonths(rawMatches: RawMatch[]) {
  const currentMonth = getCurrentMonthLabel();
  const cachedMonths = new Set(loadCachedRatings().map(r => r.month));
  const monthsWithMatches: Record<string, RawMatch[]> = {};
  rawMatches.forEach(m => {
    const label = getMatchMonthLabel(m.date);
    if (label && label !== currentMonth) {
      if (!monthsWithMatches[label]) monthsWithMatches[label] = [];
      monthsWithMatches[label].push(m);
    }
  });
  Object.entries(monthsWithMatches).forEach(([month, ms]) => {
    if (cachedMonths.has(month)) return;
    const monthState = replayMatches(ms);
    const standings = Object.entries(monthState.players)
      .sort((a, b) => b[1].rating - a[1].rating)
      .map(([name, p]) => [name, p.rating] as [string, number | null]);
    syncMonthlyRatingsToSheet(month, standings);
  });
}

export default function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [view, setView] = useState("standings");
  const [standingsTab, setStandingsTab] = useState("current");
  const [pA, setPA] = useState(""); const [pB, setPB] = useState("");
  const [sA, setSA] = useState(""); const [sB, setSB] = useState("");
  const [newPlayer, setNewPlayer] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ winner: string; pA: string; pB: string; scoreA: number; scoreB: number; dA: number; dB: number; newA: number; newB: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheetRatings, setSheetRatings] = useState<MonthlyRecord[]>(() => loadCachedRatings());

  function showFlash(msg: string) { setFlash(msg); setTimeout(() => setFlash(null), 2500); }

  const loadData = useCallback(() => {
    const raw = loadFromStorage();
    setState(replayMatches(raw));
    maybeSyncCompletedMonths(raw);
    fetch(SCRIPT_URL + "?action=getRatings").then(r => r.json()).then((data: (string | number)[][]) => {
      if (Array.isArray(data) && data.length > 1) {
        const records = parseRatingsFromSheet(data);
        if (records.length > 0) {
          localStorage.setItem(RATINGS_KEY, JSON.stringify(records));
          setSheetRatings(records);
        }
      }
    }).catch(() => { /* offline — use cache */ });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Current month state: replay only this month's matches from 1000
  const currentMonthState = useMemo(() => {
    if (!state) return null;
    const currentMonth = getCurrentMonthLabel();
    const raw = loadFromStorage();
    const monthMatches = raw.filter(m => getMatchMonthLabel(m.date) === currentMonth);
    const gs = replayMatches(monthMatches);
    // Ensure all known players appear at 1000 even with no matches yet
    const allPlayers = { ...gs.players };
    Object.keys(state.players).forEach(name => {
      if (!allPlayers[name]) allPlayers[name] = { rating: 1000, wins: 0, losses: 0, matches: 0 };
    });
    return { ...gs, players: allPlayers };
  }, [state]);

  // Monthly history: sheet data merged with fallback (sheet takes priority)
  const monthlyHistory = useMemo(() => {
    if (sheetRatings.length > 0) {
      const sheetMonths = new Set(sheetRatings.map(r => r.month));
      return [...sheetRatings, ...MONTHLY_HISTORY_FALLBACK.filter(h => !sheetMonths.has(h.month))];
    }
    return MONTHLY_HISTORY_FALLBACK;
  }, [sheetRatings]);

  async function saveMatch(match: Match) {
    setSaving(true);
    const existing = loadFromStorage();
    const updated: RawMatch[] = [...existing, { date: match.date, playerA: match.playerA, playerB: match.playerB, scoreA: match.scoreA, scoreB: match.scoreB }];
    saveToStorage(updated);
    try {
      const params = new URLSearchParams({
        action: "addMatch",
        date: match.date,
        playerA: match.playerA,
        playerB: match.playerB,
        scoreA: String(match.scoreA),
        scoreB: String(match.scoreB),
      });
      new Image().src = SCRIPT_URL + "?" + params.toString();
    } catch { /* best-effort */ }
    showFlash("Partita salvata!");
    setSaving(false);
  }

  function submitMatch() {
    if (!state || !currentMonthState) return;
    const scoreA = parseInt(sA), scoreB = parseInt(sB);
    if (!pA || !pB || pA === pB) return showFlash("Scegli due giocatori diversi.");
    if (isNaN(scoreA) || isNaN(scoreB) || scoreA < 0 || scoreB < 0) return showFlash("Punteggi non validi.");
    if (scoreA === scoreB) return showFlash("Niente pareggi.");
    // Use monthly-reset ratings for ELO calculation
    const rA = currentMonthState.players[pA]?.rating ?? 1000;
    const rB = currentMonthState.players[pB]?.rating ?? 1000;
    const sAv = scoreA > scoreB ? 1 : 0;
    const eA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
    const dA = Math.round(K * (sAv - eA));
    const newA = Math.round(rA + dA), newB = Math.round(rB - dA);
    const winner = scoreA > scoreB ? pA : pB;
    const date = new Date().toLocaleDateString("it-IT");
    const match: Match = { id: Date.now(), date, playerA: pA, playerB: pB, scoreA, scoreB, winner, rA, rB, newA, newB, dA, dB: -dA };
    const { players, matches } = state;
    setState({
      players: {
        ...players,
        [pA]: { ...(players[pA] ?? { rating: 1000, wins: 0, losses: 0, matches: 0 }), rating: players[pA]?.rating ?? 1000, matches: (players[pA]?.matches ?? 0) + 1, wins: (players[pA]?.wins ?? 0) + (scoreA > scoreB ? 1 : 0), losses: (players[pA]?.losses ?? 0) + (scoreB > scoreA ? 1 : 0) },
        [pB]: { ...(players[pB] ?? { rating: 1000, wins: 0, losses: 0, matches: 0 }), rating: players[pB]?.rating ?? 1000, matches: (players[pB]?.matches ?? 0) + 1, wins: (players[pB]?.wins ?? 0) + (scoreB > scoreA ? 1 : 0), losses: (players[pB]?.losses ?? 0) + (scoreA > scoreB ? 1 : 0) },
      },
      matches: [...matches, match],
    });
    setLastResult({ winner, pA, pB, scoreA, scoreB, dA, dB: -dA, newA, newB });
    setPA(""); setPB(""); setSA(""); setSB("");
    saveMatch(match);
    setView("result");
  }

  function addPlayer() {
    if (!state) return;
    const name = newPlayer.trim();
    if (!name || state.players[name]) return showFlash("Nome non valido o già esistente.");
    setState({ ...state, players: { ...state.players, [name]: { rating: 1000, wins: 0, losses: 0, matches: 0 } } });
    setNewPlayer(""); showFlash(name + " aggiunto!");
  }

  if (!state || !currentMonthState) return (
    <div style={{ minHeight: "100vh", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif" }}>
      <div style={{ fontWeight: 900, fontSize: 32, letterSpacing: -2, marginBottom: 16 }}>PING PONG</div>
      <div style={{ fontSize: 11, letterSpacing: 3, color: GRAY, textTransform: "uppercase" }}>Caricamento...</div>
    </div>
  );

  const { players, matches } = state;
  const currentMonthLabel = getCurrentMonthLabel();
  const currentStandings = Object.entries(currentMonthState.players).sort((a, b) => b[1].rating - a[1].rating);

  return (
    <div style={{ minHeight: "100vh", background: "#fff", color: BLACK, fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif", maxWidth: 480, margin: "0 auto", paddingBottom: 80 }}>

      {/* HEADER */}
      <div style={{ padding: "28px 20px 16px", display: "flex", flexDirection: "column", alignItems: "center", borderBottom: `2px solid ${BLACK}` }}>
        <img src="https://www.lettera7.design/wp-content/uploads/2022/01/logo-lettera7.png" alt="Lettera7" style={{ width: 180, height: "auto" }} />
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontWeight: 900, fontSize: 22, letterSpacing: -0.5, textTransform: "uppercase" }}>Ping Pong</div>
          <div style={{ background: YELLOW, fontSize: 9, fontWeight: 900, letterSpacing: 3, textTransform: "uppercase", padding: "4px 10px" }}>ELO K=24</div>
        </div>
        <button onClick={loadData} style={{ marginTop: 10, background: "none", border: "1px solid #ddd", fontSize: 9, letterSpacing: 2, color: GRAY, padding: "4px 12px", cursor: "pointer", fontFamily: "inherit", textTransform: "uppercase" }}>
          Aggiorna
        </button>
      </div>

      {/* FLASH */}
      {flash && <div style={{ margin: "10px 20px", padding: "10px 14px", background: YELLOW, fontSize: 12, fontWeight: 700 }}>{flash}</div>}

      {/* RESULT */}
      {view === "result" && lastResult && (
        <div style={{ padding: "24px 20px" }}>
          <div style={{ fontSize: 10, letterSpacing: 4, color: GRAY, textTransform: "uppercase", marginBottom: 4 }}>Risultato</div>
          <div style={{ fontWeight: 900, fontSize: 38, letterSpacing: -1.5, lineHeight: 1 }}>{lastResult.winner}</div>
          <div style={{ fontWeight: 900, fontSize: 60, letterSpacing: -3, lineHeight: 1, marginBottom: 20 }}>{lastResult.scoreA}-{lastResult.scoreB}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
            {([{ name: lastResult.pA, d: lastResult.dA, r: lastResult.newA }, { name: lastResult.pB, d: lastResult.dB, r: lastResult.newB }] as const).map(p => (
              <div key={p.name} style={{ background: LGRAY, padding: 14 }}>
                <div style={{ fontSize: 11, color: GRAY, marginBottom: 4 }}>{p.name}</div>
                <div style={{ fontWeight: 900, fontSize: 26 }}>{p.r}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: p.d >= 0 ? "#2a7a2a" : "#c0392b" }}>{p.d >= 0 ? "+" : ""}{p.d}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setView("match")} style={btn(BLACK, "#fff")}>Nuova partita</button>
            <button onClick={() => setView("standings")} style={btn(YELLOW, BLACK)}>Classifica</button>
          </div>
        </div>
      )}

      {/* STANDINGS */}
      {view === "standings" && (
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ display: "flex", marginBottom: 20, borderBottom: `2px solid ${BLACK}` }}>
            {[{ id: "current", label: currentMonthLabel }, { id: "history", label: "Storico mensile" }].map(t => (
              <button key={t.id} onClick={() => setStandingsTab(t.id)} style={{ flex: 1, background: standingsTab === t.id ? YELLOW : "transparent", border: "none", borderBottom: standingsTab === t.id ? `2px solid ${BLACK}` : "none", marginBottom: -2, padding: "10px 0", fontFamily: "inherit", fontWeight: standingsTab === t.id ? 900 : 400, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer", color: BLACK }}>
                {t.label}
              </button>
            ))}
          </div>

          {standingsTab === "current" && <>
            <div style={{ fontSize: 10, letterSpacing: 4, color: GRAY, textTransform: "uppercase", marginBottom: 12 }}>Classifica {currentMonthLabel}</div>
            {currentStandings.map(([name, p], i) => (
              <div key={name} style={{ display: "flex", alignItems: "center", borderTop: `1px solid ${i === 0 ? BLACK : "#e0e0e0"}`, padding: "13px 0", gap: 10 }}>
                <div style={{ width: 22, fontWeight: 900, fontSize: 12, color: i < 3 ? BLACK : GRAY }}>{i + 1}</div>
                {i === 0 && <div style={{ background: YELLOW, width: 8, height: 8, borderRadius: "50%", flexShrink: 0 }} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{name}</div>
                  <div style={{ fontSize: 10, color: GRAY, marginTop: 3 }}>{p.matches}P {p.wins}V {p.losses}S {p.matches ? Math.round(p.wins / p.matches * 100) : 0}%</div>
                </div>
                <div style={{ fontWeight: 900, fontSize: 21 }}>{p.rating}</div>
              </div>
            ))}
            <div style={{ marginTop: 24, borderTop: `2px solid ${BLACK}`, paddingTop: 16 }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: GRAY, textTransform: "uppercase", marginBottom: 10 }}>Aggiungi giocatore</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={newPlayer} onChange={e => setNewPlayer(e.target.value)} onKeyDown={e => e.key === "Enter" && addPlayer()} placeholder="Nome" style={inp} />
                <button onClick={addPlayer} style={{ ...btn(BLACK, "#fff"), width: 44, padding: 0, flexShrink: 0 }}>+</button>
              </div>
            </div>
          </>}

          {standingsTab === "history" && (() => {
            const wins: Record<string, number> = {};
            monthlyHistory.forEach(m => { if (m.winner) wins[m.winner] = (wins[m.winner] || 0) + 1; });
            const leaderboard = Object.entries(wins).sort((a, b) => b[1] - a[1]);
            const champion = leaderboard[0];
            // Compute avg rating per player across all months with data
            const ratingTotals: Record<string, { sum: number; count: number }> = {};
            monthlyHistory.forEach(m => {
              m.standings.forEach(([name, rating]) => {
                if (rating === null) return;
                if (!ratingTotals[name]) ratingTotals[name] = { sum: 0, count: 0 };
                ratingTotals[name].sum += rating;
                ratingTotals[name].count += 1;
              });
            });
            const allPlayers = Object.keys(ratingTotals).sort((a, b) => {
              const avgA = ratingTotals[a].sum / ratingTotals[a].count;
              const avgB = ratingTotals[b].sum / ratingTotals[b].count;
              return avgB - avgA;
            });
            return <>
              {/* Champion banner */}
              <div style={{ background: BLACK, padding: "14px 16px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 9, letterSpacing: 3, color: "#aaa", textTransform: "uppercase", marginBottom: 3 }}>Campione Overall</div>
                  <div style={{ fontWeight: 900, fontSize: 20, color: "#fff" }}>🏆 {champion?.[0]}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ background: YELLOW, fontWeight: 900, fontSize: 22, padding: "6px 14px" }}>{champion?.[1]}</div>
                  <div style={{ fontSize: 9, letterSpacing: 2, color: "#aaa", marginTop: 4, textTransform: "uppercase" }}>mesi vinti</div>
                </div>
              </div>

              {/* Overall leaderboard */}
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 9, letterSpacing: 3, color: GRAY, textTransform: "uppercase", marginBottom: 10 }}>Classifica Generale</div>
                {allPlayers.map((name, i) => {
                  const avg = Math.round(ratingTotals[name].sum / ratingTotals[name].count);
                  const w = wins[name] ?? 0;
                  return (
                    <div key={name} style={{ display: "flex", alignItems: "center", borderTop: `1px solid ${i === 0 ? BLACK : "#e0e0e0"}`, padding: "10px 0", gap: 10 }}>
                      <div style={{ width: 22, fontWeight: 900, fontSize: 12, color: i < 3 ? BLACK : GRAY }}>{i + 1}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: i === 0 ? 700 : 400, fontSize: 14 }}>{name}</div>
                        <div style={{ fontSize: 10, color: GRAY, marginTop: 2 }}>Media {avg} · {w > 0 ? `🏆 ${w} ${w === 1 ? "mese" : "mesi"}` : "0 mesi"}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Monthly sections */}
              {monthlyHistory.map((month) => (
                <div key={month.month} style={{ marginBottom: 28 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: 1 }}>{month.month}</div>
                    {month.winner && <div style={{ background: YELLOW, fontSize: 9, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", padding: "3px 8px" }}>🏆 {month.winner}{month.winnerNote ? " " + month.winnerNote : ""}</div>}
                  </div>
                  {month.standings.map(([name, rating], i) => (
                    <div key={name} style={{ display: "flex", alignItems: "center", borderTop: `1px solid ${i === 0 ? "#ccc" : "#ebebeb"}`, padding: "9px 0", gap: 10 }}>
                      <div style={{ width: 18, fontWeight: 900, fontSize: 11, color: i === 0 ? BLACK : GRAY }}>{i + 1}</div>
                      <div style={{ flex: 1, fontWeight: i === 0 ? 700 : 400, fontSize: 13 }}>{name}</div>
                      <div style={{ fontWeight: 900, fontSize: 16 }}>{rating ?? "-"}</div>
                    </div>
                  ))}
                </div>
              ))}
            </>;
          })()}
        </div>
      )}

      {/* MATCH */}
      {view === "match" && (
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ fontSize: 10, letterSpacing: 4, color: GRAY, textTransform: "uppercase", marginBottom: 16 }}>Nuova Partita</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 28px 1fr", gap: 8, alignItems: "end", marginBottom: 14 }}>
            <div>
              <div style={lbl}>Giocatore A</div>
              <select value={pA} onChange={e => setPA(e.target.value)} style={sel}>
                <option value="">-</option>
                {Object.keys(players).filter(n => n !== pB).map(n => <option key={n}>{n}</option>)}
              </select>
            </div>
            <div style={{ fontWeight: 900, fontSize: 12, textAlign: "center", paddingBottom: 10, color: GRAY }}>vs</div>
            <div>
              <div style={lbl}>Giocatore B</div>
              <select value={pB} onChange={e => setPB(e.target.value)} style={sel}>
                <option value="">-</option>
                {Object.keys(players).filter(n => n !== pA).map(n => <option key={n}>{n}</option>)}
              </select>
            </div>
          </div>
          {pA && pB && (
            <div style={{ background: LGRAY, padding: "10px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span><strong>{pA}</strong> <span style={{ color: GRAY }}>{currentMonthState.players[pA]?.rating ?? 1000}</span></span>
              <span><strong>{pB}</strong> <span style={{ color: GRAY }}>{currentMonthState.players[pB]?.rating ?? 1000}</span></span>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div><div style={lbl}>Punti {pA || "A"}</div><input type="number" min="0" value={sA} onChange={e => setSA(e.target.value)} placeholder="0" style={inp} /></div>
            <div><div style={lbl}>Punti {pB || "B"}</div><input type="number" min="0" value={sB} onChange={e => setSB(e.target.value)} placeholder="0" style={inp} /></div>
          </div>
          <button onClick={submitMatch} style={btn(saving ? "#aaa" : BLACK, "#fff")} disabled={saving}>{saving ? "Salvataggio..." : "Registra"}</button>
        </div>
      )}

      {/* HISTORY */}
      {view === "history" && (
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 10, letterSpacing: 4, color: GRAY, textTransform: "uppercase" }}>Storico {matches.length} partite</div>
            <button onClick={loadData} style={{ background: "none", border: "1px solid #ddd", color: GRAY, fontSize: 9, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit", letterSpacing: 1, textTransform: "uppercase" }}>Ricarica</button>
          </div>
          {[...matches].reverse().map((m, i) => (
            <div key={m.id} style={{ borderTop: i === 0 ? `2px solid ${BLACK}` : "1px solid #e8e8e8", padding: "10px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 700, color: m.winner === m.playerA ? BLACK : GRAY }}>{m.playerA}</span>
                  <span style={{ color: "#ccc", margin: "0 6px" }}>·</span>
                  <span style={{ fontWeight: 700, color: m.winner === m.playerB ? BLACK : GRAY }}>{m.playerB}</span>
                </div>
                <div style={{ fontWeight: 900, fontSize: 16 }}>{m.scoreA}-{m.scoreB}</div>
              </div>
              <div style={{ fontSize: 10, color: GRAY, marginTop: 3, display: "flex", gap: 10 }}>
                <span>{m.date}</span>
                <span style={{ color: m.dA >= 0 ? "#2a7a2a" : "#c0392b" }}>{m.playerA} {m.dA >= 0 ? "+" : ""}{m.dA}</span>
                <span style={{ color: m.dB >= 0 ? "#2a7a2a" : "#c0392b" }}>{m.playerB} {m.dB >= 0 ? "+" : ""}{m.dB}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* NAV */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "#fff", borderTop: `2px solid ${BLACK}`, display: "flex" }}>
        {[{ id: "standings", label: "Classifica" }, { id: "match", label: "Partita" }, { id: "history", label: "Storico" }].map(t => (
          <button key={t.id} onClick={() => setView(t.id)} style={{ flex: 1, background: view === t.id ? YELLOW : "#fff", border: "none", borderRight: t.id !== "history" ? `1px solid ${BLACK}` : "none", color: BLACK, padding: "14px 0 12px", cursor: "pointer", fontFamily: "inherit", fontWeight: view === t.id ? 900 : 400, fontSize: 10, letterSpacing: 2, textTransform: "uppercase" }}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const btn = (bg: string, color: string): React.CSSProperties => ({ display: "block", width: "100%", padding: "14px 0", background: bg, color, border: "none", fontFamily: "inherit", fontWeight: 900, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" });
const inp: React.CSSProperties = { width: "100%", background: LGRAY, border: "none", borderBottom: "2px solid #0D0D0D", color: "#0D0D0D", padding: "12px 10px", fontSize: 16, fontFamily: "inherit", boxSizing: "border-box", outline: "none" };
const sel: React.CSSProperties = { width: "100%", background: LGRAY, border: "none", borderBottom: "2px solid #0D0D0D", color: "#0D0D0D", padding: "12px 10px", fontSize: 14, fontFamily: "inherit", appearance: "none", outline: "none", boxSizing: "border-box" };
const lbl: React.CSSProperties = { fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 6 };
