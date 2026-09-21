const STATUS = [
  { min: 2.5, label: "güçlü", color: "var(--good)" },
  { min: 2.0, label: "aday", color: "var(--warning)" },
  { min: 1.0, label: "zayıf", color: "var(--serious)" },
  { min: -1, label: "uygun değil", color: "var(--critical)" },
];
const tier = (f) => STATUS.find((s) => f >= s.min) || STATUS[3];
const fmt = (n) => (n == null ? "—" : new Intl.NumberFormat("tr-TR").format(n));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const el = (id) => document.getElementById(id);

let ROWS = [];
const fitOf = (r) => (r.verdict && typeof r.verdict.leadFit === "number" ? r.verdict.leadFit : null);
const mailOf = (r) => (r.emails && r.emails[0]) || "";

/* ---------------- liste görünümü ---------------- */

async function loadList() {
  ROWS = await (await fetch("/api/rows", { cache: "no-store" })).json();
  const scanned = ROWS.length;
  const readable = ROWS.filter((r) => r.products > 0).length;
  const platforms = [...new Set(ROWS.map((r) => r.platform).filter(Boolean))].length;
  const leads = ROWS.filter((r) => r.keep).length;
  const missing = ROWS.filter((r) => r.keep).reduce((a, r) => a + (r.missingPhotos || 0), 0);

  // sektör seçeneklerini veriden üret
  const segs = [...new Set(ROWS.map((r) => r.segment).filter(Boolean))].sort();
  const LABEL = { sal: "şal / eşarp", cocuk: "çocuk giyim", referans: "referans markalar" };
  el("seg").innerHTML = `<option value="">Tüm sektörler</option>` +
    segs.map((g) => `<option value="${g}">${LABEL[g] || g}</option>`).join("");

  el("sub").textContent = `${scanned} mağaza tarandı · ${new Date().toLocaleString("tr-TR")}`;
  el("kpis").innerHTML = [
    [fmt(scanned), "taranan mağaza"], [`${fmt(readable)}`, `katalogu okundu · ${platforms} platform`],
    [fmt(leads), "listeye giren aday"], [fmt(missing), "üretilebilir eksik foto"],
  ].map(([n, l]) => `<div class="kpi"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");
  renderList();
}

function renderList() {
  const q = el("q").value.trim().toLowerCase();
  const minFit = Number(el("fit").value);
  const onlyMail = el("onlymail").checked;
  const showAll = el("showall").checked;
  const sort = el("sort").value;

  const seg = el("seg").value;

  let rows = ROWS.filter((r) => r.products);
  if (seg) rows = rows.filter((r) => r.segment === seg);
  if (!showAll) rows = rows.filter((r) => !["no_catalog", "not_apparel", "measure_suspect"].includes(r.reason));
  if (q) rows = rows.filter((r) => r.domain.toLowerCase().includes(q));
  if (onlyMail) rows = rows.filter((r) => mailOf(r));
  if (minFit > 0) rows = rows.filter((r) => (fitOf(r) ?? 0) >= minFit);

  rows.sort((a, b) => {
    if (sort === "domain") return a.domain.localeCompare(b.domain, "tr");
    if (sort === "fit") return (fitOf(b) ?? -1) - (fitOf(a) ?? -1);
    if (sort === "imagesPerProduct") return a.imagesPerProduct - b.imagesPerProduct;
    return (b[sort] ?? 0) - (a[sort] ?? 0);
  });

  el("storeList").innerHTML = !rows.length
    ? `<div class="empty">Bu filtrelerle eşleşen mağaza yok.</div>`
    : rows.map((r) => {
        const f = fitOf(r), t = f == null ? null : tier(f);
        const mail = mailOf(r);
        const covers = r.covers || [];
        return `<section class="store">
          <div class="store-head">
            <span class="store-name">${r.hasDetail
              ? `<a href="#s=${encodeURIComponent(r.domain)}">${esc(r.domain)}</a>`
              : esc(r.domain)}</span>
            ${r.platform ? `<span class="plat">${esc(r.platform)}${r.sampled ? " · örneklem" : ""}</span>` : ""}
            ${r.suspect ? `<span class="plat" title="Görseller eşleştirilemedi — ölçüm güvenilir değil">ölçüm şüpheli</span>` : ""}
            ${t ? `<span class="chip"><span class="dot" style="background:${t.color}"></span><b>${f.toFixed(2)}</b> ${t.label}</span>` : ""}
          </div>
          <div class="store-stats">
            <span><b>${fmt(r.products)}</b> ürün</span>
            <span><b>${r.imagesPerProduct}</b> foto/ürün <em class="none">(medyan ${r.categoryMedian || 4})</em></span>
            <span><b>%${r.pctOneImage}</b> tek fotolu</span>
            ${r.missingPhotos ? `<span><b>${fmt(r.missingPhotos)}</b> eksik foto</span>` : ""}
          </div>
          <div class="store-mail">${mail ? `<a href="mailto:${esc(mail)}">${esc(mail)}</a>` : `<span class="none">e-posta bulunamadı</span>`}</div>
          ${covers.length
            ? `<div class="strip" data-d="${esc(r.domain)}">${covers.map((c, i) => `
                <figure>
                  <div class="sh" data-ci="${i}"><img loading="lazy" referrerpolicy="no-referrer" src="${esc(c.image)}" alt=""></div>
                  <figcaption title="${esc(c.label || c.title)}">${esc(c.label || c.title)}</figcaption>
                </figure>`).join("")}</div>`
            : `<div class="strip-empty">kapak görseli alınamadı</div>`}
          ${r.openingLine ? `<div class="store-line"><span>${esc(r.openingLine)}</span>
              <button class="copy" data-c="${encodeURIComponent(r.openingLine)}">kopyala</button></div>` : ""}
        </section>`;
      }).join("");
  el("foot").textContent = `${rows.length} mağaza gösteriliyor`;
}

/* ---------------- mağaza detayı ---------------- */

const D = { domain: "", cat: "", q: "", img: "", sort: "images", dir: "desc", page: 1 };
let PRODUCTS = [];   // o anki sayfanın ürünleri — lightbox buradan besleniyor

async function loadDetail(domain) {
  D.domain = domain;
  const p = new URLSearchParams({ d: domain, cat: D.cat, q: D.q, img: D.img, sort: D.sort, dir: D.dir, page: D.page, size: 40 });
  const res = await fetch(`/api/store?${p}`, { cache: "no-store" });
  if (!res.ok) { el("dBody").innerHTML = `<div class="empty">Bu mağaza için detay yok. <code>node details.mjs ${esc(domain)}</code> çalıştır.</div>`; return; }
  const s = await res.json();
  PRODUCTS = s.products;

  el("dTitle").innerHTML = `<a href="https://${s.domain}" target="_blank" rel="noopener">${esc(s.domain)}</a>`;
  el("dKpis").innerHTML = [
    [fmt(s.productCount), "ürün"], [fmt(s.imageCount), "görsel"],
    [(s.imageCount / s.productCount).toFixed(2), "foto / ürün"],
    [fmt(s.withoutDescription), "açıklamasız ürün"],
  ].map(([n, l]) => `<div class="kpi"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");

  el("dCats").innerHTML = [{ name: "", count: s.productCount, label: "Tümü" }, ...s.categories]
    .map((c) => `<button class="cat${(c.name === D.cat) ? " on" : ""}" data-cat="${esc(c.name)}">${esc(c.label || c.name)} <span>${fmt(c.count)}</span></button>`).join("");

  const pages = Math.max(1, Math.ceil(s.matched / s.size));
  el("dCount").textContent = `${fmt(s.matched)} ürün · sayfa ${s.page}/${pages}`;
  el("dPrev").disabled = s.page <= 1;
  el("dNext").disabled = s.page >= pages;

  el("dBody").innerHTML = !s.products.length
    ? `<div class="empty">Bu filtrelerle ürün yok.</div>`
    : `<div class="grid">${s.products.map((p, i) => `
        <article class="card">
          <div class="thumb" data-i="${i}" role="button" tabindex="0" title="Görselleri aç">${p.images[0] ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(p.images[0])}" alt="">` : `<div class="noimg">görsel yok</div>`}
            <span class="badge${p.nImages <= 1 ? " low" : ""}">${p.nImages} 📷</span></div>
          <div class="cbody">
            <a class="ctitle" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>
            <div class="ctype">${esc(p.type || "(kategorisiz)")}</div>
            <div class="cmeta">${p.price != null ? `${fmt(p.price)} ₺` : "—"}${p.hasDesc ? "" : ` · <span class="warn">açıklama yok</span>`}</div>
            ${p.desc ? `<p class="cdesc">${esc(p.desc)}</p>` : ""}
          </div>
        </article>`).join("")}</div>`;
}

/* ---------------- yönlendirme ---------------- */

function route() {
  const m = location.hash.match(/^#s=(.+)$/);
  if (m) {
    const domain = decodeURIComponent(m[1]);
    if (domain !== D.domain) { D.cat = ""; D.q = ""; D.img = ""; D.page = 1; el("dq").value = ""; el("dimg").value = ""; }
    el("listView").hidden = true; el("detailView").hidden = false;
    loadDetail(domain);
  } else {
    el("detailView").hidden = true; el("listView").hidden = false;
    D.domain = "";
  }
}

["q", "seg", "fit", "onlymail", "showall", "sort"].forEach((id) => el(id).addEventListener("input", renderList));

el("storeList").addEventListener("click", (e) => {
  const b = e.target.closest(".copy");
  if (b) {
    navigator.clipboard.writeText(decodeURIComponent(b.dataset.c));
    b.textContent = "kopyalandı"; setTimeout(() => (b.textContent = "kopyala"), 1200);
    return;
  }
  // Şeritteki görsele tıklayınca o markanın kapaklarını büyük göster.
  const sh = e.target.closest(".sh");
  if (!sh) return;
  const strip = sh.closest(".strip");
  const row = ROWS.find((r) => r.domain === strip.dataset.d);
  if (!row?.covers?.length) return;
  openCovers(row, Number(sh.dataset.ci));
});

el("dCats").addEventListener("click", (e) => {
  const b = e.target.closest(".cat"); if (!b) return;
  D.cat = b.dataset.cat; D.page = 1; loadDetail(D.domain);
});
let t;
el("dq").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { D.q = el("dq").value; D.page = 1; loadDetail(D.domain); }, 250); });
el("dimg").addEventListener("change", () => { D.img = el("dimg").value; D.page = 1; loadDetail(D.domain); });
el("dsort").addEventListener("change", () => { const [s, d] = el("dsort").value.split(":"); D.sort = s; D.dir = d; D.page = 1; loadDetail(D.domain); });
el("dPrev").addEventListener("click", () => { D.page = Math.max(1, D.page - 1); loadDetail(D.domain); window.scrollTo(0, 0); });
el("dNext").addEventListener("click", () => { D.page += 1; loadDetail(D.domain); window.scrollTo(0, 0); });

