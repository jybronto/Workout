// Дневник тренировок — логика приложения.
// Данные тренировок: window.WORKOUT_DATA (data.js)
// Конфиг Firebase: window.FIREBASE_CONFIG (firebase-config.js)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged,
  signInWithPopup, signInWithRedirect, getRedirectResult, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, deleteDoc, collection, onSnapshot,
  enableIndexedDbPersistence, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const APP_VERSION = "v11"; // повышается при каждом пуше — видно, что обновление доехало

const DATA = window.WORKOUT_DATA;
const $ = (s, r = document) => r.querySelector(s);

// ---------- Firebase init ----------
let auth = null, db = null, user = null, fbReady = false;
const cfg = window.FIREBASE_CONFIG;
const cfgOk = cfg && cfg.apiKey && !String(cfg.apiKey).includes("ВСТАВЬ");

if (cfgOk) {
  try {
    const appFb = initializeApp(cfg);
    auth = getAuth(appFb);
    db = getFirestore(appFb);
    enableIndexedDbPersistence(db).catch(() => {}); // офлайн-кэш; молча игнорируем если недоступен
    fbReady = true;
  } catch (e) {
    console.error("Firebase init error", e);
  }
}

// ---------- State ----------
let sessions = {};          // sessionId -> {date, workoutId, entries, notes}
let unsub = null;           // firestore listener
let current = null;         // {workoutId, date, block, workout, draft}
let saveTimer = null;
let dirty = false;
let view = "home";          // 'home' | 'workout' | 'history'
let histMonth = null;       // Date (первое число отображаемого месяца) для истории

// ---------- DOM refs ----------
const appEl = $("#app");
const backBtn = $("#backBtn");
const topTitle = $("#topTitle");
const authBtn = $("#authBtn");
const syncBar = $("#syncBar");
$("#ver").textContent = APP_VERSION;

// ---------- Helpers ----------
function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}
function sid(date, workoutId) { return `${date}__w${workoutId}`; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function fmtDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
function ytEmbed() {} // reserved

function findWorkout(id) {
  for (const b of DATA.blocks)
    for (const w of b.workouts)
      if (w.id === id) return { block: b, workout: w };
  return null;
}

// Найти предыдущую сессию этой же тренировки (по дате раньше текущей)
function lastSetsFor(workoutId, exName, beforeDate) {
  const cands = Object.values(sessions)
    .filter(s => s.workoutId === workoutId && s.date < beforeDate && s.entries && s.entries[exName] && (s.entries[exName].sets || []).some(x => x.w || x.r))
    .sort((a, b) => a.date < b.date ? 1 : -1);
  if (!cands.length) return null;
  const s = cands[0];
  return { date: s.date, sets: s.entries[exName].sets };
}

function setSync(text, cls = "") {
  if (!text) { syncBar.classList.add("hidden"); return; }
  syncBar.textContent = text;
  syncBar.className = "sync-bar " + cls;
}

// ---------- Auth ----------
authBtn.addEventListener("click", async () => {
  if (!fbReady) { setSync("Firebase не настроен — см. README", "err"); return; }
  if (user) {
    if (confirm("Выйти из аккаунта? Локальные данные останутся в облаке.")) { await signOut(auth); }
    return;
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" }); // всегда показывать выбор аккаунта
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error(e);
    // Всплывающее окно недоступно/заблокировано — пробуем через редирект
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) {
      try { await signInWithRedirect(auth, provider); }
      catch (e2) { setSync("Не удалось войти: " + (e2.code || e2.message), "err"); }
    } else if (e.code === "auth/popup-closed-by-user") {
      // пользователь закрыл окно — молчим
    } else {
      setSync("Не удалось войти: " + (e.code || e.message), "err");
    }
  }
});

