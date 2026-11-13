// DM — Dictionary Mostafa
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_VERSION } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/* ---------------- helpers ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const faDigits = (s) => String(s).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
const localDate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDate(d); };
const norm = (w) => String(w || "").trim().toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16);
}));

function toast(msg, ms = 2200) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}

/* ---------------- settings ---------------- */
const SETTINGS_KEY = "dm.settings";
const settings = Object.assign(
  { accent: "en-US", rate: 0.9, reviewLimit: 30, direction: "en-fa" },
  JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")
);
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

/* ---------------- local store + sync ---------------- */
// Leitner: box -> days until next review after a correct answer
const INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 30 };
const FIELDS = ["id", "word", "data", "my_note", "source", "context", "box", "next_review", "correct", "wrong", "deleted", "created_at"];
const WORDS_KEY = "dm.words";
const SYNC_KEY = "dm.lastSync";

let words = JSON.parse(localStorage.getItem(WORDS_KEY) || "{}");
let session = null;
let syncing = false;

const saveLocal = () => localStorage.setItem(WORDS_KEY, JSON.stringify(words));
const allWords = () => Object.values(words).filter((w) => !w.deleted);
const findWord = (w) => allWords().find((x) => norm(x.word) === norm(w));
const dueWords = () => allWords().filter((w) => w.next_review <= localDate());

function putWord(rec) {
  rec._dirty = true;
  rec._local_updated = Date.now();
  words[rec.id] = rec;
  saveLocal();
  refreshBadge();
  sync();
}

function setSync(state, title) {
  const el = $("#syncStatus");
  el.className = "sync " + state;
  el.title = title;
}

async function sync() {
  if (!session || syncing) return;
  if (!navigator.onLine) { setSync("off", "آفلاین — بعداً همگام می‌شه"); return; }
  syncing = true;
  setSync("busy", "در حال همگام‌سازی…");
  try {
    // 1) push local changes
    const dirty = Object.values(words).filter((w) => w._dirty);
    if (dirty.length) {
      const rows = dirty.map((w) => Object.fromEntries(FIELDS.map((f) => [f, w[f] ?? null])));
      const { error } = await sb.from("words").upsert(rows, { onConflict: "id" });
      if (error) throw error;
      dirty.forEach((w) => { if (words[w.id]) delete words[w.id]._dirty; });
    }
    // 2) pull changes from other devices
    let since = localStorage.getItem(SYNC_KEY) || "1970-01-01T00:00:00Z";
    let maxSeen = since;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("words").select("*")
        .gt("updated_at", since).order("updated_at", { ascending: true }).range(from, from + 999);
      if (error) throw error;
      for (const row of data) {
        const local = words[row.id];
        if (!local || !local._dirty) words[row.id] = row;
        if (row.updated_at > maxSeen) maxSeen = row.updated_at;
      }
      if (data.length < 1000) break;
    }
    localStorage.setItem(SYNC_KEY, maxSeen);
    saveLocal();
    setSync("ok", "همگام شد ✓");
    refreshBadge();
    if (currentTab === "words" && $("#modal").classList.contains("hidden") && document.activeElement?.id !== "q") render();
  } catch (e) {
    console.error(e);
    setSync("off", "خطای همگام‌سازی: " + (e.message || e));
  } finally {
    syncing = false;
  }
}

window.addEventListener("online", sync);
setInterval(sync, 5 * 60 * 1000);

