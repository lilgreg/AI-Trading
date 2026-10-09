/** Inspect a specific Yahoo article URL extraction. */
import { Agent, fetch as undiciFetch } from "undici";

const url =
  process.argv[2] ??
  "https://finance.yahoo.com/m/c533cff4-ded8-3e60-abf1-fc9ebc3e0545/booking-stock-is-running-hot%2C.html";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function main() {
  const agent = new Agent({ maxHeaderSize: 65536 });
  const res = await undiciFetch(url, {
    dispatcher: agent,
    headers: { "User-Agent": UA, Accept: "text/html" },
    redirect: "follow",
  });
  console.log("status", res.status, "final", res.url);
  const html = await res.text();
  console.log("html len", html.length);

  const og = html.match(
    /property=["']og:description["'][^>]+content=["']([^"']*)["']/i,
  );
  console.log("og len", og?.[1]?.length ?? 0);
  if (og?.[1]) console.log("og:", stripHtml(og[1]).slice(0, 200));

  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripHtml(m[1]))
    .filter((t) => t.length > 80);
  console.log("paragraphs", paras.length);
  for (const p of paras.slice(0, 8)) {
    console.log(" -", p.slice(0, 140));
  }

  const keys = ["articleBody", "bodyHtml", "content", "story", "caas-body"];
  for (const k of keys) {
    const i = html.indexOf(k);
    console.log(k, i >= 0 ? html.slice(i, i + 100).replace(/\s+/g, " ") : "missing");
  }
  const canon = html.match(/rel=["']canonical["'][^>]+href=["']([^"']+)/i);
  console.log("canonical", canon?.[1]);

  if (canon?.[1] && !canon[1].includes("finance.yahoo.com")) {
    const cres = await undiciFetch(canon[1], {
      dispatcher: agent,
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
    });
    const chtml = await cres.text();
    const cparas = [...chtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => stripHtml(m[1]))
      .filter((t) => t.length > 80);
    console.log("canonical html", chtml.length, "paras", cparas.length);
    if (cparas[0]) console.log("canonical first:", cparas[0].slice(0, 160));
  }
}

main().catch(console.error);