if (fbReady) {
  getRedirectResult(auth).catch(e => console.warn("redirect result", e));
  onAuthStateChanged(auth, u => {
    user = u;
    if (u) {
      authBtn.textContent = "Выйти";
      authBtn.classList.add("signed");
      subscribeSessions();
      setSync("Синхронизировано с облаком ✓", "ok");
      setTimeout(() => { if (!dirty) setSync(""); }, 2500);
    } else {
      authBtn.textContent = "Войти";
      authBtn.classList.remove("signed");
      if (unsub) { unsub(); unsub = null; }
      sessions = {};
      setSync("");
    }
    render();
  });
}

function subscribeSessions() {
  if (!user) return;
  if (unsub) unsub();
  const col = collection(db, "users", user.uid, "sessions");
  unsub = onSnapshot(col, snap => {
    sessions = {};
    snap.forEach(d => { sessions[d.id] = d.data(); });
    // Пока идёт редактирование тренировки — НЕ перерисовываем (иначе слетает курсор).
    // Обновляем список/историю только на других экранах.
    if (view !== "workout") render();
  }, err => {
    console.error(err);
    setSync("Ошибка синхронизации: " + err.code, "err");
  });
}

// ---------- Save ----------
function scheduleSave() {
  dirty = true;
  updateSaveBtn();
  if (!user) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 10000); // автосохранение через 10 сек после последнего ввода
}

async function saveNow() {
  if (!current) return;
  if (!user) { setSync("Войдите, чтобы сохранять в облако", "err"); return; }
  clearTimeout(saveTimer);
  const id = sid(current.date, current.workoutId);
  // Сохраняем только упражнения, которые пользователь реально трогал (не подсказки-заготовки)
  const entries = {};
  for (const [name, e] of Object.entries(current.draft.entries)) {
    if (!e.touched) continue;
    // Рабочие подходы: если это ещё нетронутая подсказка (prefill) — не сохраняем
    const sets = e.prefill ? [] : (e.sets || []).filter(s => (s.w ?? "") !== "" || (s.r ?? "") !== "");
    const warm = (e.warm && ((e.warm.w ?? "") !== "" || (e.warm.r ?? "") !== "")) ? { w: e.warm.w, r: e.warm.r } : null;
    if (sets.length || warm) {
      const rec = {};
      if (sets.length) rec.sets = sets;
      if (warm) rec.warm = warm;
      entries[name] = rec;
    }
  }
  const payload = {
    date: current.date,
    workoutId: current.workoutId,
    workoutName: current.workout.name,
    entries,
    notes: current.draft.notes || "",
    updatedAt: serverTimestamp(),
  };
  try {
    setSync("Сохранение…");
    const hasData = current.draft.notes || Object.keys(entries).length;
    if (!hasData) {
      await deleteDoc(doc(db, "users", user.uid, "sessions", id)).catch(() => {});
    } else {
      await setDoc(doc(db, "users", user.uid, "sessions", id), payload);
    }
    dirty = false;
    setSync("Сохранено ✓", "ok");
    updateSaveBtn();
    setTimeout(() => { if (!dirty) setSync(""); }, 1800);
  } catch (e) {
    console.error(e);
    setSync("Не сохранено: " + (e.code || e.message), "err");
  }
}

function updateSaveBtn() {
  const btn = $("#saveBtn");
  if (!btn) return;
  if (!user) { btn.textContent = "Войдите, чтобы сохранять"; btn.disabled = true; btn.classList.remove("saved"); return; }
  btn.disabled = false;
  if (dirty) { btn.textContent = "Сохранить"; btn.classList.remove("saved"); }
  else { btn.textContent = "Сохранено ✓"; btn.classList.add("saved"); }
}

// ---------- Draft build ----------
function blankEntry() { return { sets: [{ w: "", r: "" }], touched: true, prefill: false }; }