/* ---------------- AI lookup ---------------- */
const lookupCache = new Map();
async function lookup(word, context = "") {
  const key = norm(word) + "|" + context;
  if (lookupCache.has(key)) return lookupCache.get(key);
  const { data, error } = await sb.functions.invoke("lookup", { body: { word, context } });
  if (error) {
    let msg = error.message;
    try { const body = await error.context?.json?.(); if (body?.error) msg = body.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (!data?.ok) throw new Error(data?.error || "جواب نامعتبر");
  lookupCache.set(key, data.data);
  return data.data;
}

/* ---------------- speech ---------------- */
function speak(text, accent = settings.accent) {
  if (!("speechSynthesis" in window)) { toast("این دستگاه پخش صدا نداره"); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = accent;
  u.rate = Number(settings.rate) || 0.9;
  const v = speechSynthesis.getVoices().find((x) => x.lang === accent) ||
            speechSynthesis.getVoices().find((x) => x.lang.startsWith("en"));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}
if ("speechSynthesis" in window) speechSynthesis.getVoices();

/* ---------------- word card ---------------- */
function highlight(sentence, word) {
  const s = esc(sentence);
  const w = norm(word);
  if (!w) return s;
  return s.replace(new RegExp(`\\b(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*)`, "gi"), "<mark>$1</mark>");
}

function entryHTML(d, ctx, saved) {
  const list = (arr) => (arr || []).filter(Boolean).map((x) => `<span class="chip">${esc(x)}</span>`).join("");
  return `
  <div class="entry">
    <div class="head">
      <span class="word">${esc(d.word)}</span>
      ${d.ipa_us ? `<span class="ipa">🇺🇸 ${esc(d.ipa_us)}</span>` : ""}
      ${d.ipa_uk ? `<span class="ipa">🇬🇧 ${esc(d.ipa_uk)}</span>` : ""}
    </div>
    <div class="row" style="justify-content:flex-end;direction:ltr">
      <button class="btn small" data-say="en-US">🔊 US</button>
      <button class="btn small" data-say="en-GB">🔊 UK</button>
    </div>
    ${d.pos ? `<div class="muted">${esc(d.pos)}</div>` : ""}
    <div class="best">${esc(d.best_fa || "")}</div>
    ${d.meanings_fa?.length ? `<div class="sec"><b>معنی‌های دیگه</b><div class="chips">${list(d.meanings_fa)}</div></div>` : ""}
    ${d.definition_en ? `<div class="sec"><b>تعریف انگلیسی</b><div class="en ltr">${esc(d.definition_en)}</div></div>` : ""}
    ${ctx ? `<div class="sec"><b>جمله‌ی خودت</b><div class="ctxbox"><div class="en ltr">${highlight(ctx, d.word)}</div>${d.context_fa ? `<div>${esc(d.context_fa)}</div>` : ""}</div></div>` : ""}
    ${d.example_en ? `<div class="sec"><b>مثال</b><div class="ctxbox"><div class="en ltr">${highlight(d.example_en, d.word)}</div><div>${esc(d.example_fa || "")}</div></div></div>` : ""}
    ${d.synonyms?.length ? `<div class="sec"><b>مترادف</b><div class="chips en">${list(d.synonyms)}</div></div>` : ""}
    ${d.forms?.length ? `<div class="sec"><b>شکل‌های دیگه</b><div class="chips en">${list(d.forms)}</div></div>` : ""}
    ${d.note_fa ? `<div class="sec"><b>نکته</b><div>${esc(d.note_fa)}</div></div>` : ""}
    ${saved ? "" : `<div class="row" style="margin-top:16px"><button class="btn accent grow" id="saveWord">💾 ذخیره در دیکشنری</button></div>`}
  </div>`;
}

function openModal(html) {
  $("#modalBody").innerHTML = html;
  $("#modal").classList.remove("hidden");
}
function closeModal() { $("#modal").classList.add("hidden"); speechSynthesis?.cancel?.(); }
$("#modalClose").onclick = closeModal;
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
$("#modalBody").addEventListener("click", (e) => {
  const b = e.target.closest("[data-say]");
  if (b) speak($(".entry .word")?.textContent || "", b.dataset.say);
});

// look a word up (from any screen) and show the card
async function showLookup(rawWord, context = "", source = "") {
  const word = rawWord.trim();
  if (!word) return;
  const existing = findWord(word);
  if (existing) { showSaved(existing); return; }
  openModal(`<div class="en" style="font-size:24px;font-weight:800;text-align:center">${esc(word)}</div><div class="spinner"></div><p class="muted" style="text-align:center">دارم معنی رو پیدا می‌کنم…</p>`);
  try {
    const d = await lookup(word, context);
    if ($("#modal").classList.contains("hidden")) return;
    const already = findWord(d.word);
    if (already) { showSaved(already); return; }
    openModal(entryHTML(d, context, false));
    speak(d.word);
    $("#saveWord").onclick = () => {
      putWord({
        id: uuid(), word: d.word || word, data: d, my_note: "", source, context,
        box: 1, next_review: localDate(), correct: 0, wrong: 0, deleted: false,
        created_at: new Date().toISOString(),
      });
      toast("ذخیره شد ✓ رفت توی خونه‌ی ۱ لایتنر");
      closeModal();
      if (currentTab === "words") render();
      if (currentTab === "text") markKnown();
    };
  } catch (e) {
    openModal(`<p class="error">نشد معنی رو بگیرم 😕</p><p class="muted en ltr">${esc(e.message)}</p>
      <p class="muted">اینترنت رو چک کن. اگه درست نشد، شاید کلید Gemini تموم شده یا تنظیم نیست.</p>`);
  }
}

function showSaved(w) {
  openModal(`
    ${entryHTML(w.data || { word: w.word }, w.context, true)}
    <div class="sec" style="margin-top:14px">
      <b>یادداشت خودم</b>
      <textarea id="myNote" style="min-height:70px" placeholder="هر چی می‌خوای اینجا بنویس…">${esc(w.my_note || "")}</textarea>
    </div>
    <div class="muted" style="font-size:13px;margin-top:6px">
      خونه‌ی ${faDigits(w.box > 5 ? "یاد گرفته‌شده" : w.box)} · مرور بعدی ${faDigits(w.next_review)}
      ${w.source ? ` · منبع: <span class="en">${esc(w.source)}</span>` : ""}
      · درست ${faDigits(w.correct || 0)} / غلط ${faDigits(w.wrong || 0)}
    </div>
    <div class="row" style="margin-top:14px">
      <button class="btn primary grow" id="noteSave">ذخیره یادداشت</button>
      <button class="btn" id="resetBox">برگرد به خونه‌ی ۱</button>
      <button class="btn bad" id="delWord">حذف</button>
    </div>`);
  $("#noteSave").onclick = () => { w.my_note = $("#myNote").value; putWord(w); toast("ذخیره شد ✓"); closeModal(); };
  $("#resetBox").onclick = () => { w.box = 1; w.next_review = localDate(); putWord(w); toast("برگشت خونه‌ی ۱"); closeModal(); render(); };
  $("#delWord").onclick = () => {
    if (!confirm(`«${w.word}» از دیکشنری حذف بشه؟`)) return;
    w.deleted = true; putWord(w); closeModal(); render(); toast("حذف شد");
  };
}

/* ---------------- selection → lookup (PDF + text) ---------------- */
const selBtn = $("#selBtn");
let selInfo = null;

function sentenceAround(full, start, end) {
  if (!full) return "";
  let a = start, b = end;
  while (a > 0 && !/[.!?\n]/.test(full[a - 1]) && start - a < 300) a--;
  while (b < full.length && !/[.!?\n]/.test(full[b]) && b - end < 300) b++;
  return full.slice(a, Math.min(full.length, b + 1)).replace(/\s+/g, " ").trim();
}

function readSelection() {
  const sel = window.getSelection();
  const text = sel?.toString().trim();
  if (!text || text.length > 60 || !/[a-z]/i.test(text)) return null;
  const range = sel.getRangeAt(0);
  const holder = range.commonAncestorContainer.parentElement?.closest("[data-ctx]");
  if (!holder) return null;
  let context = "";
  const full = holder.textContent || "";
  try {
    const pre = document.createRange();
    pre.selectNodeContents(holder);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    context = sentenceAround(full, start, start + text.length);
  } catch { /* ignore */ }
  return { text, context, source: holder.dataset.ctx, rect: range.getBoundingClientRect() };
}

function onSelect() {
  setTimeout(() => {
    selInfo = readSelection();
    if (!selInfo) { selBtn.classList.add("hidden"); return; }
    const r = selInfo.rect;
    selBtn.style.top = Math.max(60, r.top - 44) + "px";
    selBtn.style.left = Math.min(window.innerWidth - 110, Math.max(8, r.left)) + "px";
    selBtn.classList.remove("hidden");
  }, 10);
}
document.addEventListener("mouseup", onSelect);
document.addEventListener("touchend", onSelect);
document.addEventListener("selectionchange", () => { if (!window.getSelection()?.toString().trim()) selBtn.classList.add("hidden"); });

function lookupSelection() {
  const info = selInfo || readSelection();
  if (!info) return;
  selBtn.classList.add("hidden");
  window.getSelection()?.removeAllRanges();
  showLookup(info.text, info.context, info.source);
}
selBtn.addEventListener("mousedown", (e) => e.preventDefault());
selBtn.addEventListener("click", lookupSelection);
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d" || e.code === "KeyD")) {
    e.preventDefault();
    lookupSelection();
  }
});

