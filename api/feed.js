// Relais de flux. Le navigateur ne peut pas appeler directement un site tiers,
// alors c'est ce petit bout de serveur qui va chercher le flux et le renvoie.

// Vercel coupe une fonction au bout de 10 s par defaut. On demande le maximum
// autorise sur la formule Hobby, sinon les appels longs reviennent vides.
export const maxDuration = 30;

export default async function handler(req, res) {
  const target = req.query && req.query.url;

  res.setHeader("access-control-allow-origin", "*");

  if (!target || !/^https?:\/\//i.test(target)) {
    res.status(400).send("Paramètre url manquant ou invalide");
    return;
  }

  try {
    const upstream = await fetch(target, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: {
        // certains sites renvoient une erreur aux clients sans identité
        "user-agent": "Mozilla/5.0 (compatible; VeilleSpatiale/1.0; +lecteur RSS personnel)",
        "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.8",
        "accept-language": "fr,en;q=0.8"
      }
    });

    const body = await upstream.text();

    if (!upstream.ok) {
      res.status(502).send("La source a répondu " + upstream.status);
      return;
    }

    const type = upstream.headers.get("content-type") || "application/xml; charset=utf-8";
    res.setHeader("content-type", type);
    // cache de 5 min côté Vercel : inutile de harceler les sources
    res.setHeader("cache-control", "public, s-maxage=300, stale-while-revalidate=900");
    res.status(200).send(body);
  } catch (e) {
    const why = e && e.name === "TimeoutError" ? "délai dépassé" : (e && e.message) || "erreur inconnue";
    res.status(504).send("Source injoignable : " + why);
  }
}