// Первый заполненный подход из прошлой тренировки этого упражнения
function prevFirstSet(workoutId, exName, beforeDate) {
  const last = lastSetsFor(workoutId, exName, beforeDate);
  if (!last) return null;
  const s = (last.sets || []).find(x => x.w || x.r);
  return s ? { w: s.w || "", r: s.r || "" } : null;
}

function loadDraftFromCloud() {
  const id = sid(current.date, current.workoutId);
  const saved = sessions[id];
  const entries = {};
  for (const ex of current.workout.exercises) {
    if (isCardio(ex)) continue;
    const s = saved && saved.entries && saved.entries[ex.name];
    const warm = (s && s.warm) ? { w: s.warm.w ?? "", r: s.warm.r ?? "" } : { w: "", r: "" };
    if (s && ((s.sets && s.sets.length) || s.warm)) {
      // Уже есть сохранённые данные за этот день
      const sets = (s.sets && s.sets.length) ? s.sets.map(x => ({ w: x.w ?? "", r: x.r ?? "" })) : [{ w: "", r: "" }];
      entries[ex.name] = { sets, warm, touched: true, prefill: false };
    } else {
      // Нет данных за сегодня — подставим первый рабочий подход из прошлой тренировки (если была)
      const pre = prevFirstSet(current.workoutId, ex.name, current.date);
      entries[ex.name] = pre
        ? { sets: [{ w: pre.w, r: pre.r }], warm, touched: false, prefill: true }
        : { sets: [{ w: "", r: "" }], warm, touched: false, prefill: false };
    }
  }
  current.draft = { entries, notes: (saved && saved.notes) || "" };
  dirty = false;
}

function isCardio(ex) { return !ex.video && /кардио/i.test(ex.name); }

// ---------- Views ----------
function render() {
  if (view === "workout" && current) renderWorkout();
  else if (view === "history") renderHistory();
  else renderHome();
}

function renderHome() {
  backBtn.classList.add("hidden");
  topTitle.textContent = "Тренировки";
  document.title = "Дневник тренировок";
  let html = "";
  if (fbReady && !user) {
    html += `<div class="signin-hint"><b>Войдите</b>, чтобы дневник (даты, веса, повторы) сохранялся и синхронизировался между телефоном и компьютером. Нажмите «Войти» вверху справа.</div>`;
  } else if (!fbReady) {
    html += `<div class="signin-hint"><b>Firebase не настроен.</b> Приложение работает как справочник. Чтобы включить дневник с синхронизацией — заполните <b>firebase-config.js</b> (инструкция в README).</div>`;
  }
  for (const b of DATA.blocks) {
    html += `<div class="block-title">${esc(b.title)}</div>`;
    for (const w of b.workouts) {
      const last = lastDoneDate(w.id);
      const nEx = w.exercises.filter(e => !isCardio(e)).length;
      const lastHtml = last ? ` · <span class="last-done">${fmtDate(last)}</span>` : "";
      html += `<div class="wcard" data-open="${w.id}">
        <div class="wcard-main">
          <div class="wcard-name">${esc(w.name)}</div>
          <div class="wcard-sub">${nEx} упр.${lastHtml}</div>
        </div>
        ${last ? '<span class="dot" title="Есть записи"></span>' : ""}
        <span class="wcard-chev">›</span>
      </div>`;
    }
  }
  appEl.innerHTML = html;
  appEl.querySelectorAll("[data-open]").forEach(el =>
    el.addEventListener("click", () => openWorkout(+el.dataset.open)));
}

function countDone(workoutId) {
  return Object.values(sessions).filter(s => s.workoutId === workoutId).length;
}

// Дата последнего выполнения тренировки (или null)
function lastDoneDate(workoutId) {
  let max = null;
  for (const s of Object.values(sessions)) {
    if (s.workoutId === workoutId && s.date && (!max || s.date > max)) max = s.date;
  }
  return max;
}

function openWorkout(id, date) {
  const fw = findWorkout(id);
  if (!fw) return;
  current = { workoutId: id, date: date || todayISO(), block: fw.block, workout: fw.workout, draft: null };
  loadDraftFromCloud();
  view = "workout";
  window.scrollTo(0, 0);
  render();
}

