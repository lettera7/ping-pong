import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(503).json({ error: "Supabase non configurato." });
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

      if (error) return res.status(404).json({ error: "Bollettino non trovato." });
      return res.status(200).json(data);
    }

    const { data, error } = await supabase
      .from("bulletins")
      .select("id, month, year, title, status, generated_at, published_at")
      .order("year", { ascending: false })
      .order("month", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data ?? []);
  }

  if (req.method === "POST") {
    const { action, id } = req.body ?? {};

    if (!id) return res.status(400).json({ error: "id mancante." });

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

    return res.status(400).json({ error: "Azione non valida. Usa publish o unpublish." });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).end();
}