/* ---------------- görsel önizleme ---------------- */

const LB = { imgs: [], i: 0, product: null };

// Ana sayfadaki şerit için: kapak görsellerini aynı önizleyicide açar.
function openCovers(row, index) {
  const covers = row.covers;
  LB.imgs = covers.map((c) => c.image);
  LB.i = index;
  LB.product = { title: row.domain, nImages: covers.length, url: `https://${row.domain}` };
  LB.labels = covers.map((c) => c.label || c.title || "");
  el("lbTitle").textContent = `${row.domain} — ${LB.labels[index] || ""}`;
  el("lbOpen").href = `https://${row.domain}`;
  el("lb").hidden = false;
  document.body.style.overflow = "hidden";
  paintLightbox();
}

function openLightbox(index) {
  const p = PRODUCTS[index];
  if (!p || !p.images.length) return;
  LB.product = p; LB.imgs = p.images; LB.i = 0; LB.labels = null;
  el("lbTitle").textContent = p.title;
  el("lbOpen").href = p.url;
  el("lb").hidden = false;
  document.body.style.overflow = "hidden";
  paintLightbox();
}

function paintLightbox() {
  const { imgs, i, product } = LB;
  el("lbImg").src = imgs[i];
  // Kayıtlarda en fazla 12 görsel tutuluyor; ürünün gerçek sayısı daha fazlaysa onu da göster.
  const shown = imgs.length;
  el("lbCount").textContent = product.nImages > shown
    ? `${i + 1} / ${shown} (ürün toplam ${product.nImages})`
    : `${i + 1} / ${shown}`;
  if (LB.labels) el("lbTitle").textContent = `${product.title} — ${LB.labels[i] || ""}`;
  el("lbStrip").innerHTML = imgs
    .map((src, k) => `<img referrerpolicy="no-referrer" src="${esc(src)}" data-k="${k}" class="${k === i ? "on" : ""}" alt="">`).join("");
  const on = el("lbStrip").querySelector("img.on");
  if (on) on.scrollIntoView({ block: "nearest", inline: "nearest" });
  el("lbPrev").hidden = imgs.length < 2;
  el("lbNext").hidden = imgs.length < 2;
}

