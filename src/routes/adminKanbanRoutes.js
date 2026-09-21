// 🗂️ Yönetim panosu (Kanban) — admin paneli "Pano" sayfasının API'si.
// Tablolar: admin_kanban_boards / columns / labels / cards / comments / activity
// (bkz. migrations/admin_kanban.sql). Tüm uçlar app.js'te requireAdmin arkasında.
//
// SIRALAMA: position double precision. Yeni kayıt sona eklenirken son + STEP,
// araya bırakılırken istemci komşuların ortasını gönderir. İki komşu birbirine
// çok yaklaşırsa (< EPSILON) ilgili kolon yeniden numaralandırılır.
const express = require("express");
const router = express.Router();
const { supabaseAdmin, supabase } = require("../supabaseClient");

const db = supabaseAdmin || supabase;

const STEP = 1000;
const EPSILON = 0.0005;
const PRIORITIES = ["urgent", "high", "normal", "low"];
const LABEL_COLORS = ["slate", "red", "amber", "emerald", "blue", "violet", "pink", "teal"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);

/** Girdi temizliği: boş string → null, uzunluk sınırı. */
const text = (v, max = 500) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
};

const fail = (res, status, error) => res.status(status).json({ success: false, error });

/** Kart geçmişi — hata hiçbir zaman ana işlemi düşürmez. */
async function logActivity(boardId, cardId, type, message, meta = {}) {
  if (!boardId) return;
  try {
    await db.from("admin_kanban_activity").insert({
      board_id: boardId,
      card_id: cardId || null,
      type,
      message: text(message, 300),
      meta,
    });
  } catch (err) {
    console.warn("[kanban] activity log atlandı:", err.message);
  }
}

/** Bir listenin sonuna eklenecek position değeri. */
async function nextPosition(table, column, value) {
  const { data } = await db
    .from(table)
    .select("position")
    .eq(column, value)
    .order("position", { ascending: false })
    .limit(1);
  const last = data && data[0] ? Number(data[0].position) : 0;
  return (Number.isFinite(last) ? last : 0) + STEP;
}

/** Kolon içindeki kartların position'larını STEP aralıklarla yeniden yaz. */
async function normalizeColumn(columnId) {
  const { data } = await db
    .from("admin_kanban_cards")
    .select("id")
    .eq("column_id", columnId)
    .eq("archived", false)
    .order("position", { ascending: true });
  if (!data || data.length < 2) return;
  await Promise.all(
    data.map((row, i) =>
      db.from("admin_kanban_cards").update({ position: (i + 1) * STEP }).eq("id", row.id),
    ),
  );
}

/** Hiç pano yoksa ilk açılışta çalışan varsayılan pano. */
async function ensureDefaultBoard() {
  const { data: existing, error } = await db
    .from("admin_kanban_boards")
    .select("id")
    .limit(1);
  if (error) throw error;
  if (existing && existing.length) return;

  const { data: board, error: bErr } = await db
    .from("admin_kanban_boards")
    .insert({ title: "Diress yol haritası", description: "Ürün, sunucu ve pazarlama işleri.", position: STEP })
    .select()
    .single();
  if (bErr) throw bErr;

  const columns = [
    { title: "Fikirler", is_done: false },
    { title: "Bu hafta", is_done: false },
    { title: "Yapılıyor", is_done: false, wip_limit: 3 },
    { title: "İncelemede", is_done: false },
    { title: "Bitti", is_done: true },
  ];
  await db.from("admin_kanban_columns").insert(
    columns.map((c, i) => ({ ...c, board_id: board.id, position: (i + 1) * STEP })),
  );

  const labels = [
    { name: "Hata", color: "red" },
    { name: "Özellik", color: "blue" },
    { name: "Tasarım", color: "violet" },
    { name: "Sunucu", color: "amber" },
    { name: "Mobil", color: "emerald" },
    { name: "Web", color: "teal" },
  ];
  await db.from("admin_kanban_labels").insert(
    labels.map((l, i) => ({ ...l, board_id: board.id, position: (i + 1) * STEP })),
  );
}