function goHome() {
  if (dirty && user) saveNow();
  current = null;
  view = "home";
  window.scrollTo(0, 0);
  render();
}

function openHistory() {
  if (dirty && user) saveNow();
  histMonth = histMonth || startOfMonth(new Date());
  view = "history";
  window.scrollTo(0, 0);
  render();
}

function renderWorkout() {
  const w = current.workout;
  backBtn.classList.remove("hidden");
  topTitle.textContent = w.name;
  document.title = w.name;

  let html = `
    <div class="date-row">
      <label for="wdate">Дата тренировки:</label>
      <input type="date" id="wdate" value="${current.date}" max="${todayISO()}" />
    </div>`;

  for (const ex of w.exercises) {
    html += renderExercise(ex);
  }

  html += `<textarea class="note-input" id="wnote" placeholder="Заметка к тренировке (самочувствие, что менять…)">${esc(current.draft.notes || "")}</textarea>`;
  if (user && sessions[sid(current.date, current.workoutId)]) {
    html += `<button class="del-session" id="delSession">Удалить эту тренировку за ${fmtDate(current.date)}</button>`;
  }
  html += `<div style="height:70px"></div>`;
  html += `<div class="save-fab"><button id="saveBtn">Сохранить</button></div>`;

  appEl.innerHTML = html;
  bindWorkoutEvents();
  updateSaveBtn();
}

function renderExercise(ex) {
  const cardio = isCardio(ex);
  const nameCls = ex.video ? "ex-name link" : "ex-name";
  const yt = ex.video ? `<span class="yt">▶ видео</span>` : "";
  let badges = "";
  if (ex.warmup) badges += `<span class="badge warm">Разминка</span>`;
  if (ex.scheme) badges += `<span class="badge scheme">${esc(ex.scheme)}</span>`;
  if (ex.rest) badges += `<span class="badge">отдых ${esc(ex.rest)}</span>`;
  if (ex.zdo && ex.zdo !== "-") badges += `<span class="badge zdo">ЗДО ${esc(ex.zdo)}</span>`;

  let body = "";
  if (cardio) {
    body = `<div class="cardio-note">${esc(ex.scheme || "")} — записи не нужны</div>`;
  } else {
    const last = lastSetsFor(current.workoutId, ex.name, current.date);
    let lastHtml = "";
    if (last) {
      const summary = last.sets.filter(s => s.w || s.r).map(s => `${s.w || "—"}кг×${s.r || "—"}`).join(",  ");
      if (summary) lastHtml = `<div class="last">Прошлый раз (${fmtDate(last.date)}): <b>${esc(summary)}</b></div>`;
    }
    const entry = current.draft.entries[ex.name] || blankEntry();
    const isPre = !entry.touched && entry.prefill;
    const warmRow = ex.warmup ? warmRowHtml(ex.name, entry.warm || { w: "", r: "" }) : "";
    let rows = "";
    entry.sets.forEach((s, i) => { rows += setRow(ex.name, i, s); });
    const preNote = isPre ? `<div class="prefill-note">↑ рабочие веса с прошлого раза — поправь под сегодня</div>` : "";
    body = `${lastHtml}
      ${warmRow}
      <div class="sets${isPre ? " prefill" : ""}" data-sets="${esc(ex.name)}">${rows}</div>
      ${preNote}
      <button class="add-set" data-addset="${esc(ex.name)}">+ подход</button>`;
  }

  return `<div class="ex">
    <div class="ex-head">
      <div class="ex-titlewrap">
        <div class="${nameCls}" ${ex.video ? `data-video="${esc(ex.video)}"` : ""}>${esc(ex.name)}${yt}</div>
        <div class="badges">${badges}</div>
      </div>
    </div>
    ${body}
  </div>`;
}