function closeLightbox() {
  el("lb").hidden = true;
  el("lbImg").src = "";
  document.body.style.overflow = "";
}
const step = (d) => { if (!LB.imgs.length) return; LB.i = (LB.i + d + LB.imgs.length) % LB.imgs.length; paintLightbox(); };

el("dBody").addEventListener("click", (e) => {
  const t = e.target.closest(".thumb");
  if (!t) return;
  openLightbox(Number(t.dataset.i));
});
el("dBody").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const t = e.target.closest(".thumb");
  if (!t) return;
  e.preventDefault(); openLightbox(Number(t.dataset.i));
});
el("lbX").addEventListener("click", closeLightbox);
el("lbPrev").addEventListener("click", () => step(-1));
el("lbNext").addEventListener("click", () => step(1));
el("lbStrip").addEventListener("click", (e) => {
  const im = e.target.closest("img[data-k]");
  if (!im) return;
  LB.i = Number(im.dataset.k); paintLightbox();
});
el("lb").addEventListener("click", (e) => { if (e.target.id === "lb" || e.target.classList.contains("lb-stage")) closeLightbox(); });
window.addEventListener("keydown", (e) => {
  if (el("lb").hidden) return;
  if (e.key === "Escape") closeLightbox();
  else if (e.key === "ArrowLeft") step(-1);
  else if (e.key === "ArrowRight") step(1);
});

