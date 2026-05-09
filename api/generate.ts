import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyqms0XJa93Q48ruSOnYgfm4hi4HJ3B5jLXoZkk2GFIeDFO1eE23glP1RNkZ044vPAj/exec";

const MONTHS_IT = [
  "Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno",
  "Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre",
];

const ELO_K = 24;

const SYSTEM_PROMPT = `Sei il cronista ufficiale della Lunch Ladder, la lega di ping pong di Lettera7.
Scrivi in italiano. Tono: ironico, affettuoso, brillante. Mai corporate, mai formale.
Il pubblico sono colleghi che si vogliono bene e si prendono in giro con gentilezza.
NON parlare mai di lavoro, progetti, performance professionali o dinamiche d'ufficio.
Parla solo di ping pong: tattiche, rimonte, rivalità sportive, striscie vincenti.
Ogni giocatore deve ricevere un soprannome o un'immagine memorabile di 4-6 parole.
L'ironia è sempre affettuosa: nessuno deve sentirsi preso in giro davvero.
Il tono è da telecronaca sportiva italiana degli anni '90.`;

type RawMatch = {
  date: string;
  playerA: string;
  playerB: string;
  scoreA: number;
  scoreB: number;
};

type PlayerStat = {
  rating: number;
  wins: number;
  losses: number;
  matches: number;
  monthWins: number;
  monthLosses: number;
  monthMatches: number;
  eloStart: number | null;
  eloDelta: number;
};

function parseDateIT(s: string): Date {
  const parts = s.split("/");
  if (parts.length === 3) {
    return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  }
  return new Date(s);
}

function computeMonthlyData(
  allMatches: RawMatch[],
  targetMonth: number,
  targetYear: number
) {
  const endOfMonth = new Date(targetYear, targetMonth, 0, 23, 59, 59);

  const sorted = [...allMatches]
    .map((m) => ({ ...m, _d: parseDateIT(m.date) }))
    .filter((m) => !isNaN(m._d.getTime()))
    .sort((a, b) => a._d.getTime() - b._d.getTime());

  const players: Record<string, PlayerStat> = {};
  const monthMatches: RawMatch[] = [];

  for (const m of sorted) {
    if (m._d > endOfMonth) continue;
    if (m.scoreA === m.scoreB) continue;

    const isTarget =
      m._d.getMonth() + 1 === targetMonth &&
      m._d.getFullYear() === targetYear;

    [m.playerA, m.playerB].forEach((p) => {
      if (!players[p]) {
        players[p] = {
          rating: 1000, wins: 0, losses: 0, matches: 0,
          monthWins: 0, monthLosses: 0, monthMatches: 0,
          eloStart: null, eloDelta: 0,
        };
      }
    });

    if (isTarget && players[m.playerA].eloStart === null)
      players[m.playerA].eloStart = players[m.playerA].rating;
    if (isTarget && players[m.playerB].eloStart === null)
      players[m.playerB].eloStart = players[m.playerB].rating;

    const rA = players[m.playerA].rating;
    const rB = players[m.playerB].rating;
    const eA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
    const dA = Math.round(ELO_K * ((m.scoreA > m.scoreB ? 1 : 0) - eA));

    players[m.playerA].rating = rA + dA;
    players[m.playerB].rating = rB - dA;

    const wonA = m.scoreA > m.scoreB;
    players[m.playerA].wins += wonA ? 1 : 0;
    players[m.playerA].losses += wonA ? 0 : 1;
    players[m.playerA].matches++;
    players[m.playerB].wins += wonA ? 0 : 1;
    players[m.playerB].losses += wonA ? 1 : 0;
    players[m.playerB].matches++;

    if (isTarget) {
      players[m.playerA].monthWins += wonA ? 1 : 0;
      players[m.playerA].monthLosses += wonA ? 0 : 1;
      players[m.playerA].monthMatches++;
      players[m.playerB].monthWins += wonA ? 0 : 1;
      players[m.playerB].monthLosses += wonA ? 1 : 0;
      players[m.playerB].monthMatches++;
      monthMatches.push(m);
    }
  }

  for (const p of Object.keys(players)) {
    if (players[p].eloStart !== null) {
      players[p].eloDelta = players[p].rating - (players[p].eloStart ?? players[p].rating);
    }
  }

  const standings = Object.entries(players)
    .filter(([, s]) => s.monthMatches > 0)
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.rating - a.rating);

  return { standings, monthMatches };
}

function findLongestStreak(
  matches: RawMatch[],
  playerName: string
): number {
  let max = 0, cur = 0;
  for (const m of matches) {
    const won =
      (m.playerA === playerName && m.scoreA > m.scoreB) ||
      (m.playerB === playerName && m.scoreB > m.scoreA);
    cur = won ? cur + 1 : 0;
    if (cur > max) max = cur;
  }
  return max;
}

