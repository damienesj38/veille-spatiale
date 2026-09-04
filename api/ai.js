// Appelle l'API Anthropic depuis le serveur.
// La clé vit dans les variables d'environnement Vercel, jamais dans le navigateur.

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");

  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.status(500).json({
      error: "Clé absente. Ajoute ANTHROPIC_API_KEY dans les variables d'environnement Vercel, puis redéploie."
    });
    return;
  }

  // garde-fou : on n'accepte que les appels venant de cette même adresse,
  // pour qu'un autre site ne puisse pas consommer tes crédits
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host && !origin.endsWith(host)) {
    res.status(403).json({ error: "Origine refusée" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const system = String(body.system || "").slice(0, 4000);
    const user = String(body.user || "").slice(0, 40000);
    const maxTokens = Math.min(Math.max(parseInt(body.max_tokens, 10) || 1500, 100), 8000);
    // le mode audit autorise le modele a chercher sur le web pour recouper les faits
    const web = body.web === true;

    if (!user) {
      res.status(400).json({ error: "Requête vide" });
      return;
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(web ? 180000 : 60000),
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(Object.assign({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }]
      }, web ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 10 }] } : {}))
    });

    const data = await r.json();
    if (!r.ok) {
      res.status(r.status).json({ error: (data.error && data.error.message) || "Erreur API" });
      return;
    }

    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n");

    // stop_reason permet au navigateur de savoir si la reponse a ete coupee
    res.status(200).json({ text, stop_reason: data.stop_reason || "" });
  } catch (e) {
    const why = e && e.name === "TimeoutError" ? "délai dépassé" : (e && e.message) || "erreur inconnue";
    res.status(502).json({ error: why });
  }
}