/* ─────────────────────────── PANOLAR ─────────────────────────── */

// Pano listesi + açık kart sayıları
router.get("/kanban/boards", async (req, res) => {
  try {
    await ensureDefaultBoard();
    const { data: boards, error } = await db
      .from("admin_kanban_boards")
      .select("*")
      .order("archived", { ascending: true })
      .order("position", { ascending: true });
    if (error) throw error;

    const { data: cards } = await db
      .from("admin_kanban_cards")
      .select("board_id, archived, completed_at, due_date");

    const stats = {};
    for (const c of cards || []) {
      const s = (stats[c.board_id] = stats[c.board_id] || { open: 0, done: 0, overdue: 0 });
      if (c.archived) continue;
      if (c.completed_at) s.done += 1;
      else {
        s.open += 1;
        if (c.due_date && c.due_date < new Date().toISOString().slice(0, 10)) s.overdue += 1;
      }
    }

    res.json({
      success: true,
      boards: (boards || []).map((b) => ({ ...b, stats: stats[b.id] || { open: 0, done: 0, overdue: 0 } })),
    });
  } catch (err) {
    console.error("[kanban] boards listesi hatası:", err.message);
    fail(res, 500, "Panolar yüklenemedi");
  }
});

// Tek panonun tamamı: kolonlar + kartlar + etiketler (tek istek)
router.get("/kanban/boards/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz pano kimliği");

    const [boardRes, columnsRes, cardsRes, labelsRes] = await Promise.all([
      db.from("admin_kanban_boards").select("*").eq("id", id).maybeSingle(),
      db.from("admin_kanban_columns").select("*").eq("board_id", id).order("position", { ascending: true }),
      db.from("admin_kanban_cards").select("*").eq("board_id", id).order("position", { ascending: true }),
      db.from("admin_kanban_labels").select("*").eq("board_id", id).order("position", { ascending: true }),
    ]);
    if (boardRes.error) throw boardRes.error;
    if (!boardRes.data) return fail(res, 404, "Pano bulunamadı");

    // Kart rozetlerindeki yorum sayısı — tek sorgu, sayım JS tarafında
    const cardIds = (cardsRes.data || []).map((c) => c.id);
    const commentCounts = {};
    if (cardIds.length) {
      const { data: rows } = await db
        .from("admin_kanban_comments")
        .select("card_id")
        .in("card_id", cardIds);
      for (const r of rows || []) commentCounts[r.card_id] = (commentCounts[r.card_id] || 0) + 1;
    }

    res.json({
      success: true,
      board: boardRes.data,
      columns: columnsRes.data || [],
      cards: cardsRes.data || [],
      labels: labelsRes.data || [],
      commentCounts,
    });
  } catch (err) {
    console.error("[kanban] board detay hatası:", err.message);
    fail(res, 500, "Pano yüklenemedi");
  }
});

router.post("/kanban/boards", async (req, res) => {
  try {
    const title = text(req.body?.title, 120);
    if (!title) return fail(res, 400, "Pano adı gerekli");
    const position = await nextPosition("admin_kanban_boards", "archived", false);
    const { data, error } = await db
      .from("admin_kanban_boards")
      .insert({ title, description: text(req.body?.description, 500), position })
      .select()
      .single();
    if (error) throw error;

    // Yeni pano boş kalmasın — aynı varsayılan iskelet
    await db.from("admin_kanban_columns").insert(
      ["Fikirler", "Yapılıyor", "Bitti"].map((t, i) => ({
        board_id: data.id,
        title: t,
        position: (i + 1) * STEP,
        is_done: t === "Bitti",
      })),
    );

    res.json({ success: true, board: data });
  } catch (err) {
    console.error("[kanban] board oluşturma hatası:", err.message);
    fail(res, 500, "Pano oluşturulamadı");
  }
});

