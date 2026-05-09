import { useState, useEffect, useCallback, CSSProperties, useMemo } from "react";

const K = 24;
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyqms0XJa93Q48ruSOnYgfm4hi4HJ3B5jLXoZkk2GFIeDFO1eE23glP1RNkZ044vPAj/exec";
const SHEET_ID = "1V4OPHS3g55m5WxOBmPKLkBPvRtCB5jSHJ-c0FvXlN8c";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&sheet=Matches`;
const STORAGE_KEY = "pp_matches";

const Y = "#FEFE54";
const K0 = "#0D0D0D";
const GR = "#595959";       // 7:1 on white
const GR_LIGHT = "#888888"; // Figma design token (on yellow / light bg where contrast OK for decorative)
const GR_ON_DARK = "#B8B8B8"; // on black bg
const LG = "#F5F5F0";

const WIN_COLOR = "#1A781A";
const LOSS_COLOR = "#BF382B";

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
type BulletinMeta = { id: string; month: number; year: number; title: string; status: "draft" | "published"; generated_at: string; published_at: string | null };
type BulletinFull = BulletinMeta & { content: string; standings_snapshot: unknown; matches_snapshot: unknown };

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

// ── Stepper — Figma: 165px wide, 56px tall ────────────────────────────────
function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const btn: CSSProperties = { width: 48, height: 56, background: "#fff", border: "none", fontSize: 24, fontWeight: 500, cursor: "pointer", color: K0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, userSelect: "none", fontFamily: "inherit" };
  return (
    <div role="group" aria-label={label} style={{ display: "flex", alignItems: "center", background: LG, width: 165, height: 56, justifyContent: "space-between" }}>
      <button type="button" aria-label={`Diminuisci ${label}`} style={btn} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
      <span aria-live="polite" aria-atomic="true" style={{ fontSize: 36, fontWeight: 500, minWidth: 40, textAlign: "center", fontFamily: "inherit", lineHeight: 1 }}>{value}</span>
      <button type="button" aria-label={`Aumenta ${label}`} style={btn} onClick={() => onChange(value + 1)}>+</button>
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
  const [view, setView] = useState<"standings" | "match" | "bulletin" | "result">("standings");
  const [standingsTab, setStandingsTab] = useState<"current" | "history">("current");
  const [bulletinTab, setBulletinTab] = useState<"bollettino" | "storico">("bollettino");
  const [bulletins, setBulletins] = useState<BulletinMeta[]>([]);
  const [currentBulletin, setCurrentBulletin] = useState<BulletinFull | null>(null);
  const [expandedArchive, setExpandedArchive] = useState<BulletinFull | null>(null);
  const [bulletinLoading, setBulletinLoading] = useState(false);
  const [bulletinError, setBulletinError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [storPlayer, setStorPlayer] = useState("");
  const [storMonth, setStorMonth] = useState("");
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
        saveToStorage(matches); setState(replayMatches(matches)); setLoading(false); return;
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

  const loadBulletins = useCallback(async () => {
    setBulletinLoading(true);
    setBulletinError(null);
    try {
      const res = await fetch("/api/bulletins");
      if (!res.ok) throw new Error((await res.json()).error ?? "Errore API");
      const data: BulletinMeta[] = await res.json();
      setBulletins(data);
      const now = new Date();
      const cur = data.find(b => b.month === now.getMonth() + 1 && b.year === now.getFullYear());
      if (cur) {
        const r = await fetch(`/api/bulletins?id=${cur.id}`);
        if (r.ok) setCurrentBulletin(await r.json());
      } else {
        setCurrentBulletin(null);
      }
    } catch (e: unknown) {
      setBulletinError(e instanceof Error ? e.message : "Errore nel caricamento del bollettino");
    } finally {
      setBulletinLoading(false);
    }
  }, []);

  useEffect(() => { if (view === "bulletin") loadBulletins(); }, [view, loadBulletins]);

  async function generateBulletin() {
    setGenerating(true);
    try {
      const res = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore generazione");
      showFlash("Bollettino generato");
      await loadBulletins();
    } catch (e: unknown) {
      showFlash(e instanceof Error ? e.message : "Errore");
    } finally {
      setGenerating(false);
    }
  }

  async function publishBulletin(id: string, action: "publish" | "unpublish") {
    setPublishing(true);
    try {
      const res = await fetch("/api/bulletins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Errore");
      showFlash(action === "publish" ? "Bollettino pubblicato" : "Bollettino ritirato");
      setExpandedArchive(null);
      await loadBulletins();
    } catch (e: unknown) {
      showFlash(e instanceof Error ? e.message : "Errore");
    } finally {
      setPublishing(false);
    }
  }

  async function loadArchiveBulletin(b: BulletinMeta) {
    if (expandedArchive?.id === b.id) { setExpandedArchive(null); return; }
    try {
      const r = await fetch(`/api/bulletins?id=${b.id}`);
      if (r.ok) setExpandedArchive(await r.json());
    } catch { /* silent */ }
  }

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

  const storAvailMonths = useMemo(() => {
    if (!state) return [];
    return [...new Set(state.matches.map(m => {
      const p = m.date.split("/");
      return p.length === 3 ? `${p[1]}/${p[2]}` : "";
    }).filter(Boolean))].sort().reverse();
  }, [state]);

  const storFilteredMatches = useMemo(() => {
    if (!state) return [];
    return [...state.matches].reverse().filter(m => {
      if (storPlayer && m.playerA !== storPlayer && m.playerB !== storPlayer) return false;
      if (storMonth) { const p = m.date.split("/"); if (p.length !== 3 || `${p[1]}/${p[2]}` !== storMonth) return false; }
      return true;
    });
  }, [state, storPlayer, storMonth]);

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

      {/* ── HEADER — Figma: 80px ───────────────────────────────────── */}
      <header style={{ height: 80, padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1.5px solid ${K0}`, position: "relative" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 500, lineHeight: "12px", textTransform: "uppercase" }}>Ping Pong</span>
          <span style={{ fontSize: 12, fontWeight: 500, lineHeight: "16px", textTransform: "uppercase" }}>ELO</span>
          <span style={{ fontSize: 12, fontWeight: 500, lineHeight: "12px", textTransform: "uppercase" }}>K=24</span>
        </div>
        <img src="/lettera7-01.png" alt="Lettera7" style={{ position: "absolute", left: "50%", top: 5, transform: "translateX(-50%)", width: 94, height: 70, objectFit: "contain" }} />
        <button type="button" onClick={loadData} aria-label="Aggiorna dati" style={{ background: Y, border: "none", width: 71, height: 48, fontFamily: "inherit", fontSize: 12, fontWeight: 500, textTransform: "uppercase", cursor: "pointer", color: K0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          Update
        </button>
      </header>

      <main id="main">

      {/* ── RESULT — Figma 1:242 ───────────────────────────────────── */}
      {view === "result" && lastResult && (
        <div>
          {/* Black hero: RISULTATO + winner + score */}
          <div style={{ background: K0, padding: "26px 20px 24px", borderBottom: `1.5px solid ${K0}` }}>
            <div style={{ fontSize: 8, fontWeight: 300, letterSpacing: "0.2em", color: GR_ON_DARK, textTransform: "uppercase", marginBottom: 12 }}>Risultato</div>
            <div style={{ fontSize: 36, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1, color: Y, textTransform: "uppercase", marginBottom: 4 }}>{lastResult.winner}</div>
            <div style={{ fontSize: 72, fontWeight: 500, letterSpacing: "-0.04em", lineHeight: 1, color: "#fff" }}>{lastResult.scoreA}–{lastResult.scoreB}</div>
          </div>

          {/* Player cards — Figma: yellow left / white right, 120px tall */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: 120, borderBottom: `1.5px solid ${K0}` }}>
            {([{ name: lastResult.pA, d: lastResult.dA, r: lastResult.newA }, { name: lastResult.pB, d: lastResult.dB, r: lastResult.newB }]).map((p, i) => (
              <div key={p.name} style={{ padding: "12px 12px", borderRight: i === 0 ? `1.5px solid ${K0}` : "none", background: p.name === lastResult.winner ? Y : "#fff" }}>
                <div style={{ fontSize: 12, fontWeight: 300, letterSpacing: "0.1em", color: K0, textTransform: "uppercase", marginBottom: 6 }}>{p.name}</div>
                <div style={{ fontSize: 36, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1, color: K0 }}>{p.r}</div>
                <div style={{ fontSize: 14, fontWeight: 500, marginTop: 8, color: p.d >= 0 ? WIN_COLOR : LOSS_COLOR }}>{p.d >= 0 ? "+" : ""}{p.d}</div>
              </div>
            ))}
          </div>

          {/* Buttons — Figma: 56px, 18px Medium, 20px side margins */}
          <div style={{ padding: "20px 20px 0", display: "flex", flexDirection: "column", gap: 16 }}>
            <button type="button" onClick={() => setView("match")} style={bigBtn(K0, "#fff")}>Nuova partita</button>
            <button type="button" onClick={() => setView("standings")} style={bigBtn(Y, K0)}>Classifica</button>
          </div>
        </div>
      )}

      {/* ── STANDINGS — Figma 1:2 ──────────────────────────────────── */}
      {view === "standings" && (
        <div>
          {/* Tabs — Figma: 48px, 12px Medium */}
          <div role="tablist" aria-label="Tipologia classifica" style={{ display: "flex", height: 48, borderBottom: `1.5px solid ${K0}` }}>
            {(["current", "history"] as const).map(t => {
              const active = standingsTab === t;
              return (
                <button key={t} type="button" role="tab" aria-selected={active} onClick={() => setStandingsTab(t)}
                  style={{ flex: 1, height: 48, background: active ? Y : "#fff", border: "none", borderRight: t === "current" ? `1.5px solid ${K0}` : "none", fontFamily: "inherit", fontSize: 12, fontWeight: 500, textTransform: "uppercase", cursor: "pointer", color: active ? K0 : GR_LIGHT }}>
                  {t === "current" ? "Maggio 2026" : "Storico mensile"}
                </button>
              );
            })}
          </div>

          {standingsTab === "current" && (
            <>
              {/* #1 hero — Figma: 94px yellow */}
              {first && (
                <section aria-label="Primo classificato" style={{ background: Y, height: 94, position: "relative", borderBottom: `1.5px solid ${K0}` }}>
                  <div style={{ position: "absolute", left: 20, top: 40, fontSize: 16, fontWeight: 500, lineHeight: 1 }}>1°</div>
                  <h1 style={{ position: "absolute", left: 48, top: 20, fontSize: 36, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1, fontFamily: "inherit", margin: 0 }}>{first[0]}</h1>
                  <div style={{ position: "absolute", right: 20, top: 28, fontSize: 28, fontWeight: 500, lineHeight: 1 }} aria-label={`ELO ${first[1].rating}`}>{first[1].rating}</div>
                  <div style={{ position: "absolute", left: 48, top: 62, fontSize: 8, fontWeight: 300, letterSpacing: "0.05em", lineHeight: 1 }} aria-label={`${first[1].matches} partite, ${first[1].wins} vittorie, ${first[1].losses} sconfitte`}>
                    {first[1].matches}P · {first[1].wins}V · {first[1].losses}S · {first[1].matches ? Math.round(first[1].wins / first[1].matches * 100) : 0}%
                  </div>
                </section>
              )}

              {/* Ranks 2°+ — Figma: 56px rows */}
              <ol style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Classifica">
                {rest.map(([name, p], i) => (
                  <li key={name} style={{ height: 56, position: "relative", borderBottom: `1.5px solid #e8e8e8` }}>
                    <span style={{ position: "absolute", left: 20, top: 19, fontSize: 12, fontWeight: 500, lineHeight: 1 }}>{i + 2}°</span>
                    <span style={{ position: "absolute", left: 48, top: 14, fontSize: 18, fontWeight: 500, letterSpacing: "-0.01em", lineHeight: 1 }}>{name}</span>
                    <span style={{ position: "absolute", left: 48, top: 36, fontSize: 8, fontWeight: 300, color: GR_LIGHT, lineHeight: 1 }} aria-label={`${p.matches} partite`}>
                      {p.matches}P · {p.wins}V · {p.losses}S · {p.matches ? Math.round(p.wins / p.matches * 100) : 0}%
                    </span>
                    <span style={{ position: "absolute", right: 20, top: 18, fontSize: 22, fontWeight: 500, lineHeight: 1 }} aria-label={`ELO ${p.rating}`}>{p.rating}</span>
                  </li>
                ))}
              </ol>

              {/* Add player */}
              <form onSubmit={(e) => { e.preventDefault(); addPlayer(); }} style={{ borderTop: `1.5px solid ${K0}`, padding: "0 20px" }}>
                <label htmlFor="new-player" style={{ display: "block", fontSize: 8, fontWeight: 300, letterSpacing: "0.15em", color: GR_LIGHT, textTransform: "uppercase", marginTop: 20, marginBottom: 6 }}>
                  Aggiungi giocatore
                </label>
                <div style={{ display: "flex", marginBottom: 20 }}>
                  <input id="new-player" name="newPlayer" type="text" value={newPlayer} onChange={e => setNewPlayer(e.target.value)} placeholder="Nome" autoComplete="off"
                    style={{ flex: 1, height: 48, background: LG, border: "none", padding: "0 12px", fontSize: 14, fontWeight: 300, fontFamily: "inherit", color: K0, outline: "none" }} />
                  <button type="submit" aria-label="Aggiungi giocatore" style={{ width: 48, height: 48, background: K0, color: "#fff", border: "none", fontFamily: "inherit", fontSize: 20, fontWeight: 300, cursor: "pointer" }}>+</button>
                </div>
              </form>
            </>
          )}

          {/* Monthly history — Figma 1:67 */}
          {standingsTab === "history" && (() => {
            const wins: Record<string, number> = {};
            MONTHLY_HISTORY.forEach(m => { if (m.winner) wins[m.winner] = (wins[m.winner] || 0) + 1; });
            const [champ, champWins] = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
            return (
              <>
                {/* Champion banner — Figma: 104px black */}
                <div style={{ background: K0, height: 104, position: "relative", borderBottom: `1.5px solid ${K0}` }}>
                  <div style={{ position: "absolute", left: 23, top: 22, fontSize: 8, fontWeight: 300, letterSpacing: "0.2em", color: GR_ON_DARK, textTransform: "uppercase" }}>Campione Overall</div>
                  <div style={{ position: "absolute", left: 20, top: 34, fontSize: 36, fontWeight: 500, color: Y, textTransform: "uppercase", letterSpacing: "-0.02em", lineHeight: 1 }}>{champ}</div>
                  <div style={{ position: "absolute", right: 20, top: 34, fontSize: 36, fontWeight: 500, color: Y, lineHeight: 1, textAlign: "right" }}>{champWins}</div>
                  <div style={{ position: "absolute", right: 20, top: 74, fontSize: 8, fontWeight: 300, color: GR_ON_DARK, letterSpacing: "0.15em", textTransform: "uppercase" }}>Mesi vinti</div>
                </div>

                {/* Monthly sections */}
                {MONTHLY_HISTORY.map(month => (
                  <div key={month.month}>
                    {/* Section header — Figma: 44px gray, winner badge right half yellow */}
                    <div style={{ height: 44, background: LG, display: "flex", alignItems: "center", borderBottom: `1.5px solid ${K0}` }}>
                      <div style={{ flex: 1, paddingLeft: 20, fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{month.month}</div>
                      {month.winner && (
                        <div style={{ width: "50%", height: 44, background: Y, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, textTransform: "uppercase", color: K0 }}>
                          <span aria-hidden="true">🏆 </span>{month.winner}{month.winnerNote ? " " + month.winnerNote : ""}
                        </div>
                      )}
                    </div>

                    {/* Player rows — Figma: 28px each, 10px rank, 16px name, 16px rating right */}
                    {month.standings.map(([name, rating], i) => (
                      <div key={name as string} style={{ height: 28, display: "flex", alignItems: "center", paddingLeft: 20, paddingRight: 20, borderBottom: `1.5px solid #ededed` }}>
                        <span style={{ fontSize: 10, fontWeight: i === 0 ? 500 : 300, color: i === 0 ? K0 : GR_LIGHT, width: 24, flexShrink: 0 }}>{i + 1}°</span>
                        <span style={{ flex: 1, fontSize: 16, fontWeight: i === 0 ? 500 : 300, color: K0 }}>{name as string}</span>
                        <span style={{ fontSize: 16, fontWeight: 500, color: K0 }}>{rating ?? "–"}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            );
          })()}
        </div>
      )}

      {/* ── MATCH — Figma 1:184 ────────────────────────────────────── */}
      {view === "match" && (
        <div>
          {/* Yellow sub-header — Figma: 88px */}
          <div style={{ background: Y, height: 88, position: "relative", borderBottom: `1.5px solid ${K0}` }}>
            <div style={{ position: "absolute", left: 20, top: 15, fontSize: 9, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.15em", color: K0 }}>Registra</div>
            <h1 style={{ position: "absolute", left: 20, top: 26, fontSize: 36, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1, fontFamily: "inherit", margin: 0, color: K0 }}>Nuova partita</h1>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); submitMatch(); }} style={{ padding: "0 20px" }} noValidate>

            {/* Labels row */}
            <div style={{ display: "flex", alignItems: "center", marginTop: 16, marginBottom: 6 }}>
              <label htmlFor="player-a" style={{ flex: 1, fontSize: 8, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.15em", color: GR_LIGHT }}>Giocatore A</label>
              <div style={{ width: 34 }} />
              <label htmlFor="player-b" style={{ flex: 1, fontSize: 8, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.15em", color: GR_LIGHT }}>Giocatore B</label>
            </div>

            {/* Selects row — Figma: 158px each, 52px tall, 2px black bottom border */}
            <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 0 }}>
              <div style={{ position: "relative", width: 158 }}>
                <select id="player-a" name="playerA" value={pA} onChange={e => setPA(e.target.value)} required aria-required="true"
                  style={{ width: 158, height: 52, background: LG, border: "none", borderBottom: `2px solid ${K0}`, padding: "0 28px 0 12px", fontSize: 18, fontWeight: 500, fontFamily: "inherit", color: K0, appearance: "none", outline: "none", cursor: "pointer" }}>
                  <option value="">—</option>
                  {Object.keys(players).filter(n => n !== pB).map(n => <option key={n}>{n}</option>)}
                </select>
                <span aria-hidden="true" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, fontWeight: 500, color: GR_LIGHT, pointerEvents: "none" }}>▾</span>
              </div>

              <div aria-hidden="true" style={{ width: 34, textAlign: "center", fontSize: 11, fontWeight: 500, color: GR_LIGHT, flexShrink: 0 }}>VS</div>

              <div style={{ position: "relative", width: 158 }}>
                <select id="player-b" name="playerB" value={pB} onChange={e => setPB(e.target.value)} required aria-required="true"
                  style={{ width: 158, height: 52, background: LG, border: "none", borderBottom: `2px solid ${K0}`, padding: "0 28px 0 12px", fontSize: 18, fontWeight: 500, fontFamily: "inherit", color: K0, appearance: "none", outline: "none", cursor: "pointer" }}>
                  <option value="">—</option>
                  {Object.keys(players).filter(n => n !== pA).map(n => <option key={n}>{n}</option>)}
                </select>
                <span aria-hidden="true" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, fontWeight: 500, color: GR_LIGHT, pointerEvents: "none" }}>▾</span>
              </div>
            </div>

            {/* ELO preview — Figma: yellow 36px strips with "K [value]" */}
            <div style={{ display: "flex", gap: 34, marginBottom: 24 }}>
              <div style={{ width: 158, height: 36, background: pA ? Y : LG, display: "flex", alignItems: "center", paddingLeft: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 500, color: K0 }}>K {players[pA]?.rating ?? (pA ? 1000 : "—")}</span>
              </div>
              <div style={{ width: 158, height: 36, background: pB ? Y : LG, display: "flex", alignItems: "center", paddingLeft: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 500, color: K0 }}>K {players[pB]?.rating ?? (pB ? 1000 : "—")}</span>
              </div>
            </div>

            {/* Score section */}
            <div style={{ textAlign: "center", fontSize: 11, fontWeight: 500, color: GR_LIGHT, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 20 }} aria-hidden="true">Punteggio</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 36 }}>
              <Stepper value={sA} onChange={setSA} label={pA || "Giocatore A"} />
              <span aria-hidden="true" style={{ fontSize: 11, color: GR_LIGHT, flexShrink: 0, width: 34, textAlign: "center" }}>–</span>
              <Stepper value={sB} onChange={setSB} label={pB || "Giocatore B"} />
            </div>

            {/* Submit — Figma: 56px, 18px Medium */}
            <button type="submit" disabled={saving} style={bigBtn(saving ? GR : K0, "#fff")}>
              {saving ? "Salvataggio…" : "Registra partita"}
            </button>
          </form>
        </div>
      )}

      {/* ── HISTORY — Figma 1:283 ──────────────────────────────────── */}
      {view === "history" && (
        <div>
          {/* Black header — "Storico partite" 36px white */}
          <div style={{ background: K0, padding: "13px 20px 16px", borderBottom: `1.5px solid ${K0}` }}>
            <div style={{ fontSize: 8, fontWeight: 300, letterSpacing: "0.2em", color: GR_ON_DARK, textTransform: "uppercase", marginBottom: 8 }}>Archivio</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 style={{ fontSize: 36, fontWeight: 500, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1, fontFamily: "inherit", margin: 0 }}>Storico partite</h2>
              <span style={{ fontSize: 8, fontWeight: 300, color: GR_ON_DARK }}>{matches.length} partite</span>
            </div>
          </div>

          {/* Match list — Figma row: date left col, names+deltas, score right */}
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Elenco partite">
            {[...matches].reverse().map((m) => {
              const winA = m.winner === m.playerA;
              return (
                <li key={m.id} style={{ display: "flex", alignItems: "flex-start", padding: "10px 20px", borderBottom: `1.5px solid #e8e8e8`, minHeight: 52 }}>
                  {/* Date left column */}
                  <div style={{ width: 54, flexShrink: 0, paddingTop: 16 }}>
                    <time style={{ fontSize: 8, fontWeight: 300, color: GR_LIGHT, letterSpacing: "0.05em" }}>{formatDate(m.date)}</time>
                  </div>

                  {/* Names + deltas */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "baseline", lineHeight: 1 }}>
                      <span style={{ fontSize: 20, fontWeight: winA ? 500 : 300, color: winA ? K0 : GR_LIGHT }}>{m.playerA}</span>
                      <span aria-hidden="true" style={{ fontSize: 15, fontWeight: 300, color: "#dedede", margin: "0 6px" }}>·</span>
                      <span style={{ fontSize: 20, fontWeight: !winA ? 500 : 300, color: !winA ? K0 : GR_LIGHT }}>{m.playerB}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <span style={{ fontSize: 9, fontWeight: 300, color: m.dA >= 0 ? WIN_COLOR : LOSS_COLOR }}>
                        {m.dA >= 0 ? "+" : ""}{m.dA}
                      </span>
                      <span style={{ fontSize: 9, fontWeight: 300, color: m.dB >= 0 ? WIN_COLOR : LOSS_COLOR }}>
                        {m.dB >= 0 ? "+" : ""}{m.dB}
                      </span>
                    </div>
                  </div>

                  {/* Score */}
                  <div style={{ fontSize: 20, fontWeight: 500, lineHeight: 1, paddingTop: 2, flexShrink: 0 }}
                    aria-label={`${m.scoreA} a ${m.scoreB}`}>
                    {m.scoreA}–{m.scoreB}
                  </div>
                </li>
              );
            })}
            {matches.length === 0 && (
              <li style={{ padding: "40px 20px", textAlign: "center", fontSize: 13, color: GR }}>Nessuna partita registrata</li>
            )}
          </ol>
        </div>
      )}

      {/* ── BULLETIN ─────────────────────────────────────────────── */}
      {view === "bulletin" && (() => {
        const now = new Date();
        const MONTHS_IT = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
        const pastPublished = bulletins.filter(b => b.status === "published" && !(b.month === now.getMonth() + 1 && b.year === now.getFullYear()));

        // Storico partite data (lazy — from game state)
        const allPlayers = state ? Object.keys(state.players).sort() : [];

        return (
          <div>
            {/* Black header */}
            <div style={{ background: K0, padding: "13px 20px 16px", borderBottom: `1.5px solid ${K0}` }}>
              <div style={{ fontSize: 8, fontWeight: 300, letterSpacing: "0.2em", color: GR_ON_DARK, textTransform: "uppercase", marginBottom: 8 }}>Lunch Ladder</div>
              <h1 style={{ fontSize: 36, fontWeight: 500, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1, fontFamily: "inherit", margin: 0 }}>Bollettino</h1>
            </div>

            {/* Sub-tabs */}
            <div role="tablist" aria-label="Sezione bollettino" style={{ display: "flex", height: 48, borderBottom: `1.5px solid ${K0}` }}>
              {(["bollettino", "storico"] as const).map(t => {
                const active = bulletinTab === t;
                return (
                  <button key={t} type="button" role="tab" aria-selected={active} onClick={() => setBulletinTab(t)}
                    style={{ flex: 1, height: 48, background: active ? Y : "#fff", border: "none", borderRight: t === "bollettino" ? `1.5px solid ${K0}` : "none", fontFamily: "inherit", fontSize: 12, fontWeight: 500, textTransform: "uppercase", cursor: "pointer", color: active ? K0 : GR_LIGHT }}>
                    {t === "bollettino" ? "Bollettino AI" : "Storico partite"}
                  </button>
                );
              })}
            </div>

            {/* ── BOLLETTINO SUB-TAB ── */}
            {bulletinTab === "bollettino" && (
              <div>
                {/* Current month section */}
                <div style={{ borderBottom: `1.5px solid ${K0}` }}>
                  <div style={{ padding: "16px 20px 12px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.1em", color: GR_LIGHT }}>
                      {MONTHS_IT[now.getMonth()]} {now.getFullYear()}
                    </span>
                    {currentBulletin && (
                      <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", padding: "2px 8px", background: currentBulletin.status === "published" ? K0 : Y, color: currentBulletin.status === "published" ? "#fff" : K0 }}>
                        {currentBulletin.status === "published" ? "Pubblicato" : "Bozza"}
                      </span>
                    )}
                  </div>

                  {bulletinLoading && (
                    <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 11, color: GR_LIGHT, letterSpacing: "0.1em", textTransform: "uppercase" }}>Caricamento…</div>
                  )}

                  {!bulletinLoading && bulletinError && (
                    <div style={{ padding: "16px 20px 20px" }}>
                      <div style={{ fontSize: 12, color: LOSS_COLOR, marginBottom: 12 }}>{bulletinError}</div>
                      <div style={{ fontSize: 11, color: GR_LIGHT, lineHeight: 1.6 }}>
                        Per attivare il bollettino AI configura le variabili d'ambiente su Vercel:<br />
                        <code style={{ fontSize: 10, background: LG, padding: "2px 4px" }}>ANTHROPIC_API_KEY</code> · <code style={{ fontSize: 10, background: LG, padding: "2px 4px" }}>SUPABASE_URL</code> · <code style={{ fontSize: 10, background: LG, padding: "2px 4px" }}>SUPABASE_SERVICE_KEY</code>
                      </div>
                    </div>
                  )}

                  {!bulletinLoading && !bulletinError && !currentBulletin && (
                    <div style={{ padding: "16px 20px 20px" }}>
                      <p style={{ fontSize: 13, color: GR, lineHeight: 1.6, marginBottom: 20 }}>
                        Nessun bollettino per questo mese. Generane uno con AI.
                      </p>
                      <button type="button" onClick={generateBulletin} disabled={generating} style={bigBtn(generating ? GR : K0, "#fff")}>
                        {generating ? "Generazione in corso…" : "Genera bollettino"}
                      </button>
                    </div>
                  )}

                  {!bulletinLoading && !bulletinError && currentBulletin && (
                    <div>
                      <div style={{ padding: "0 20px 20px" }}>
                        {currentBulletin.content.split("\n\n").map((para, i) => (
                          <p key={i} style={{ fontSize: 14, lineHeight: 1.7, color: K0, margin: 0, marginBottom: 14, fontWeight: para === para.toUpperCase() && para.length < 80 ? 500 : 300 }}>
                            {para}
                          </p>
                        ))}
                      </div>
                      <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                        {currentBulletin.status === "draft" && (
                          <button type="button" onClick={() => publishBulletin(currentBulletin.id, "publish")} disabled={publishing} style={bigBtn(K0, "#fff")}>
                            {publishing ? "Pubblicazione…" : "Pubblica bollettino"}
                          </button>
                        )}
                        {currentBulletin.status === "published" && (
                          <button type="button" onClick={() => publishBulletin(currentBulletin.id, "unpublish")} disabled={publishing} style={bigBtn(LG, K0)}>
                            {publishing ? "…" : "Ritira bozza"}
                          </button>
                        )}
                        <button type="button" onClick={generateBulletin} disabled={generating} style={bigBtn(generating ? GR : Y, K0)}>
                          {generating ? "Generazione in corso…" : "Rigenera"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Archive */}
                {pastPublished.length > 0 && (
                  <div>
                    <div style={{ padding: "12px 20px 8px", fontSize: 9, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.15em", color: GR_LIGHT }}>
                      Archivio
                    </div>
                    {pastPublished.map(b => (
                      <div key={b.id} style={{ borderBottom: `1.5px solid #e8e8e8` }}>
                        <button type="button" onClick={() => loadArchiveBulletin(b)}
                          style={{ width: "100%", height: 52, background: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", padding: "0 20px", fontFamily: "inherit", textAlign: "left" }}>
                          <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: K0 }}>{b.title}</span>
                          <span aria-hidden="true" style={{ fontSize: 14, color: GR_LIGHT, marginLeft: 8 }}>{expandedArchive?.id === b.id ? "↑" : "↓"}</span>
                        </button>
                        {expandedArchive?.id === b.id && (
                          <div style={{ padding: "0 20px 20px" }}>
                            {expandedArchive.content.split("\n\n").map((para, i) => (
                              <p key={i} style={{ fontSize: 13, lineHeight: 1.7, color: K0, margin: 0, marginBottom: 12, fontWeight: para === para.toUpperCase() && para.length < 80 ? 500 : 300 }}>
                                {para}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── STORICO SUB-TAB ── */}
            {bulletinTab === "storico" && (
              <div>
                {/* Filters */}
                <div style={{ display: "flex", gap: 0, borderBottom: `1.5px solid ${K0}` }}>
                  <div style={{ flex: 1, position: "relative", borderRight: `1.5px solid ${K0}` }}>
                    <select value={storPlayer} onChange={e => setStorPlayer(e.target.value)} aria-label="Filtra per giocatore"
                      style={{ width: "100%", height: 48, background: storPlayer ? Y : "#fff", border: "none", padding: "0 28px 0 16px", fontSize: 12, fontWeight: 500, fontFamily: "inherit", color: K0, appearance: "none", cursor: "pointer" }}>
                      <option value="">Tutti i giocatori</option>
                      {allPlayers.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <span aria-hidden="true" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, pointerEvents: "none", color: GR_LIGHT }}>▾</span>
                  </div>
                  <div style={{ flex: 1, position: "relative" }}>
                    <select value={storMonth} onChange={e => setStorMonth(e.target.value)} aria-label="Filtra per mese"
                      style={{ width: "100%", height: 48, background: storMonth ? Y : "#fff", border: "none", padding: "0 28px 0 16px", fontSize: 12, fontWeight: 500, fontFamily: "inherit", color: K0, appearance: "none", cursor: "pointer" }}>
                      <option value="">Tutti i mesi</option>
                      {storAvailMonths.map(m => { const [mm, yy] = m.split("/"); return <option key={m} value={m}>{MONTHS_IT[parseInt(mm)-1]} {yy}</option>; })}
                    </select>
                    <span aria-hidden="true" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, pointerEvents: "none", color: GR_LIGHT }}>▾</span>
                  </div>
                </div>

                <ol style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Elenco partite">
                  {storFilteredMatches.map((m) => {
                    const winA = m.winner === m.playerA;
                    return (
                      <li key={m.id} style={{ display: "flex", alignItems: "flex-start", padding: "10px 20px", borderBottom: `1.5px solid #e8e8e8`, minHeight: 52 }}>
                        <div style={{ width: 54, flexShrink: 0, paddingTop: 16 }}>
                          <time style={{ fontSize: 8, fontWeight: 300, color: GR_LIGHT, letterSpacing: "0.05em" }}>{formatDate(m.date)}</time>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "baseline", lineHeight: 1 }}>
                            <span style={{ fontSize: 20, fontWeight: winA ? 500 : 300, color: winA ? K0 : GR_LIGHT }}>{m.playerA}</span>
                            <span aria-hidden="true" style={{ fontSize: 15, fontWeight: 300, color: "#dedede", margin: "0 6px" }}>·</span>
                            <span style={{ fontSize: 20, fontWeight: !winA ? 500 : 300, color: !winA ? K0 : GR_LIGHT }}>{m.playerB}</span>
                          </div>
                          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                            <span style={{ fontSize: 9, fontWeight: 300, color: m.dA >= 0 ? WIN_COLOR : LOSS_COLOR }}>{m.dA >= 0 ? "+" : ""}{m.dA}</span>
                            <span style={{ fontSize: 9, fontWeight: 300, color: m.dB >= 0 ? WIN_COLOR : LOSS_COLOR }}>{m.dB >= 0 ? "+" : ""}{m.dB}</span>
                          </div>
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 500, lineHeight: 1, paddingTop: 2, flexShrink: 0 }} aria-label={`${m.scoreA} a ${m.scoreB}`}>
                          {m.scoreA}–{m.scoreB}
                        </div>
                      </li>
                    );
                  })}
                  {storFilteredMatches.length === 0 && (
                    <li style={{ padding: "40px 20px", textAlign: "center", fontSize: 13, color: GR }}>Nessuna partita trovata</li>
                  )}
                </ol>
              </div>
            )}
          </div>
        );
      })()}

      </main>

      {/* ── BOTTOM NAV — Figma: 72px, 8px Medium labels, 16px icons ── */}
      <nav aria-label="Navigazione principale" style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 600, height: 72, background: "#fff", borderTop: `1.5px solid ${K0}`, display: "flex", zIndex: 100, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {([
          { id: "standings", label: "Classifica", icon: "◈" },
          { id: "match",     label: "Partita",    icon: "◉" },
          { id: "bulletin",  label: "Bollettino", icon: "◎" },
        ] as const).map(t => {
          const active = view === t.id || (view === "result" && t.id === "standings");
          return (
            <button key={t.id} type="button" onClick={() => setView(t.id)} aria-current={active ? "page" : undefined}
              style={{ flex: 1, height: 71, background: active ? Y : "#fff", border: "none", borderRight: t.id !== "bulletin" ? `1.5px solid ${K0}` : "none", cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <span aria-hidden="true" style={{ fontSize: 16, fontWeight: 300, color: K0, lineHeight: 1 }}>{t.icon}</span>
              <span style={{ fontSize: 8, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: K0, lineHeight: 1 }}>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// Full-width button — Figma: 56px tall, 18px Medium
const bigBtn = (bg: string, color: string): CSSProperties => ({
  display: "block", width: "100%", height: 56, background: bg, color, border: "none",
  fontFamily: "'Lettera7Diatype', 'Helvetica Neue', sans-serif", fontSize: 18,
  fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer",
  marginBottom: 16,
});