function setRow(exName, i, s) {
  return `<div class="set-row" data-row="${i}">
    <span class="set-idx">${i + 1}</span>
    <div class="set-field">
      <input type="text" inputmode="decimal" placeholder="вес" value="${esc(s.w ?? "")}"
        data-inp="w" data-ex="${esc(exName)}" data-i="${i}" />
      <span class="unit">кг</span>
    </div>
    <span class="set-x">×</span>
    <div class="set-field">
      <input type="text" inputmode="numeric" placeholder="повт." value="${esc(s.r ?? "")}"
        data-inp="r" data-ex="${esc(exName)}" data-i="${i}" />
    </div>
    <button class="set-del" data-del="${esc(exName)}" data-i="${i}" aria-label="Удалить подход">✕</button>
  </div>`;
}

// Разминочный подход (жёлтая строка) — только для упражнений с разминкой
function warmRowHtml(exName, w) {
  return `<div class="set-row warm-row">
    <span class="set-idx warm-idx" title="Разминочный подход">Р</span>
    <div class="set-field">
      <input type="text" inputmode="decimal" placeholder="вес" value="${esc(w.w ?? "")}"
        data-warm="w" data-ex="${esc(exName)}" />
      <span class="unit">кг</span>
    </div>
    <span class="set-x">×</span>
    <div class="set-field">
      <input type="text" inputmode="numeric" placeholder="повт." value="${esc(w.r ?? "")}"
        data-warm="r" data-ex="${esc(exName)}" />
    </div>
    <button class="set-del" data-warmdel="${esc(exName)}" aria-label="Очистить разминку">✕</button>
  </div>`;
}

function bindWorkoutEvents() {
  // Дата
  $("#wdate").addEventListener("change", e => {
    if (dirty && user) saveNow();
    current.date = e.target.value || todayISO();
    loadDraftFromCloud();
    render();
  });

  // Видео
  appEl.querySelectorAll("[data-video]").forEach(el =>
    el.addEventListener("click", () => window.open(el.dataset.video, "_blank", "noopener")));

  // Ввод веса/повторов
  appEl.querySelectorAll("input[data-inp]").forEach(inp => inp.addEventListener("input", onSetInput));

  // Ввод разминочного подхода
  appEl.querySelectorAll("input[data-warm]").forEach(inp => inp.addEventListener("input", onWarmInput));

  // Добавить подход — копируем значения из последнего подхода
  appEl.querySelectorAll("[data-addset]").forEach(btn =>
    btn.addEventListener("click", () => {
      const ex = btn.dataset.addset;
      const entry = current.draft.entries[ex];
      const last = entry.sets[entry.sets.length - 1] || { w: "", r: "" };
      entry.sets.push({ w: last.w ?? "", r: last.r ?? "" });
      entry.touched = true; entry.prefill = false;
      scheduleSave();
      rerenderSets(ex);
    }));

  // Удалить подход
  appEl.addEventListener("click", onDelClick);

  // Очистить разминочный подход
  appEl.querySelectorAll("[data-warmdel]").forEach(btn =>
    btn.addEventListener("click", () => {
      const ex = btn.dataset.warmdel;
      const entry = current.draft.entries[ex];
      entry.warm = { w: "", r: "" };
      entry.touched = true;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      appEl.querySelectorAll(`input[data-warm][data-ex="${cssEsc(ex)}"]`).forEach(i => (i.value = ""));
      scheduleSave();
    }));

  // Заметка
  $("#wnote").addEventListener("input", e => { current.draft.notes = e.target.value; scheduleSave(); });

  // Сохранить
  $("#saveBtn").addEventListener("click", saveNow);

  // Удалить всю тренировку за этот день
  const del = $("#delSession");
  if (del) del.addEventListener("click", deleteSession);
}