router.patch("/kanban/boards/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz pano kimliği");
    const patch = {};
    if ("title" in req.body) {
      const title = text(req.body.title, 120);
      if (!title) return fail(res, 400, "Pano adı boş olamaz");
      patch.title = title;
    }
    if ("description" in req.body) patch.description = text(req.body.description, 500);
    if ("archived" in req.body) patch.archived = !!req.body.archived;
    if (!Object.keys(patch).length) return fail(res, 400, "Güncellenecek alan yok");

    const { data, error } = await db.from("admin_kanban_boards").update(patch).eq("id", id).select().single();
    if (error) throw error;
    res.json({ success: true, board: data });
  } catch (err) {
    console.error("[kanban] board güncelleme hatası:", err.message);
    fail(res, 500, "Pano güncellenemedi");
  }
});

router.delete("/kanban/boards/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz pano kimliği");
    const { error } = await db.from("admin_kanban_boards").delete().eq("id", id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("[kanban] board silme hatası:", err.message);
    fail(res, 500, "Pano silinemedi");
  }
});

/* ─────────────────────────── KOLONLAR ─────────────────────────── */

router.post("/kanban/boards/:id/columns", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz pano kimliği");
    const title = text(req.body?.title, 80);
    if (!title) return fail(res, 400, "Kolon adı gerekli");
    const position = await nextPosition("admin_kanban_columns", "board_id", id);
    const { data, error } = await db
      .from("admin_kanban_columns")
      .insert({
        board_id: id,
        title,
        position,
        wip_limit: Number.isFinite(Number(req.body?.wip_limit)) && Number(req.body.wip_limit) > 0
          ? Math.min(99, Math.round(Number(req.body.wip_limit)))
          : null,
        is_done: !!req.body?.is_done,
      })
      .select()
      .single();
    if (error) throw error;
    await logActivity(id, null, "column_created", `"${title}" kolonu eklendi`);
    res.json({ success: true, column: data });
  } catch (err) {
    console.error("[kanban] kolon oluşturma hatası:", err.message);
    fail(res, 500, "Kolon oluşturulamadı");
  }
});

router.patch("/kanban/columns/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz kolon kimliği");
    const patch = {};
    if ("title" in req.body) {
      const title = text(req.body.title, 80);
      if (!title) return fail(res, 400, "Kolon adı boş olamaz");
      patch.title = title;
    }
    if ("wip_limit" in req.body) {
      const n = Number(req.body.wip_limit);
      patch.wip_limit = Number.isFinite(n) && n > 0 ? Math.min(99, Math.round(n)) : null;
    }
    if ("is_done" in req.body) patch.is_done = !!req.body.is_done;
    if ("archived" in req.body) patch.archived = !!req.body.archived;
    if ("position" in req.body && Number.isFinite(Number(req.body.position))) {
      patch.position = Number(req.body.position);
    }
    if (!Object.keys(patch).length) return fail(res, 400, "Güncellenecek alan yok");

    const { data, error } = await db.from("admin_kanban_columns").update(patch).eq("id", id).select().single();
    if (error) throw error;
    res.json({ success: true, column: data });
  } catch (err) {
    console.error("[kanban] kolon güncelleme hatası:", err.message);
    fail(res, 500, "Kolon güncellenemedi");
  }
});