/* ---------------- views ---------------- */
let currentTab = "words";
const view = $("#view");

function refreshBadge() {
  const n = dueWords().length;
  const b = $("#dueBadge");
  b.textContent = faDigits(n);
  b.classList.toggle("hidden", n === 0);
}

const views = {
  words() {
    const q = (views.words.q || "").toLowerCase();
    const filter = views.words.filter || "all";
    let list = allWords();
    if (filter !== "all") list = list.filter((w) => String(Math.min(w.box, 6)) === filter);
    if (q) list = list.filter((w) => w.word.toLowerCase().includes(q) ||
      (w.data?.best_fa || "").includes(q) || (w.my_note || "").includes(q));
    list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    view.innerHTML = `
      <h2>دیکشنری من <span class="muted" style="font-size:14px">(${faDigits(allWords().length)} واژه)</span></h2>
      <div class="row" style="margin-bottom:12px">
        <input id="q" class="grow" placeholder="جست‌وجو بین واژه‌هام…" value="${esc(views.words.q || "")}">
        <select id="f" style="width:auto">
          <option value="all">همه</option>
          ${[1, 2, 3, 4, 5].map((i) => `<option value="${i}" ${filter == i ? "selected" : ""}>خونه‌ی ${faDigits(i)}</option>`).join("")}
          <option value="6" ${filter == "6" ? "selected" : ""}>یاد گرفته‌شده</option>
        </select>
      </div>
      <div class="wlist">
        ${list.map((w) => `
          <div class="witem" data-id="${w.id}">
            <div><div class="w">${esc(w.word)}</div><div class="m">${esc(w.data?.best_fa || "")}</div></div>
            <span class="boxtag ${w.box > 5 ? "b6" : ""}">${w.box > 5 ? "✓ یاد گرفتم" : "خونه " + faDigits(w.box)}</span>
          </div>`).join("") ||
          `<div class="card muted">هنوز واژه‌ای نداری. از «جست‌وجو»، «PDF» یا «متن» شروع کن 🙂</div>`}
      </div>`;
    $("#q").oninput = (e) => { views.words.q = e.target.value; const pos = e.target.selectionStart; render(); const i = $("#q"); i.focus(); i.setSelectionRange(pos, pos); };
    $("#f").onchange = (e) => { views.words.filter = e.target.value; render(); };
    view.querySelectorAll(".witem").forEach((el) => (el.onclick = () => showSaved(words[el.dataset.id])));
  },

  review() {
    const counts = [1, 2, 3, 4, 5, 6].map((b) => allWords().filter((w) => Math.min(w.box, 6) === b).length);
    const due = dueWords().sort((a, b) => a.box - b.box || a.next_review.localeCompare(b.next_review)).slice(0, settings.reviewLimit);
    const st = views.review.state || (views.review.state = { queue: due.map((w) => w.id), i: 0, shown: false, ok: 0, bad: 0 });
    const boxes = `<div class="boxes">${counts.map((c, i) => `<div><b>${faDigits(c)}</b>${i < 5 ? "خونه " + faDigits(i + 1) : "یاد گرفتم"}</div>`).join("")}</div>`;
    const dirSel = `
      <div class="row" style="margin-bottom:12px">
        <span class="muted">نوع مرور:</span>
        <button class="btn small ${settings.direction === "en-fa" ? "primary" : ""}" data-dir="en-fa">انگلیسی ← فارسی</button>
        <button class="btn small ${settings.direction === "fa-en" ? "primary" : ""}" data-dir="fa-en">فارسی ← انگلیسی</button>
      </div>`;

    if (st.i >= st.queue.length) {
      view.innerHTML = `<h2>جعبه‌ی لایتنر</h2>${boxes}
        <div class="card flash">
          ${st.queue.length ? `<div style="font-size:40px">🎉</div><p>مرور امروز تموم شد!<br>درست: ${faDigits(st.ok)} · غلط: ${faDigits(st.bad)}</p>`
                            : `<div style="font-size:40px">😎</div><p>امروز چیزی برای مرور نداری.</p>`}
          ${dueWords().length ? `<button class="btn primary" id="again">یه دور دیگه (${faDigits(dueWords().length)})</button>` : ""}
        </div>`;
      $("#again")?.addEventListener("click", () => { views.review.state = null; render(); });
      return;
    }

    const w = words[st.queue[st.i]];
    if (!w) { st.i++; render(); return; }
    const d = w.data || {};
    const enFirst = settings.direction === "en-fa";
    view.innerHTML = `<h2>جعبه‌ی لایتنر</h2>${boxes}${dirSel}
      <div class="card flash">
        <div class="muted" style="font-size:13px">${faDigits(st.i + 1)} از ${faDigits(st.queue.length)} · خونه‌ی ${faDigits(w.box)}</div>
        ${enFirst ? `<div class="front">${esc(w.word)}</div>
                     <button class="btn small" id="say" style="margin-top:6px">🔊</button>`
                  : `<div class="front fa">${esc(d.best_fa || "؟")}</div>`}
        ${w.context && enFirst ? `<div class="ctx muted en ltr">${highlight(w.context, w.word)}</div>` : ""}
        ${st.shown ? `
          <div class="answer">
            ${enFirst ? `<div class="best" style="font-size:24px;font-weight:700;color:var(--accent)">${esc(d.best_fa || "")}</div>
                         ${d.ipa_us ? `<div class="en muted">${esc(d.ipa_us)}</div>` : ""}`
                      : `<div class="front">${esc(w.word)}</div>${d.ipa_us ? `<div class="en muted">${esc(d.ipa_us)}</div>` : ""}`}
            ${d.meanings_fa?.length ? `<div class="muted">${esc(d.meanings_fa.join("، "))}</div>` : ""}
            ${d.example_en ? `<div class="ctxbox" style="margin-top:10px"><div class="en ltr">${highlight(d.example_en, w.word)}</div><div>${esc(d.example_fa || "")}</div></div>` : ""}
            ${w.my_note ? `<div style="margin-top:8px">📝 ${esc(w.my_note)}</div>` : ""}
            <div class="row">
              <button class="btn ok" id="yes">✅ بلد بودم</button>
              <button class="btn bad" id="no">❌ بلد نبودم</button>
            </div>
          </div>` : `<div class="row"><button class="btn primary" id="show">جواب رو نشون بده</button></div>`}
      </div>`;

    view.querySelectorAll("[data-dir]").forEach((b) => (b.onclick = () => { settings.direction = b.dataset.dir; saveSettings(); render(); }));
    $("#say")?.addEventListener("click", () => speak(w.word));
    $("#show")?.addEventListener("click", () => { st.shown = true; if (!enFirst) speak(w.word); render(); });
    const answer = (good) => {
      if (good) { w.box = Math.min(w.box + 1, 6); w.correct = (w.correct || 0) + 1; st.ok++; }
      else { w.box = 1; w.wrong = (w.wrong || 0) + 1; st.bad++; }
      w.next_review = addDays(INTERVALS[w.box]);
      putWord(w);
      st.i++; st.shown = false; render();
    };
    $("#yes")?.addEventListener("click", () => answer(true));
    $("#no")?.addEventListener("click", () => answer(false));
  },

  add() {
    view.innerHTML = `
      <h2>جست‌وجوی واژه</h2>
      <div class="card">
        <form id="addForm" class="row">
          <input id="aw" class="grow en ltr" placeholder="English word or phrase" autocomplete="off" autofocus>
          <button class="btn primary">🔍 پیدا کن</button>
        </form>
        <textarea id="actx" class="en ltr" style="min-height:70px;margin-top:10px"
          placeholder="(اختیاری) جمله‌ای که کلمه توش بود — معنی دقیق‌تر می‌شه"></textarea>
      </div>
      <p class="muted">میونبر: توی صفحه‌ی PDF یا متن، کلمه رو انتخاب کن و <span class="en">Ctrl+Shift+D</span> رو بزن.</p>`;
    $("#addForm").onsubmit = (e) => { e.preventDefault(); showLookup($("#aw").value, $("#actx").value.trim(), "دستی"); };
  },

  text() {
    const saved = localStorage.getItem("dm.text") || "";
    view.innerHTML = `
      <h2>خوندن متن</h2>
      <div class="card">
        <textarea id="tx" class="en ltr" placeholder="Paste English text here…">${esc(saved)}</textarea>
        <div class="row" style="margin-top:8px">
          <input id="tsrc" class="grow" placeholder="اسم منبع (اختیاری)، مثلاً SIM فصل ۲" value="${esc(localStorage.getItem("dm.textSrc") || "")}">
          <button class="btn primary" id="tgo">بخون</button>
        </div>
      </div>
      <div id="reading" class="card reading hidden"></div>
      <p class="muted">روی هر کلمه بزن تا معنیش بیاد. کلمه‌هایی که قبلاً ذخیره کردی زیرشون خط نارنجی داره.</p>`;
    const go = () => {
      const t = $("#tx").value;
      localStorage.setItem("dm.text", t);
      localStorage.setItem("dm.textSrc", $("#tsrc").value);
      const box = $("#reading");
      box.dataset.ctx = $("#tsrc").value || "متن";
      box.innerHTML = esc(t).replace(/[A-Za-z][A-Za-z'’-]*/g, (m) => `<span class="tk">${m}</span>`).replace(/\n/g, "<br>");
      box.classList.remove("hidden");
      markKnown();
    };
    $("#tgo").onclick = go;
    if (saved) go();
    $("#reading").addEventListener("click", (e) => {
      const tk = e.target.closest(".tk");
      if (!tk || window.getSelection()?.toString().trim()) return;
      const box = $("#reading");
      const pre = document.createRange();
      pre.selectNodeContents(box);
      pre.setEndBefore(tk);
      const start = pre.toString().length;
      showLookup(tk.textContent, sentenceAround(box.textContent, start, start + tk.textContent.length), box.dataset.ctx);
    });
  },

  read() {
    view.innerHTML = `
      <div class="reader-bar">
        <div class="row">
          <label class="btn primary">📂 باز کردن PDF<input type="file" id="pdfFile" accept="application/pdf" hidden></label>
          <span id="pdfName" class="muted en grow"></span>
          <button class="btn small" id="zoomOut">−</button>
          <button class="btn small" id="zoomIn">+</button>
        </div>
      </div>
      <div id="pdfPages" class="pdf-pages"></div>
      <p class="muted" id="pdfHint">یه PDF انگلیسی باز کن. روی کلمه دابل‌کلیک کن (یا انتخابش کن) و دکمه‌ی «🔍 DM» یا <span class="en">Ctrl+Shift+D</span> رو بزن.</p>`;
    $("#pdfFile").onchange = (e) => { const f = e.target.files[0]; if (f) reader.open(f); };
    $("#zoomIn").onclick = () => reader.zoom(1.15);
    $("#zoomOut").onclick = () => reader.zoom(1 / 1.15);
    if (reader.file) reader.open(reader.file);
  },

  settings() {
    view.innerHTML = `
      <h2>تنظیمات</h2>
      <div class="card">
        <label>لهجه‌ی پیش‌فرض تلفظ</label>
        <select id="sAccent"><option value="en-US">آمریکایی 🇺🇸</option><option value="en-GB">بریتانیایی 🇬🇧</option></select>
        <label style="display:block;margin-top:10px">سرعت تلفظ: <span id="rateV" class="en">${settings.rate}</span></label>
        <input id="sRate" type="range" min="0.5" max="1.3" step="0.1" value="${settings.rate}">
        <label style="display:block;margin-top:10px">حداکثر کارت در هر مرور</label>
        <input id="sLimit" type="number" min="5" max="200" value="${settings.reviewLimit}">
      </div>
      <div class="card">
        <b>پشتیبان</b>
        <div class="row" style="margin-top:8px">
          <button class="btn" id="exp">⬇️ خروجی گرفتن (JSON)</button>
          <label class="btn">⬆️ وارد کردن<input type="file" id="imp" accept="application/json" hidden></label>
          <button class="btn" id="syncNow">🔄 همگام‌سازی الان</button>
        </div>
      </div>
      <div class="card">
        <div class="muted">وارد شده با: <span class="en">${esc(session?.user?.email || "")}</span></div>
        <button class="btn bad" id="logout" style="margin-top:8px">خروج</button>
      </div>
      <p class="credit" style="text-align:center">DM v${APP_VERSION} · Created by Mostafa Narouei</p>`;
    $("#sAccent").value = settings.accent;
    $("#sAccent").onchange = (e) => { settings.accent = e.target.value; saveSettings(); speak("Hello"); };
    $("#sRate").oninput = (e) => { settings.rate = Number(e.target.value); $("#rateV").textContent = settings.rate; saveSettings(); };
    $("#sRate").onchange = () => speak("parachute");
    $("#sLimit").onchange = (e) => { settings.reviewLimit = Math.max(5, Number(e.target.value) || 30); saveSettings(); };
    $("#exp").onclick = () => {
      const blob = new Blob([JSON.stringify(allWords(), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `DM-backup-${localDate()}.json`; a.click();
    };
    $("#imp").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const list = JSON.parse(await f.text());
        let n = 0;
        for (const w of list) { if (w?.word && !findWord(w.word)) { putWord({ ...w, id: w.id || uuid() }); n++; } }
        toast(`${faDigits(n)} واژه اضافه شد`);
      } catch { toast("فایل درست نیست"); }
    };
    $("#syncNow").onclick = () => sync();
    $("#logout").onclick = async () => {
      if (!confirm("از حسابت خارج بشی؟")) return;
      await sb.auth.signOut();
      localStorage.removeItem(WORDS_KEY); localStorage.removeItem(SYNC_KEY);
      words = {}; location.reload();
    };
  },
};

function markKnown() {
  const set = new Set(allWords().map((w) => norm(w.word)));
  document.querySelectorAll("#reading .tk").forEach((t) => t.classList.toggle("known", set.has(norm(t.textContent))));
}

function render() { (views[currentTab] || views.words)(); }

function route() {
  const tab = (location.hash.replace("#/", "") || "words").split("?")[0];
  if (tab !== currentTab && tab === "review") views.review.state = null;
  currentTab = views[tab] ? tab : "words";
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === currentTab));
  selBtn.classList.add("hidden");
  render();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

/* ---------------- PDF reader ---------------- */
const reader = {
  lib: null, doc: null, file: null, scale: 1, observer: null,
  async load() {
    if (this.lib) return this.lib;
    const v = "4.10.38";
    this.lib = await import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${v}/build/pdf.min.mjs`);
    this.lib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${v}/build/pdf.worker.min.mjs`;
    return this.lib;
  },
  async open(file) {
    this.file = file;
    const pages = $("#pdfPages");
    if (!pages) return;
    $("#pdfName").textContent = file.name;
    $("#pdfHint").classList.add("hidden");
    pages.innerHTML = `<div class="spinner"></div>`;
    try {
      const lib = await this.load();
      this.doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
      const first = await this.doc.getPage(1);
      const vw = first.getViewport({ scale: 1 }).width;
      if (!this.userScale) this.scale = Math.min(1.6, (pages.clientWidth - 8) / vw);
      await this.layout();
      const last = Number(localStorage.getItem("dm.pdfPage." + file.name) || 1);
      if (last > 1) document.getElementById("pg" + last)?.scrollIntoView();
    } catch (e) {
      pages.innerHTML = `<p class="error">نشد PDF رو باز کنم: ${esc(e.message)}</p>`;
    }
  },
  async layout() {
    const pages = $("#pdfPages");
    pages.innerHTML = "";
    this.observer?.disconnect();
    this.observer = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          const n = Number(en.target.dataset.n);
          this.renderPage(en.target, n);
          localStorage.setItem("dm.pdfPage." + this.file.name, n);
        }
      }
    }, { rootMargin: "600px 0px" });
    const first = await this.doc.getPage(1);
    const vp = first.getViewport({ scale: this.scale });
    for (let n = 1; n <= this.doc.numPages; n++) {
      const div = document.createElement("div");
      div.className = "pdf-page";
      div.id = "pg" + n;
      div.dataset.n = n;
      div.dataset.ctx = `${this.file.name} — p.${n}`;
      div.style.width = vp.width + "px";
      div.style.height = vp.height + "px";
      pages.appendChild(div);
      this.observer.observe(div);
    }
  },
  async renderPage(div, n) {
    if (div.dataset.done) return;
    div.dataset.done = "1";
    const page = await this.doc.getPage(n);
    const vp = page.getViewport({ scale: this.scale });
    div.style.width = vp.width + "px";
    div.style.height = vp.height + "px";
    div.style.setProperty("--scale-factor", vp.scale);
    div.style.setProperty("--total-scale-factor", vp.scale);
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = vp.width + "px";
    canvas.style.height = vp.height + "px";
    div.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
    const tl = document.createElement("div");
    tl.className = "textLayer";
    div.appendChild(tl);
    try {
      const layer = new this.lib.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp });
      await layer.render();
    } catch (e) { console.warn("text layer", e); }
    const num = document.createElement("div");
    num.className = "pnum"; num.textContent = faDigits(n);
    div.appendChild(num);
  },
  zoom(f) {
    if (!this.doc) return;
    this.userScale = true;
    this.scale = Math.max(0.5, Math.min(3, this.scale * f));
    this.layout();
  },
};

/* ---------------- start ---------------- */
async function showApp() {
  $("#splash").classList.add("hidden");
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  refreshBadge();
  route();
  sync();
}

function showLogin() {
  $("#splash").classList.add("hidden");
  $("#app").classList.add("hidden");
  $("#login").classList.remove("hidden");
}

$("#loginForm").onsubmit = async (e) => {
  e.preventDefault();
  $("#loginError").textContent = "";
  const { data, error } = await sb.auth.signInWithPassword({ email: $("#email").value.trim(), password: $("#password").value });
  if (error) { $("#loginError").textContent = "ایمیل یا رمز اشتباهه"; return; }
  session = data.session;
  showApp();
};

sb.auth.onAuthStateChange((_ev, s) => { session = s; });

(async () => {
  if (SUPABASE_URL.startsWith("PUT_")) {
    $("#splash").innerHTML = `<div class="logo-big">DM</div><p>هنوز تنظیمات Supabase توی <span class="en">js/config.js</span> نوشته نشده.</p>`;
    return;
  }
  const { data } = await sb.auth.getSession();
  session = data.session;
  // offline but logged in before → still open the app
  if (session || (!navigator.onLine && Object.keys(words).length)) showApp(); else showLogin();
})();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
