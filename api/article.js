// Récupère une page d'article et en extrait le texte principal.
// Sans dépendance : on retire le décor, puis on garde les paragraphes substantiels.

const MAX_CHARS = 14000;

function decode(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8230;|&hellip;/g, "…")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&eacute;/g, "é").replace(/&egrave;/g, "è").replace(/&agrave;/g, "à")
    .replace(/&ccedil;/g, "ç").replace(/&ecirc;/g, "ê").replace(/&ocirc;/g, "ô")
    .replace(/&#(\d+);/g, (m, d) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return " "; }
    });
}

function meta(html, names) {
  for (const n of names) {
    const re = new RegExp(
      '<meta[^>]+(?:property|name)=["\']' + n + '["\'][^>]*content=["\']([^"\']+)["\']', "i");
    let m = re.exec(html);
    if (m) return decode(m[1]).trim();
    const re2 = new RegExp(
      '<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']' + n + '["\']', "i");
    m = re2.exec(html);
    if (m) return decode(m[1]).trim();
  }
  return "";
}

function extract(html) {
  // on enlève tout ce qui n'est pas du contenu rédactionnel
  let h = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // on privilégie le corps d'article quand il est balisé
  const zone = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(h)
            || /<main[^>]*>([\s\S]*?)<\/main>/i.exec(h);
  const scope = zone ? zone[1] : h;

  const blocks = [];
  const re = /<(p|h2|h3|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(scope)) !== null) {
    const tag = m[1].toLowerCase();
    const t = decode(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (tag === "p" && t.length < 45) continue;      // légendes, mentions, boutons
    if (tag === "li" && t.length < 25) continue;     // éléments de menu
    if (/^(partager|share|abonnez|subscribe|cookies?|publicité|advertisement)/i.test(t)) continue;
    blocks.push(tag === "h2" || tag === "h3" ? "\n" + t.toUpperCase() + "\n" : t);
  }

  let text = blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + "\n[texte tronqué]";
  return text;
}

// Cherche la vraie date de publication de l'article, la ou elle se trouve.
function datePubliee(html) {
  const m = meta(html, ["article:published_time", "article:modified_time",
                        "datePublished", "publishdate", "date", "DC.date.issued"]);
  if (m && !isNaN(Date.parse(m))) return new Date(Date.parse(m)).toISOString();

  // donnees structurees JSON-LD, presentes sur la plupart des sites de presse
  const blocs = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const b of blocs) {
    const brut = b.replace(/<[^>]+>/g, "");
    const d = /"datePublished"\s*:\s*"([^"]+)"/.exec(brut);
    if (d && !isNaN(Date.parse(d[1]))) return new Date(Date.parse(d[1])).toISOString();
  }

  // balise time du HTML
  const t = /<time[^>]+datetime=["']([^"']+)["']/i.exec(html);
  if (t && !isNaN(Date.parse(t[1]))) return new Date(Date.parse(t[1])).toISOString();

  return "";
}

// Vercel coupe une fonction au bout de 10 s par defaut. On demande le maximum
// autorise sur la formule Hobby, sinon les appels longs reviennent vides.
export const maxDuration = 30;

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");

  const target = req.query && req.query.url;
  if (!target || !/^https?:\/\//i.test(target)) {
    res.status(400).json({ error: "Paramètre url manquant ou invalide" });
    return;
  }

  try {
    const r = await fetch(target, {
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "fr,en;q=0.8"
      }
    });

    if (!r.ok) {
      res.status(200).json({ ok: false, why: "la page a répondu " + r.status });
      return;
    }

    const html = await r.text();
    const text = extract(html);

    res.setHeader("cache-control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json({
      ok: text.length >= 400,
      why: text.length >= 400 ? "" : "texte trop court, page probablement dynamique ou payante",
      text,
      chars: text.length,
      title: meta(html, ["og:title", "twitter:title"]),
      author: meta(html, ["author", "article:author", "twitter:creator"]),
      image: meta(html, ["og:image", "twitter:image"]),
      site: meta(html, ["og:site_name"]),
      publie: datePubliee(html)
    });
  } catch (e) {
    const why = e && e.name === "TimeoutError" ? "délai dépassé" : (e && e.message) || "erreur";
    res.status(200).json({ ok: false, why });
  }
}
