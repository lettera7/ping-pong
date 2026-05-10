import { createClient } from "@supabase/supabase-js";

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
      const { error } = await supabase
        .from("bulletins")
        .delete()
        .eq("id", id);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === "publish") {
        const { error } = await supabase
          .from("bulletins")
          .update({ status: "published", published_at: new Date().toISOString() })
          .eq("id", id);

        if (error) return res.status(500).json({ error: error.message });
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