/* ---------------- tüm mağazalarda arama ---------------- */

let GMODE = "local";
let GRES = [];
let gTimer;
let gStream = null;   // açık SSE bağlantısı

function cardHtml(r, i) {
  return `<article class="rcard">
    <div class="rthumb" data-gi="${i}">
      <img loading="lazy" referrerpolicy="no-referrer" src="${esc(r.i)}" alt="">
      <span class="rstore">${esc(r.d)}</span>
    </div>
    <div class="rbody">
      <a class="rtitle" href="${esc(r.u)}" target="_blank" rel="noopener">${esc(r.t)}</a>
      <div class="rmeta">${r.pr != null ? fmt(r.pr) : "—"}${r.n ? ` · ${r.n} görsel` : ""}</div>
    </div>
  </article>`;
}

// Canlı mod: ilk parti gelir gelmez ekrana basılır, kalanı geldikçe eklenir.
function runLiveStream(q, seg) {
  if (gStream) gStream.close();
  GRES = [];
  el("gresults").hidden = false;
  el("gresults").innerHTML = `<div class="rgrid" id="rgrid"></div>`;
  el("gmeta").hidden = false;
  el("gmeta").textContent = "mağazalar sorgulanıyor…";

  const es = new EventSource(`/api/search/stream?q=${encodeURIComponent(q)}&seg=${encodeURIComponent(seg)}`);
  gStream = es;
  const seen = new Set();

  es.addEventListener("batch", (ev) => {
    const d = JSON.parse(ev.data);
    const fresh = d.results.filter((r) => r.i && !seen.has(r.u) && (seen.add(r.u), true));
    // Tek marka blok halinde yığılmasın diye araya karıştırarak ekliyoruz.
    fresh.sort(() => Math.random() - 0.5);
    const grid = el("rgrid");
    if (grid) grid.insertAdjacentHTML("beforeend", fresh.map((r, k) => cardHtml(r, GRES.length + k)).join(""));
    GRES.push(...fresh);
    el("gmeta").innerHTML = `<b>${fmt(GRES.length)}</b> sonuç · <b>${fmt(d.done)}/${fmt(d.total)}</b> mağaza tarandı${d.done < d.total ? " …" : ""}`;
  });

  es.addEventListener("done", () => {
    es.close(); gStream = null;
    if (!GRES.length) el("gresults").innerHTML = `<div class="empty">"${esc(q)}" için canlı sonuç yok.</div>`;
    else el("gmeta").innerHTML = `<b>${fmt(GRES.length)}</b> sonuç · tüm mağazalar tarandı`;
  });

  es.onerror = () => { es.close(); gStream = null; el("gmeta").textContent = `${fmt(GRES.length)} sonuç · bağlantı kapandı`; };
}