// Kolonu yeni sıraya taşı (istemci hedef position'ı hesaplar)
router.post("/kanban/columns/:id/move", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz kolon kimliği");
    const position = Number(req.body?.position);
    if (!Number.isFinite(position)) return fail(res, 400, "Geçersiz konum");

    const { data, error } = await db
      .from("admin_kanban_columns")
      .update({ position })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    // Komşular sıkıştıysa panodaki tüm kolonları yeniden numaralandır
    const { data: siblings } = await db
      .from("admin_kanban_columns")
      .select("id, position")
      .eq("board_id", data.board_id)
      .order("position", { ascending: true });
    let tight = false;
    for (let i = 1; i < (siblings || []).length; i++) {
      if (Math.abs(siblings[i].position - siblings[i - 1].position) < EPSILON) tight = true;
    }
    if (tight) {
      await Promise.all(
        siblings.map((c, i) =>
          db.from("admin_kanban_columns").update({ position: (i + 1) * STEP }).eq("id", c.id),
        ),
      );
    }

    res.json({ success: true, column: data, renumbered: tight });
  } catch (err) {
    console.error("[kanban] kolon taşıma hatası:", err.message);
    fail(res, 500, "Kolon taşınamadı");
  }
});

router.delete("/kanban/columns/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz kolon kimliği");
    const { data: col } = await db.from("admin_kanban_columns").select("board_id, title").eq("id", id).maybeSingle();
    const { error } = await db.from("admin_kanban_columns").delete().eq("id", id);
    if (error) throw error;
    if (col) await logActivity(col.board_id, null, "column_deleted", `"${col.title}" kolonu silindi`);
    res.json({ success: true });
  } catch (err) {
    console.error("[kanban] kolon silme hatası:", err.message);
    fail(res, 500, "Kolon silinemedi");
  }
});

/* ─────────────────────────── KARTLAR ─────────────────────────── */

/** Gövdeden kart alanlarını ayıkla (create + patch ortak). */
function cardFields(body, { partial } = { partial: false }) {
  const patch = {};
  const has = (k) => k in body;

  if (has("title") || !partial) {
    const title = text(body.title, 200);
    if (!title) return { error: "Kart başlığı gerekli" };
    patch.title = title;
  }
  if (has("description")) patch.description = text(body.description, 8000);
  if (has("priority")) {
    patch.priority = PRIORITIES.includes(body.priority) ? body.priority : null;
  }
  if (has("assignee")) patch.assignee = text(body.assignee, 80);
  if (has("due_date")) {
    const d = text(body.due_date, 10);
    patch.due_date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  }
  if (has("label_ids")) {
    patch.label_ids = Array.isArray(body.label_ids) ? body.label_ids.filter(isUuid).slice(0, 20) : [];
  }
  if (has("checklist")) {
    patch.checklist = Array.isArray(body.checklist)
      ? body.checklist
          .filter((i) => i && text(i.text, 300))
          .slice(0, 100)
          .map((i) => ({
            id: text(i.id, 60) || `c_${Math.random().toString(36).slice(2, 10)}`,
            text: text(i.text, 300),
            done: !!i.done,
          }))
      : [];
  }
  if (has("links")) {
    patch.links = Array.isArray(body.links)
      ? body.links
          .filter((l) => l && text(l.url, 1000))
          .slice(0, 20)
          .map((l) => ({
            id: text(l.id, 60) || `l_${Math.random().toString(36).slice(2, 10)}`,
            label: text(l.label, 120) || text(l.url, 120),
            url: text(l.url, 1000),
          }))
      : [];
  }
  if (has("archived")) patch.archived = !!body.archived;
  return { patch };
}

router.post("/kanban/boards/:id/cards", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz pano kimliği");
    const columnId = req.body?.column_id;
    if (!isUuid(columnId)) return fail(res, 400, "Geçersiz kolon kimliği");

    const { patch, error: vErr } = cardFields(req.body || {});
    if (vErr) return fail(res, 400, vErr);

    // "Başa ekle" için istemci position gönderir; yoksa sona
    const position = Number.isFinite(Number(req.body?.position))
      ? Number(req.body.position)
      : await nextPosition("admin_kanban_cards", "column_id", columnId);

    const { data: col } = await db.from("admin_kanban_columns").select("is_done").eq("id", columnId).maybeSingle();

    const { data, error } = await db
      .from("admin_kanban_cards")
      .insert({
        ...patch,
        board_id: id,
        column_id: columnId,
        position,
        completed_at: col?.is_done ? new Date().toISOString() : null,
      })
      .select()
      .single();
    if (error) throw error;

    await logActivity(id, data.id, "card_created", "Kart oluşturuldu");
    res.json({ success: true, card: data });
  } catch (err) {
    console.error("[kanban] kart oluşturma hatası:", err.message);
    fail(res, 500, "Kart oluşturulamadı");
  }
});

