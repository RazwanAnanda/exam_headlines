// Runs on GitHub (free) every hour. Fetches the newspaper feeds and saves news.json.
// Each outlet has several tries: its own feed first, then a Google News search
// limited to that outlet's website, so one broken link does not empty the page.

const gnews = (domain, lang) =>
  lang === "bn"
    ? `https://news.google.com/rss/search?q=site:${domain}+when:2d&hl=bn&gl=BD&ceid=BD:bn`
    : `https://news.google.com/rss/search?q=site:${domain}+when:2d&hl=en-BD&gl=BD&ceid=BD:en`;

const OUTLETS = [
  { name: "The Daily Star", group: "Bangladesh",
    urls: ["https://www.thedailystar.net/rss.xml", "https://www.thedailystar.net/frontpage/rss.xml", gnews("thedailystar.net")] },
  { name: "Prothom Alo (English)", group: "Bangladesh",
    urls: ["https://en.prothomalo.com/feed", gnews("en.prothomalo.com")] },
  { name: "Prothom Alo (বাংলা)", group: "Bangladesh",
    urls: ["https://www.prothomalo.com/feed", gnews("prothomalo.com", "bn")] },
  { name: "The Business Standard", group: "Bangladesh",
    urls: ["https://www.tbsnews.net/rss.xml", gnews("tbsnews.net")] },
  { name: "bdnews24", group: "Bangladesh",
    urls: ["https://bdnews24.com/rss/rss.xml", gnews("bdnews24.com")] },
  { name: "Dhaka Tribune", group: "Bangladesh",
    urls: ["https://www.dhakatribune.com/feed", "https://www.dhakatribune.com/rss.xml", gnews("dhakatribune.com")] },
  { name: "BBC Bangla", group: "Bangladesh",
    urls: ["https://feeds.bbci.co.uk/bengali/rss.xml"] },
  { name: "BBC World", group: "World",
    urls: ["https://feeds.bbci.co.uk/news/world/rss.xml"] },
  { name: "Al Jazeera", group: "World",
    urls: ["https://www.aljazeera.com/xml/rss/all.xml"] },
];

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, " ").trim();
}

function pick(block, tag) {
  const m = block.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i"));
  return m ? m[1] : "";
}

function parseFeed(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    let title = decode(pick(b, "title"));
    let link = decode(pick(b, "link"));
    if (!link) { const h = b.match(/<link[^>]*href="([^"]+)"/i); link = h ? h[1] : ""; }
    const dateRaw = decode(pick(b, "pubDate") || pick(b, "published") || pick(b, "updated") || pick(b, "dc:date"));
    const t = Date.parse(dateRaw);
    return { title, link, time: isNaN(t) ? null : new Date(t).toISOString() };
  }).filter((x) => x.title && /^https?:\/\//.test(x.link));
}

async function grab(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; DailyHeadlines/1.0)", accept: "application/rss+xml, application/xml, text/xml, */*" },
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(timer); }
}

async function loadOutlet(o) {
  const log = [];
  for (const url of o.urls) {
    try {
      const items = parseFeed(await grab(url));
      if (!items.length) { log.push(url.slice(0, 70) + ": no items"); continue; }
      const viaGoogle = url.includes("news.google.com");
      const cutoff = Date.now() - 72 * 3600 * 1000;
      const cleaned = items
        .map((i) => viaGoogle ? { ...i, title: i.title.replace(/\s+[-–]\s+[^-–]+$/, "") } : i)
        .filter((i) => !i.time || Date.parse(i.time) >= cutoff)
        .slice(0, 12);
      if (cleaned.length) return { name: o.name, group: o.group, ok: true, items: cleaned, log: [] };
      log.push(url.slice(0, 70) + ": only old items");
    } catch (e) { log.push(url.slice(0, 70) + ": " + (e.name === "AbortError" ? "timeout" : e.message)); }
  }
  return { name: o.name, group: o.group, ok: false, items: [], log };
}

async function main() {
  const sources = await Promise.all(OUTLETS.map(loadOutlet));
  const ok = sources.filter((s) => s.ok).length;
  console.log(ok + " of " + sources.length + " newspapers loaded");
  sources.filter((s) => !s.ok).forEach((s) => console.log("FAILED " + s.name + ": " + s.log.join(" | ")));
  if (!ok) { console.error("Nothing loaded; keeping the old news.json"); return; }
  require("fs").writeFileSync("news.json", JSON.stringify({ generated_at: new Date().toISOString(), sources }));
}

main();