async function deleteSession() {
  const id = sid(current.date, current.workoutId);
  if (!user || !sessions[id]) { goHome(); return; }
  if (!confirm(`Удалить запись этой тренировки за ${fmtDate(current.date)}? Все введённые подходы будут стёрты.`)) return;
  try {
    clearTimeout(saveTimer);
    await deleteDoc(doc(db, "users", user.uid, "sessions", id));
    delete sessions[id];
    setSync("Тренировка удалена ✓", "ok");
    setTimeout(() => { if (!dirty) setSync(""); }, 1800);
  } catch (e) {
    console.error(e);
    setSync("Не удалось удалить: " + (e.code || e.message), "err");
    return;
  }
  dirty = false;
  loadDraftFromCloud(); // вернёт пустые поля / подсказки
  render();
}

function onSetInput(e) {
  const { ex, i, inp: field } = e.target.dataset;
  const entry = current.draft.entries[ex];
  entry.sets[+i][field] = e.target.value;
  entry.touched = true;
  if (entry.prefill) { // тронули рабочий подход — это уже не подсказка
    entry.prefill = false;
    const cont = appEl.querySelector(`[data-sets="${cssEsc(ex)}"]`);
    if (cont) {
      cont.classList.remove("prefill");
      const n = cont.parentElement.querySelector(".prefill-note");
      if (n) n.remove();
    }
  }
  scheduleSave();
}

function onWarmInput(e) {
  const { ex, warm: field } = e.target.dataset;
  const entry = current.draft.entries[ex];
  if (!entry.warm) entry.warm = { w: "", r: "" };
  entry.warm[field] = e.target.value;
  entry.touched = true; // рабочие подходы при этом остаются подсказкой (prefill не трогаем)
  scheduleSave();
}

function onDelClick(e) {
  const btn = e.target.closest("[data-del]");
  if (!btn) return;
  const ex = btn.dataset.del;
  const entry = current.draft.entries[ex];
  entry.sets.splice(+btn.dataset.i, 1);
  if (!entry.sets.length) entry.sets.push({ w: "", r: "" });
  entry.touched = true; entry.prefill = false;
  scheduleSave();
  rerenderSets(ex);
}

function rerenderSets(exName) {
  const cont = appEl.querySelector(`[data-sets="${cssEsc(exName)}"]`);
  if (!cont) { render(); return; }
  // iOS Safari не перерисовывает поле, которое было в фокусе, при замене HTML — снимаем фокус
  const active = document.activeElement;
  if (active && cont.contains(active) && active.blur) active.blur();
  const entry = current.draft.entries[exName];
  cont.innerHTML = entry.sets.map((s, i) => setRow(exName, i, s)).join("");
  cont.querySelectorAll("input[data-inp]").forEach(inp => inp.addEventListener("input", onSetInput));
  cont.classList.toggle("prefill", !entry.touched && entry.prefill);
  const note = cont.parentElement.querySelector(".prefill-note");
  if (note && entry.touched) note.remove();
  void cont.offsetHeight; // форсируем перерисовку
  updateSaveBtn();
}