async function runGlobalSearch() {
  const q = el("gq").value.trim();
  const seg = el("seg").value;

  if (gStream) { gStream.close(); gStream = null; }

  if (!q) {
    el("gresults").hidden = true; el("gmeta").hidden = true; el("browse").hidden = false;
    return;
  }
  el("browse").hidden = true;

  if (GMODE === "live") return runLiveStream(q, seg);

  el("gmeta").hidden = false;
  el("gmeta").textContent = GMODE === "live" ? "canlı aranıyor…" : "aranıyor…";

  const p = new URLSearchParams({ q, mode: GMODE, seg });
  let data;
  try { data = await (await fetch(`/api/search?${p}`, { cache: "no-store" })).json(); }
  catch { el("gmeta").textContent = "arama başarısız"; return; }

  GRES = data.results || [];
  const shown = GRES.length;
  el("gmeta").innerHTML =
    `<b>${fmt(shown)}</b> ürün gösteriliyor` +
    (data.matched > shown ? ` · toplam <b>${fmt(data.matched)}</b> eşleşme` : "") +
    ` · <b>${fmt(data.stores)}</b> mağaza · ${fmt(data.indexed)} kayıtlık yerel indeks`;

  el("gresults").hidden = false;
  el("gresults").innerHTML = !GRES.length
    ? `<div class="empty">"${esc(q)}" için sonuç yok.</div>`
    : `<div class="rgrid">${GRES.map(cardHtml).join("")}</div>`;
}

el("gq").addEventListener("input", () => { clearTimeout(gTimer); gTimer = setTimeout(runGlobalSearch, GMODE === "live" ? 550 : 180); });
document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".mode").forEach((x) => x.classList.toggle("on", x === b));
  GMODE = b.dataset.m;
  runGlobalSearch();
}));
el("seg").addEventListener("change", () => { if (el("gq").value.trim()) runGlobalSearch(); });

el("gresults").addEventListener("click", (e) => {
  const t = e.target.closest(".rthumb");
  if (!t) return;
  const r = GRES[Number(t.dataset.gi)];
  if (!r?.im?.length) return;
  LB.imgs = r.im; LB.i = 0; LB.labels = null;
  LB.product = { title: `${r.d} — ${r.t}`, nImages: r.n || r.im.length, url: r.u };
  el("lbTitle").textContent = LB.product.title;
  el("lbOpen").href = r.u;
  el("lb").hidden = false;
  document.body.style.overflow = "hidden";
  paintLightbox();
});

window.addEventListener("hashchange", route);
loadList().then(route);