router.patch("/kanban/cards/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz kart kimliği");
    const { patch, error: vErr } = cardFields(req.body || {}, { partial: true });
    if (vErr) return fail(res, 400, vErr);
    if (!Object.keys(patch).length) return fail(res, 400, "Güncellenecek alan yok");

    const { data: before } = await db
      .from("admin_kanban_cards")
      .select("board_id, archived, title")
      .eq("id", id)
      .maybeSingle();

    const { data, error } = await db.from("admin_kanban_cards").update(patch).eq("id", id).select().single();
    if (error) throw error;

    if (before && "archived" in patch && patch.archived !== before.archived) {
      await logActivity(data.board_id, id, patch.archived ? "card_archived" : "card_restored",
        patch.archived ? "Kart arşivlendi" : "Kart arşivden çıkarıldı");
    } else if (before) {
      const fields = Object.keys(patch).filter((k) => k !== "archived");
      if (fields.length) await logActivity(data.board_id, id, "card_updated", `Güncellendi: ${fields.join(", ")}`);
    }

    res.json({ success: true, card: data });
  } catch (err) {
    console.error("[kanban] kart güncelleme hatası:", err.message);
    fail(res, 500, "Kart güncellenemedi");
  }
});

// Kartı başka kolona / sıraya taşı
router.post("/kanban/cards/:id/move", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz kart kimliği");
    const columnId = req.body?.column_id;
    if (!isUuid(columnId)) return fail(res, 400, "Geçersiz kolon kimliği");
    const position = Number(req.body?.position);
    if (!Number.isFinite(position)) return fail(res, 400, "Geçersiz konum");

    const { data: current } = await db
      .from("admin_kanban_cards")
      .select("column_id, completed_at, board_id")
      .eq("id", id)
      .maybeSingle();
    if (!current) return fail(res, 404, "Kart bulunamadı");

    const [{ data: target }, { data: source }] = await Promise.all([
      db.from("admin_kanban_columns").select("title, is_done").eq("id", columnId).maybeSingle(),
      db.from("admin_kanban_columns").select("title").eq("id", current.column_id).maybeSingle(),
    ]);

    const patch = { column_id: columnId, position };
    // "Bitti" kolonuna girince tamamlandı, çıkınca geri alınır
    if (target?.is_done && !current.completed_at) patch.completed_at = new Date().toISOString();
    if (!target?.is_done && current.completed_at) patch.completed_at = null;

    const { data, error } = await db.from("admin_kanban_cards").update(patch).eq("id", id).select().single();
    if (error) throw error;

    // Hedef kolonda sıkışma varsa yeniden numaralandır
    const { data: siblings } = await db
      .from("admin_kanban_cards")
      .select("position")
      .eq("column_id", columnId)
      .eq("archived", false)
      .order("position", { ascending: true });
    let tight = false;
    for (let i = 1; i < (siblings || []).length; i++) {
      if (Math.abs(siblings[i].position - siblings[i - 1].position) < EPSILON) tight = true;
    }
    if (tight) await normalizeColumn(columnId);

    if (current.column_id !== columnId) {
      await logActivity(data.board_id, id, "card_moved",
        `${source?.title || "?"} → ${target?.title || "?"}`,
        { from: current.column_id, to: columnId });
    }

    res.json({ success: true, card: data, renumbered: tight });
  } catch (err) {
    console.error("[kanban] kart taşıma hatası:", err.message);
    fail(res, 500, "Kart taşınamadı");
  }
});

