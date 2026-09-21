#!/usr/bin/env node
// 🖥️ Lead Scout paneli — `node dashboard.mjs` → http://localhost:4400
//
// Neden ayrı sunucu: tarayıcı file:// üzerinden yerel JSON okuyamıyor (CORS),
// ayrıca 13 MB'lık mağaza dosyalarını olduğu gibi tarayıcıya atmak anlamsız —
// filtreleme ve sayfalama burada, sunucuda yapılıyor.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, indexSize, searchLocal, searchLive, searchLiveStream } from "./lib/search.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 4400;
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };

const json = (res, data) => {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
};

// Mağaza dosyaları büyük; bir kez okuyup bellekte tutuyoruz.
function readRows() {
  const file = path.join(here, "out", "rows.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const cache = new Map();
function loadStore(domain) {
  if (cache.has(domain)) return cache.get(domain);
  const file = path.join(here, "out", "stores", `${path.basename(domain)}.json`);
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  cache.set(domain, data);
  return data;
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");

  if (url.pathname === "/api/rows") {
    const rows = readRows();
    const haveDetail = new Set(
      fs.existsSync(path.join(here, "out", "stores"))
        ? fs.readdirSync(path.join(here, "out", "stores")).map((f) => f.replace(/\.json$/, ""))
        : [],
    );
    return json(res, rows.map((r) => ({ ...r, hasDetail: haveDetail.has(r.domain) })));
  }

  // Canlı aramanın havuzu: panele kayıtlı Shopify mağazaları + pool.txt
  // (pool.txt'teki mağazaların kataloğu indirilmemiştir, sadece aranır).
  function livePool(seg) {
    const rows = readRows();
    const fromRows = rows.filter((r) => r.platform === "shopify" && (!seg || r.segment === seg)).map((r) => r.domain);
    const poolFile = path.join(here, "pool.txt");
    const pool = fs.existsSync(poolFile) && !seg
      ? fs.readFileSync(poolFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
      : [];
    return [...new Set([...fromRows, ...pool])];
  }

  // 📡 Akıtmalı canlı arama (SSE) — ilk parti hemen, kalanı geldikçe.
  if (url.pathname === "/api/search/stream") {
    const q = (url.searchParams.get("q") || "").trim();
    const seg = url.searchParams.get("seg") || "";
    if (!q) { res.writeHead(400); return res.end("q gerekli"); }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    const ctrl = new AbortController();
    req.on("close", () => ctrl.abort());

    const domains = livePool(seg);
    res.write(`event: start\ndata: ${JSON.stringify({ total: domains.length })}\n\n`);

    searchLiveStream(q, domains, async (results, done, total) => {
      res.write(`event: batch\ndata: ${JSON.stringify({ results, done, total })}\n\n`);
    }, { signal: ctrl.signal })
      .then(() => { res.write("event: done\ndata: {}\n\n"); res.end(); })
      .catch(() => { res.write("event: done\ndata: {}\n\n"); res.end(); });
    return;
  }

  // 🔍 Mağazalar arası ürün arama
  if (url.pathname === "/api/search") {
    const q = (url.searchParams.get("q") || "").trim();
    const mode = url.searchParams.get("mode") === "live" ? "live" : "local";
    const seg = url.searchParams.get("seg") || "";
    if (!q) return json(res, { results: [], matched: 0, stores: 0, mode });

    const rows = readRows();
    const inSeg = (r) => !seg || r.segment === seg;

    if (mode === "live") {
      const shopify = livePool(seg);
      return searchLive(q, shopify).then((out) => json(res, { ...out, mode, scanned: shopify.length }))
        .catch(() => json(res, { results: [], matched: 0, stores: 0, mode, error: "canlı arama başarısız" }));
    }

    buildIndex(path.join(here, "out", "stores"));
    const domains = seg ? rows.filter(inSeg).map((r) => r.domain) : null;
    const out = searchLocal(q, { domains, limit: 150 });
    return json(res, { ...out, mode, indexed: indexSize() });
  }

  if (url.pathname === "/api/store") {
    const store = loadStore(url.searchParams.get("d") || "");
    if (!store) { res.writeHead(404); return res.end("no detail"); }

    const cat = url.searchParams.get("cat") || "";
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const imgFilter = url.searchParams.get("img") || "";   // "1" | "lt3" | ""
    const sort = url.searchParams.get("sort") || "images";
    const dir = url.searchParams.get("dir") === "asc" ? 1 : -1;
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const size = Math.min(200, Number(url.searchParams.get("size")) || 40);

    let list = store.products;
    if (cat) list = list.filter((p) => (p.type || "(kategorisiz)").split(">")[0].trim() === cat);
    if (q) list = list.filter((p) => `${p.title} ${p.desc} ${p.tags.join(" ")}`.toLowerCase().includes(q));
    if (imgFilter === "1") list = list.filter((p) => p.nImages <= 1);
    if (imgFilter === "lt3") list = list.filter((p) => p.nImages < 3);
    if (imgFilter === "nodesc") list = list.filter((p) => !p.hasDesc);

    const key = { images: "nImages", title: "title", price: "price", desc: "descLen" }[sort] || "nImages";
    list = [...list].sort((a, b) => {
      const x = a[key] ?? 0, y = b[key] ?? 0;
      return (typeof x === "string" ? x.localeCompare(y, "tr") : x - y) * dir;
    });

    return json(res, {
      domain: store.domain,
      productCount: store.productCount,
      imageCount: store.imageCount,
      withoutDescription: store.withoutDescription,
      categories: store.categories.root.slice(0, 40),
      matched: list.length,
      page, size,
      products: list.slice((page - 1) * size, page * size),
    });
  }

  const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = path.join(here, "web", rel);
  if (!file.startsWith(path.join(here, "web")) || !fs.existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
    // Panel geliştirme altında: tarayıcı eski app.js'i tutmasın.
    "Cache-Control": "no-store, must-revalidate",
  });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Lead Scout paneli → http://localhost:${port}`));