function buildPrompt(
  standings: ReturnType<typeof computeMonthlyData>["standings"],
  monthMatches: RawMatch[],
  month: number,
  year: number
): string {
  const monthName = MONTHS_IT[month - 1];

  const standingsStr = standings
    .map(
      (p, i) =>
        `${i + 1}. ${p.name} — ${p.rating} pts (${p.eloDelta >= 0 ? "+" : ""}${p.eloDelta}) — ${p.monthWins}V ${p.monthLosses}P`
    )
    .join("\n");

  const matchesStr = monthMatches
    .slice(0, 20)
    .map(
      (m) =>
        `${m.date}: ${m.playerA} ${m.scoreA}–${m.scoreB} ${m.playerB} (${m.scoreA > m.scoreB ? m.playerA : m.playerB} vince)`
    )
    .join("\n");

  const mostActive = [...standings].sort(
    (a, b) => b.monthMatches - a.monthMatches
  )[0];

  const streaks = standings
    .map((p) => ({
      name: p.name,
      streak: findLongestStreak(monthMatches, p.name),
    }))
    .sort((a, b) => b.streak - a.streak)[0];

  return `Genera il Bollettino Lunch Ladder di ${monthName} ${year}.

CLASSIFICA FINALE DEL MESE:
${standingsStr}

PARTITE DEL MESE (${monthMatches.length} totali):
${matchesStr}

STATISTICHE NOTEVOLI:
- Giocatore più attivo: ${mostActive?.name ?? "—"} (${mostActive?.monthMatches ?? 0} partite)
- Streak più lunga del mese: ${streaks?.name ?? "—"} (${streaks?.streak ?? 0} vittorie consecutive)

Formato richiesto — scrivi SOLO questo, senza simboli markdown, senza asterischi, senza numbering:

TITOLO
(una riga: titolo creativo del mese, max 10 parole)

INTRO
(2-3 frasi di apertura, tono da telecronaca)

[nome giocatore] — [Soprannome creativo]
[2-3 frasi sulla sua stagione del mese]

(ripeti per ogni giocatore in classifica)

CHIUSURA
(1-2 frasi, appuntamento al prossimo mese)`;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !supabaseServiceKey || !anthropicKey) {
    return res.status(503).json({
      error: "Configurazione incompleta. Aggiungi SUPABASE_URL, SUPABASE_SERVICE_KEY e ANTHROPIC_API_KEY nelle variabili d'ambiente Vercel.",
    });
  }

  const isCron =
    req.headers["authorization"] ===
    `Bearer ${process.env.CRON_SECRET}`;

  const now = new Date();
  const month: number = req.body?.month ?? now.getMonth() + 1;
  const year: number = req.body?.year ?? now.getFullYear();

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  if (!isCron) {
    const { data: existing } = await supabase
      .from("bulletins")
      .select("generated_at")
      .eq("month", month)
      .eq("year", year)
      .maybeSingle();

    if (existing?.generated_at) {
      const ageMs = Date.now() - new Date(existing.generated_at).getTime();
      if (ageMs < 2 * 60 * 60 * 1000) {
        return res.status(429).json({
          error: `Hai già generato di recente. Riprova tra ${Math.ceil((2 * 60 * 60 * 1000 - ageMs) / 60000)} minuti.`,
        });
      }
    }
  }

  let allMatches: RawMatch[] = [];
  try {
    const r = await fetch(SCRIPT_URL);
    if (r.ok) allMatches = await r.json();
  } catch {
    return res.status(502).json({ error: "Impossibile leggere i dati dal foglio Google." });
  }

  if (!Array.isArray(allMatches) || allMatches.length === 0) {
    return res.status(404).json({ error: "Nessuna partita trovata nel foglio." });
  }

  const { standings, monthMatches } = computeMonthlyData(allMatches, month, year);

  if (monthMatches.length === 0) {
    return res.status(404).json({
      error: `Nessuna partita trovata per ${MONTHS_IT[month - 1]} ${year}.`,
    });
  }

  const anthropic = new Anthropic({ apiKey: anthropicKey });

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: buildPrompt(standings, monthMatches, month, year) },
    ],
  });

  const content =
    message.content[0].type === "text" ? message.content[0].text : "";

  const title = `Bollettino ${MONTHS_IT[month - 1]} ${year}`;

  const { data, error } = await supabase
    .from("bulletins")
    .upsert(
      {
        month,
        year,
        title,
        content,
        standings_snapshot: standings,
        matches_snapshot: monthMatches,
        status: "draft",
        generated_at: new Date().toISOString(),
        published_at: null,
      },
      { onConflict: "month,year" }
    )
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ success: true, bulletin: data });
}
