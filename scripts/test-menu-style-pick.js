// 🧪 Hazır menü stili seçimi — rota düzeyinde uçtan uca test (geçici)
// Router'ı auth olmadan bir test sunucusuna bağlar, gerçek DB'ye yazar,
// sonunda açtığı projeyi siler. Model çağrısı yapmaz.
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { supabaseAdmin: db } = require("../src/supabaseClient");
const routes = require("../src/routes/adminMenuStudioRoutes");

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use("/api/admin-dashboard", routes);

const ok = (c, m) => console.log(`${c ? "✅" : "❌"} ${m}`);

(async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/admin-dashboard/menu-studio`;
  const http = axios.create({ baseURL: base, validateStatus: () => true });

  // Havuzdan iki farklı stil seç (biri çok sayfalı olsun diye en çok görselli olan)
  const { data: styles } = await db
    .from("menu_styles")
    .select("id, name, category, image_urls")
    .eq("active", true)
    .limit(50);
  const usable = (styles || []).filter((s) => (s.image_urls || []).length);
  if (usable.length < 2) throw new Error("Testte kullanılacak en az 2 aktif stil gerek");
  usable.sort((a, b) => b.image_urls.length - a.image_urls.length);
  const s1 = usable[0];
  const s2 = usable.find((s) => s.id !== s1.id);

  let projectId = null;
  try {
    // 1) Stil seçerek proje aç
    const created = await http.post("/projects", { restaurant_name: "TEST — stil seçimi", menu_style_id: s1.id });
    projectId = created.data?.project?.id;
    ok(!!projectId, "proje oluşturuldu");
    const p0 = created.data.project;
    ok(p0.menu_style_id === s1.id, "açılışta stil bağlandı");
    ok(p0.reference_image_url === s1.image_urls[0], "kapak referans oldu");
    ok(
      JSON.stringify(p0.reference_image_urls) === JSON.stringify(s1.image_urls.slice(1, 6)),
      `stilin diğer sayfaları da referansa geçti (${s1.image_urls.length} sayfa)`,
    );

    // Türetilmiş alanları doldurup "eski stil" durumunu taklit et
    await db
      .from("admin_menu_projects")
      .update({ photo_style: "yandan çekim", photo_cutout: true, design_spec: { x: 1 }, redesign_pending: false })
      .eq("id", projectId);
    await db.from("admin_menu_items").insert({
      project_id: projectId,
      name: "Test yemek",
      image_url: "https://example.com/eski.png",
      styled_version: 1,
      position: 1,
    });

    // 2) Başka bir stile geç — türetilmiş her şey geçersizleşmeli
    const before = (await http.get(`/projects/${projectId}`)).data.project;
    const patched = await http.patch(`/projects/${projectId}`, { menu_style_id: s2.id });
    const p1 = patched.data.project;
    ok(p1.menu_style_id === s2.id, "stil değişti");
    ok(p1.reference_image_url === s2.image_urls[0], "referans yeni stile geçti");
    ok(p1.photo_style === null, "fotoğraf stili sıfırlandı");
    ok(p1.photo_cutout === false, "kesme kararı sıfırlandı");
    ok(p1.design_spec === null, "katman künyesi sıfırlandı");
    ok(p1.style_version === before.style_version + 1, `stil sürümü arttı (${before.style_version} → ${p1.style_version})`);
    ok(p1.redesign_pending === true, "baştan tasarım gerekiyor bayrağı kalktı");

    const { data: items } = await db.from("admin_menu_items").select("styled_version").eq("project_id", projectId);
    ok(items[0].styled_version !== p1.style_version, "mevcut fotoğraf 'yenilenmeli' durumuna düştü");

    // 3) Elle görsel yüklemek stil bağını koparmalı (karışıklık olmasın)
    await db.from("admin_menu_projects").update({ reference_image_url: "https://example.com/elle.png", menu_style_id: s2.id }).eq("id", projectId);
    const cleared = await http.patch(`/projects/${projectId}`, { reference_image_url: null });
    ok(cleared.data.project.menu_style_id === null, "örnek kaldırılınca stil bağı da koptu");

    // 4) Astra'ya kaç referans görsel gideceği
    const { referenceImages } = require("../src/utils/menuStudioAstra");
    const refs = referenceImages({ reference_image_url: s1.image_urls[0], reference_image_urls: s1.image_urls.slice(1, 6) });
    ok(refs.length === Math.min(s1.image_urls.length, 6), `modele ${refs.length} referans sayfa gidecek`);
  } finally {
    if (projectId) await db.from("admin_menu_projects").delete().eq("id", projectId);
    server.close();
    console.log("\ntemizlendi");
  }
  process.exit(0);
})().catch((e) => {
  console.error("HATA:", e.message);
  process.exit(1);
});
