import { createClient } from "@supabase/supabase-js";

async function notifySlack(
  webhookUrl: string,
  bulletin: { title: string; content: string; month: number; year: number }
) {
  const MONTHS_IT = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno",
    "Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

  // First non-empty paragraph after the title line as preview
  const paragraphs = bulletin.content.split("\n\n").map(p => p.trim()).filter(Boolean);
  const preview = paragraphs.find(p => p !== paragraphs[0] && p.length > 20) ?? paragraphs[0] ?? "";
  const previewTruncated = preview.length > 280 ? preview.slice(0, 280) + "…" : preview;

  const appUrl = process.env.APP_URL ?? "https://ping-pong-7.vercel.app";
  const monthName = MONTHS_IT[bulletin.month - 1];

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `🏓 *${bulletin.title}* è stato pubblicato!`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `🏓 Bollettino ${monthName} ${bulletin.year}`, emoji: true },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${paragraphs[0] ?? bulletin.title}*\n\n_${previewTruncated}_`,
          },
        },
        { type: "divider" },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Leggi il bollettino →", emoji: true },
              url: `${appUrl}`,
              style: "primary",
            },
          ],
        },
      ],
    }),
  });
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return res.status(503).json({
        error: "Supabase non configurato.",
        hint: "Aggiungi SUPABASE_URL e SUPABASE_SERVICE_KEY nelle env vars Vercel.",
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const BULLETINS_TABLE = process.env.SUPABASE_BULLETINS_TABLE ?? "bulletins";

    if (req.method === "GET") {
      const { id } = req.query;

      if (id) {
        const { data, error } = await supabase
          .from("bulletins")
          .select("*")
          .eq("id", id)
          .single();

        if (error) return res.status(404).json({ error: "Bollettino non trovato.", detail: error.message });
        return res.status(200).json(data);
      }

      const { data, error } = await supabase
        .from("bulletins")
        .select("id, month, year, title, status, generated_at, published_at")
        .order("year", { ascending: false })
        .order("month", { ascending: false });

      if (error) return res.status(500).json({ error: error.message, code: error.code });
      return res.status(200).json(data ?? []);
    }

    if (req.method === "POST") {
      const body = req.body ?? {};
      const { action, id } = body;

      if (!id) return res.status(400).json({ error: "id mancante." });

      if (action === "delete") {
        const { error } = await supabase.from(BULLETINS_TABLE).delete().eq("id", id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }

      if (action === "publish") {
        // Fetch bulletin content for Slack notification
        const { data: bulletin, error: fetchError } = await supabase
          .from("bulletins")
          .select("title, content, month, year")
          .eq("id", id)
          .single();

        const { error } = await supabase
          .from("bulletins")
          .update({ status: "published", published_at: new Date().toISOString() })
          .eq("id", id);

        if (error) return res.status(500).json({ error: error.message });

        // Send Slack notification (non-blocking — don't fail if Slack is down)
        const slackWebhook = process.env.SLACK_WEBHOOK_URL;
        if (slackWebhook && bulletin && !fetchError) {
          notifySlack(slackWebhook, bulletin).catch(() => { /* silent */ });
        }

        return res.status(200).json({ success: true });
      }

      if (action === "unpublish") {
        const { error } = await supabase
          .from("bulletins")
          .update({ status: "draft", published_at: null })
          .eq("id", id);

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: "Azione non valida." });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).end();

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return res.status(500).json({ error: "Errore interno", detail: message, stack });
  }
}