router.delete("/kanban/cards/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz kart kimliği");
    const { error } = await db.from("admin_kanban_cards").delete().eq("id", id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("[kanban] kart silme hatası:", err.message);
    fail(res, 500, "Kart silinemedi");
  }
});

/* ─────────────────────── YORUM + GEÇMİŞ ─────────────────────── */

router.get("/kanban/cards/:id/thread", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz kart kimliği");
    const [comments, activity] = await Promise.all([
      db.from("admin_kanban_comments").select("*").eq("card_id", id).order("created_at", { ascending: true }),
      db.from("admin_kanban_activity").select("*").eq("card_id", id).order("created_at", { ascending: false }).limit(50),
    ]);
    res.json({ success: true, comments: comments.data || [], activity: activity.data || [] });
  } catch (err) {
    console.error("[kanban] kart akışı hatası:", err.message);
    fail(res, 500, "Kart akışı yüklenemedi");
  }
});

router.post("/kanban/cards/:id/comments", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz kart kimliği");
    const body = text(req.body?.body, 4000);
    if (!body) return fail(res, 400, "Yorum boş olamaz");
    const { data, error } = await db
      .from("admin_kanban_comments")
      .insert({ card_id: id, body, author: text(req.body?.author, 80) || req.adminUser?.email || "admin" })
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, comment: data });
  } catch (err) {
    console.error("[kanban] yorum ekleme hatası:", err.message);
    fail(res, 500, "Yorum eklenemedi");
  }
});

router.delete("/kanban/comments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz yorum kimliği");
    const { error } = await db.from("admin_kanban_comments").delete().eq("id", id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("[kanban] yorum silme hatası:", err.message);
    fail(res, 500, "Yorum silinemedi");
  }
});

/* ─────────────────────────── ETİKETLER ─────────────────────────── */

router.post("/kanban/boards/:id/labels", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz pano kimliği");
    const name = text(req.body?.name, 60);
    if (!name) return fail(res, 400, "Etiket adı gerekli");
    const color = LABEL_COLORS.includes(req.body?.color) ? req.body.color : "slate";
    const position = await nextPosition("admin_kanban_labels", "board_id", id);
    const { data, error } = await db
      .from("admin_kanban_labels")
      .insert({ board_id: id, name, color, position })
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, label: data });
  } catch (err) {
    console.error("[kanban] etiket oluşturma hatası:", err.message);
    fail(res, 500, "Etiket oluşturulamadı");
  }
});

router.patch("/kanban/labels/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz etiket kimliği");
    const patch = {};
    if ("name" in req.body) {
      const name = text(req.body.name, 60);
      if (!name) return fail(res, 400, "Etiket adı boş olamaz");
      patch.name = name;
    }
    if ("color" in req.body) patch.color = LABEL_COLORS.includes(req.body.color) ? req.body.color : "slate";
    if (!Object.keys(patch).length) return fail(res, 400, "Güncellenecek alan yok");
    const { data, error } = await db.from("admin_kanban_labels").update(patch).eq("id", id).select().single();
    if (error) throw error;
    res.json({ success: true, label: data });
  } catch (err) {
    console.error("[kanban] etiket güncelleme hatası:", err.message);
    fail(res, 500, "Etiket güncellenemedi");
  }
});

router.delete("/kanban/labels/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz etiket kimliği");
    const { error } = await db.from("admin_kanban_labels").delete().eq("id", id);
    if (error) throw error;
    // Kartlardaki referanslar arayüzde zaten yok sayılır; temizlik için bırakılır.
    res.json({ success: true });
  } catch (err) {
    console.error("[kanban] etiket silme hatası:", err.message);
    fail(res, 500, "Etiket silinemedi");
  }
});

module.exports = router;