function cssEsc(s) { return s.replace(/["\\]/g, "\\$&"); }

// ---------- История / календарь ----------
const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const WD = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function isoOf(d) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}
function sessionSummary(s) {
  const entries = s.entries || {};
  const nEx = Object.keys(entries).length;
  let nSets = 0;
  for (const e of Object.values(entries)) nSets += (e.sets || []).length;
  const parts = [];
  if (nEx) parts.push(`${nEx} упр.`);
  if (nSets) parts.push(`${nSets} подх.`);
  return parts.join(" · ");
}

function renderHistory() {
  backBtn.classList.remove("hidden");
  topTitle.textContent = "История";
  document.title = "История тренировок";

  if (!fbReady) {
    appEl.innerHTML = `<div class="signin-hint"><b>Firebase не настроен.</b> История доступна после настройки дневника.</div>`;
    return;
  }
  if (!user) {
    appEl.innerHTML = `<div class="signin-hint"><b>Войдите</b>, чтобы видеть историю. Здесь появятся все проведённые тренировки по датам.</div>`;
    return;
  }

  // Карта дата -> список сессий
  const byDate = {};
  for (const s of Object.values(sessions)) {
    if (!s.date) continue;
    (byDate[s.date] = byDate[s.date] || []).push(s);
  }

  const m = histMonth;
  const year = m.getFullYear(), month = m.getMonth();
  const todayIso = todayISO();

  // Сетка календаря (Пн..Вс)
  const first = new Date(year, month, 1);
  let startWd = (first.getDay() + 6) % 7; // 0 = Пн
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let cells = "";
  for (const w of WD) cells += `<div class="cal-wd">${w}</div>`;
  for (let i = 0; i < startWd; i++) cells += `<div class="cal-cell empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = isoOf(new Date(year, month, d));
    const has = byDate[iso];
    const cls = ["cal-cell"];
    if (has) cls.push("has");
    if (iso === todayIso) cls.push("today");
    const attr = has ? ` data-day="${iso}"` : "";
    const tags = has ? has.map(s => "т-" + s.workoutId).join(" ") : "";
    cells += `<div class="${cls.join(" ")}"${attr}><span class="cal-num">${d}</span>${has ? `<span class="cal-tag">${esc(tags)}</span>` : ""}</div>`;
  }

  // Список сессий этого месяца (по датам, новые сверху)
  const monthSessions = Object.values(sessions)
    .filter(s => s.date && s.date.slice(0, 7) === `${year}-${String(month + 1).padStart(2, "0")}`)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  let list = "";
  if (monthSessions.length) {
    for (const s of monthSessions) {
      list += `<div class="hist-item" data-open="${s.workoutId}" data-date="${s.date}">
        <div class="hist-date">${fmtDate(s.date)}</div>
        <div class="hist-main">
          <div class="hist-name">${esc(s.workoutName || ("Тренировка " + s.workoutId))}</div>
          <div class="hist-sub">${esc(sessionSummary(s))}</div>
        </div>
        <span class="wcard-chev">›</span>
      </div>`;
    }
  } else {
    list = `<div class="empty">В этом месяце тренировок нет</div>`;
  }

  appEl.innerHTML = `
    <div class="cal-head">
      <button class="icon-btn" id="calPrev" aria-label="Предыдущий месяц">‹</button>
      <div class="cal-title">${MONTHS[month]} ${year}</div>
      <button class="icon-btn" id="calNext" aria-label="Следующий месяц">›</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="hist-list">${list}</div>`;

  $("#calPrev").addEventListener("click", () => { histMonth = new Date(year, month - 1, 1); render(); });
  $("#calNext").addEventListener("click", () => { histMonth = new Date(year, month + 1, 1); render(); });
  appEl.querySelectorAll("[data-day]").forEach(el =>
    el.addEventListener("click", () => {
      const iso = el.dataset.day;
      const list = byDate[iso] || [];
      if (list.length) openWorkout(list[0].workoutId, iso);
    }));
  appEl.querySelectorAll(".hist-item").forEach(el =>
    el.addEventListener("click", () => openWorkout(+el.dataset.open, el.dataset.date)));
}

// ---------- Nav / modal ----------
backBtn.addEventListener("click", goHome);
$("#calBtn").addEventListener("click", openHistory);
$("#helpBtn").addEventListener("click", () => $("#helpModal").classList.remove("hidden"));
$("#helpModal").addEventListener("click", e => {
  if (e.target.id === "helpModal" || e.target.hasAttribute("data-close-help"))
    $("#helpModal").classList.add("hidden");
});
window.addEventListener("beforeunload", e => {
  if (dirty && user) { saveNow(); }
});

// ---------- Boot ----------
if (!fbReady) render(); // без Firebase — сразу показать справочник
render();
