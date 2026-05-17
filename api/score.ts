import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { playerA, playerB, scoreA, scoreB, timestamp, source = 'gopro' } = req.body ?? {};

  if (!playerA || !playerB || scoreA === undefined || scoreB === undefined) {
    return res.status(400).json({
      error: 'Missing required fields: playerA, playerB, scoreA, scoreB',
    });
  }

  if (
    typeof scoreA !== 'number' || typeof scoreB !== 'number' ||
    scoreA < 0 || scoreA > 21 || scoreB < 0 || scoreB > 21
  ) {
    return res.status(400).json({ error: 'scoreA and scoreB must be integers 0–21' });
  }

  const scriptUrl = process.env.SCRIPT_URL;
  if (!scriptUrl) return res.status(503).json({ error: 'SCRIPT_URL not configured' });

  const date = timestamp
    ? new Date(Number(timestamp)).toLocaleDateString('it-IT')
    : new Date().toLocaleDateString('it-IT');

  const url = new URL(scriptUrl);
  url.searchParams.set('action', 'addMatch');
  url.searchParams.set('date', date);
  url.searchParams.set('playerA', String(playerA));
  url.searchParams.set('playerB', String(playerB));
  url.searchParams.set('scoreA', String(scoreA));
  url.searchParams.set('scoreB', String(scoreB));
  url.searchParams.set('source', String(source));

  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error(`Apps Script returned ${resp.status}`);
    return res.status(200).json({ ok: true, date, playerA, playerB, scoreA, scoreB, source });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
}
