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

// ---------- DOM refs ----------
const appEl = $("#app");
const backBtn = $("#backBtn");
const topTitle = $("#topTitle");
const authBtn = $("#authBtn");
const syncBar = $("#syncBar");

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
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  try {
    if (isMobile) await signInWithRedirect(auth, provider);
    else await signInWithPopup(auth, provider);
  } catch (e) {
    console.error(e);
    setSync("Не удалось войти: " + (e.code || e.message), "err");
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
    // Обновить открытую тренировку данными из облака, не затирая текущий несохранённый ввод
    if (current && !dirty) loadDraftFromCloud();
    render();
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
  saveTimer = setTimeout(saveNow, 1200);
}

async function saveNow() {
  if (!current) return;
  if (!user) { setSync("Войдите, чтобы сохранять в облако", "err"); return; }
  clearTimeout(saveTimer);
  const id = sid(current.date, current.workoutId);
  const payload = {
    date: current.date,
    workoutId: current.workoutId,
    workoutName: current.workout.name,
    entries: current.draft.entries,
    notes: current.draft.notes || "",
    updatedAt: serverTimestamp(),
  };
  try {
    setSync("Сохранение…");
    // Удалить документ, если всё пусто
    const hasData = current.draft.notes ||
      Object.values(current.draft.entries).some(e => (e.sets || []).some(s => s.w || s.r) || e.done);
    if (!hasData) {
      await deleteDoc(doc(db, "users", user.uid, "sessions", id)).catch(() => {});
    } else {
      await setDoc(doc(db, "users", user.uid, "sessions", id), payload, { merge: true });
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
function blankEntry() { return { sets: [{ w: "", r: "" }], done: false }; }

function loadDraftFromCloud() {
  const id = sid(current.date, current.workoutId);
  const saved = sessions[id];
  const entries = {};
  for (const ex of current.workout.exercises) {
    if (isCardio(ex)) continue;
    const s = saved && saved.entries && saved.entries[ex.name];
    entries[ex.name] = s
      ? { sets: (s.sets && s.sets.length ? s.sets.map(x => ({ w: x.w ?? "", r: x.r ?? "" })) : [{ w: "", r: "" }]), done: !!s.done }
      : blankEntry();
  }
  current.draft = { entries, notes: (saved && saved.notes) || "" };
  dirty = false;
}

function isCardio(ex) { return !ex.video && /кардио/i.test(ex.name); }

// ---------- Views ----------
function render() {
  if (current) renderWorkout();
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
      const done = countDone(w.id);
      const nEx = w.exercises.filter(e => !isCardio(e)).length;
      html += `<div class="wcard" data-open="${w.id}">
        <div class="wcard-main">
          <div class="wcard-name">${esc(w.name)}</div>
          <div class="wcard-sub">${nEx} упр.${done ? ` · записей: ${done}` : ""}</div>
        </div>
        ${done ? '<span class="dot" title="Есть записи"></span>' : ""}
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

function openWorkout(id) {
  const fw = findWorkout(id);
  if (!fw) return;
  current = { workoutId: id, date: todayISO(), block: fw.block, workout: fw.workout, draft: null };
  loadDraftFromCloud();
  window.scrollTo(0, 0);
  render();
}

function goHome() {
  if (dirty && user) saveNow();
  current = null;
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
  if (ex.warmup) badges += `<span class="badge warm">Р разминка</span>`;
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
    let rows = "";
    entry.sets.forEach((s, i) => { rows += setRow(ex.name, i, s); });
    body = `${lastHtml}
      <div class="sets" data-sets="${esc(ex.name)}">${rows}</div>
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
  appEl.querySelectorAll("input[data-inp]").forEach(inp => {
    inp.addEventListener("input", e => {
      const { ex, i, inp: field } = e.target.dataset;
      const entry = current.draft.entries[ex];
      entry.sets[+i][field] = e.target.value;
      scheduleSave();
    });
  });

  // Добавить подход
  appEl.querySelectorAll("[data-addset]").forEach(btn =>
    btn.addEventListener("click", () => {
      const ex = btn.dataset.addset;
      current.draft.entries[ex].sets.push({ w: "", r: "" });
      scheduleSave();
      rerenderSets(ex);
    }));

  // Удалить подход
  appEl.addEventListener("click", onDelClick);

  // Заметка
  $("#wnote").addEventListener("input", e => { current.draft.notes = e.target.value; scheduleSave(); });

  // Сохранить
  $("#saveBtn").addEventListener("click", saveNow);
}

function onDelClick(e) {
  const btn = e.target.closest("[data-del]");
  if (!btn) return;
  const ex = btn.dataset.del;
  const entry = current.draft.entries[ex];
  entry.sets.splice(+btn.dataset.i, 1);
  if (!entry.sets.length) entry.sets.push({ w: "", r: "" });
  scheduleSave();
  rerenderSets(ex);
}

function rerenderSets(exName) {
  const cont = appEl.querySelector(`[data-sets="${cssEsc(exName)}"]`);
  if (!cont) { render(); return; }
  const entry = current.draft.entries[exName];
  cont.innerHTML = entry.sets.map((s, i) => setRow(exName, i, s)).join("");
  cont.querySelectorAll("input[data-inp]").forEach(inp => {
    inp.addEventListener("input", e => {
      const { ex, i, inp: field } = e.target.dataset;
      current.draft.entries[ex].sets[+i][field] = e.target.value;
      scheduleSave();
    });
  });
  updateSaveBtn();
}

function cssEsc(s) { return s.replace(/["\\]/g, "\\$&"); }

// ---------- Nav / modal ----------
backBtn.addEventListener("click", goHome);
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
