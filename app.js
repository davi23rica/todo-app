/* 해야 할 일 기록 - app.js (저장 키: todo-tracker-v1, 기존 기록과 호환) */
var KEY = "todo-tracker-v1";
var PREF_KEY = "todo-prefs-v1";
var APP_VERSION = "8";
var DAYNAMES = ["일", "월", "화", "수", "목", "금", "토"];
var SKIP_LIMIT = 3;
var HIST_MAX = 200;
var FONTS = { small: 14, normal: 16, large: 18, xlarge: 20 };
var CARD_KEYS = ["today", "week", "month", "year", "all", "perfect", "streak"];
var CARD_NAMES = {
  today: "오늘 달성률", week: "이번 주 달성률", month: "월 달성률", year: "연 달성률",
  all: "지금까지 달성률", perfect: "PERFECT DAY 횟수", streak: "연속 PERFECT DAY"
};
var TABS = ["home", "stats", "review", "hist", "set"];
var loadNotice = "";
var schedCache = null;
var curTab = "home";

// ---------- 날짜 도우미 ----------
function pad(n) { return String(n).padStart(2, "0"); }
function dateStr(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function todayS() { return dateStr(new Date()); }
function parseDate(ds) {
  var p = ds.split("-");
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
function isDateStr(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return dateStr(parseDate(s)) === s;
}
function addDays(ds, n) {
  var d = parseDate(ds);
  return dateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}
function daysBetween(a, b) {
  var x = parseDate(a), y = parseDate(b);
  return Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) -
                     Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 86400000);
}
function weekStart(ds) {
  var d = parseDate(ds);
  return dateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7));
}
function monthStart(ds) { return ds.slice(0, 8) + "01"; }
function monthEnd(ds) {
  var d = parseDate(ds);
  return dateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
function rangeList(a, b) {
  var l = [];
  if (a > b) return l;
  var d = parseDate(a);
  for (var i = 0; i < 4000; i++) {
    var s = dateStr(d);
    if (s > b) break;
    l.push(s);
    d.setDate(d.getDate() + 1);
  }
  return l;
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function shortD(ds) { var p = ds.split("-"); return Number(p[1]) + "/" + Number(p[2]); }
function fmtDate(ds, wd) {
  var p = ds.split("-"), m = Number(p[1]), d = Number(p[2]), f = prefs.dateFmt;
  var s = f === "kor" ? m + "월 " + d + "일" : (f === "iso" ? ds : m + "/" + d);
  if (wd) s += " (" + DAYNAMES[parseDate(ds).getDay()] + ")";
  return s;
}
function dayName(ds) { return DAYNAMES[parseDate(ds).getDay()] + "요일"; }
function percent(done, req) { return req === 0 ? 0 : Math.round(done / req * 100); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// ---------- 화면 설정 (이 기기에만 저장) ----------
function defaultPrefs() {
  var c = {};
  CARD_KEYS.forEach(function (k) { c[k] = true; });
  return { theme: "light", font: "normal", dateFmt: "md", startTab: "home", statsPeriod: 7, view: "table", hideDone: false, cards: c };
}
function loadPrefs() {
  var p = defaultPrefs(), s = null;
  try { s = JSON.parse(localStorage.getItem(PREF_KEY) || "null"); } catch (e) {}
  if (s && typeof s === "object") {
    if (s.theme === "dark") p.theme = "dark";
    if (FONTS[s.font]) p.font = s.font;
    if (["md", "kor", "iso"].indexOf(s.dateFmt) >= 0) p.dateFmt = s.dateFmt;
    if (TABS.indexOf(s.startTab) >= 0) p.startTab = s.startTab;
    if ([7, 30, 90].indexOf(s.statsPeriod) >= 0) p.statsPeriod = s.statsPeriod;
    if (s.view === "cards") p.view = "cards";
    p.hideDone = !!s.hideDone;
    if (s.cards && typeof s.cards === "object") {
      CARD_KEYS.forEach(function (k) { if (s.cards[k] === false) p.cards[k] = false; });
    }
  }
  return p;
}
function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { toast("설정을 저장하지 못했어요"); }
}
function applyPrefs() {
  document.documentElement.setAttribute("data-theme", prefs.theme);
  document.documentElement.style.fontSize = FONTS[prefs.font] + "px";
}
var prefs = loadPrefs();

// ---------- 데이터 검증 / 불러오기 / 저장 ----------
function freshData() {
  return { ver: 2, startDate: todayS(), tasks: [], records: {}, nextId: 1, memos: {}, pin: null, honest: true, skips: {}, history: [] };
}
function cleanDays(a) {
  var out = [];
  if (Array.isArray(a)) a.forEach(function (x) {
    x = Number(x);
    if (x >= 0 && x <= 6 && x % 1 === 0 && out.indexOf(x) < 0) out.push(x);
  });
  out.sort(function (p, q) { return p - q; });
  return out.length ? out : [0, 1, 2, 3, 4, 5, 6];
}
function cleanOff(a) {
  var out = [];
  if (Array.isArray(a)) a.forEach(function (r) {
    if (!r || !isDateStr(r.from)) return;
    var to = r.to === undefined ? null : r.to;
    if (to === null || isDateStr(to)) out.push({ from: r.from, to: to });
  });
  return out;
}
function cleanGoals(a) {
  var out = [];
  if (Array.isArray(a)) a.forEach(function (g) {
    if (!g || (g.type !== "weekly" && g.type !== "monthly") || !isDateStr(g.from)) return;
    var c = Number(g.count), max = g.type === "weekly" ? 7 : 31;
    if (!(c >= 1 && c <= max) || c % 1 !== 0) return;
    var to = g.to === undefined ? null : g.to;
    if (to !== null && (!isDateStr(to) || to < g.from)) return;
    out.push({ type: g.type, count: c, from: g.from, to: to });
  });
  return out;
}
function cleanCycle(c) {
  if (!c || !Array.isArray(c.names)) return null;
  var names = c.names.map(function (s) { return String(s).trim().slice(0, 20); }).filter(function (s) { return s; });
  if (names.length < 2 || names.length > 6) return null;
  var r = Number(c.rest) || 1;
  return { names: names, rest: Math.min(3, Math.max(1, r)) };
}
function cleanHist(a) {
  var out = [];
  if (Array.isArray(a)) a.forEach(function (h) {
    if (h && typeof h === "object" && typeof h.t === "number" && typeof h.type === "string" && typeof h.label === "string") {
      out.push({ id: out.length + 1, t: h.t, type: h.type, label: h.label,
                 undo: (h.undo && typeof h.undo === "object") ? h.undo : null, undone: !!h.undone });
    }
  });
  return out.slice(-HIST_MAX);
}
// 올바른 데이터면 정리해서 돌려주고, 아니면 null
function normalize(d) {
  if (!d || typeof d !== "object" || !Array.isArray(d.tasks) || !d.records || typeof d.records !== "object" ||
      typeof d.startDate !== "string" || !isDateStr(d.startDate)) return null;
  var out = freshData();
  out.startDate = d.startDate;
  var seen = {}, maxId = 0;
  d.tasks.forEach(function (t) {
    if (!t || typeof t !== "object") return;
    var id = Number(t.id);
    if (!(id > 0) || id % 1 !== 0 || seen[id]) return;
    if (typeof t.name !== "string" || !t.name.trim()) return;
    var nt = {
      id: id, name: t.name, created: isDateStr(t.created) ? t.created : out.startDate,
      mode: "days", days: cleanDays(t.days), off: cleanOff(t.off), pinned: !!t.pinned, goals: cleanGoals(t.goals)
    };
    var cy = t.mode === "cycle" ? cleanCycle(t.cycle) : null;
    if (cy) { nt.mode = "cycle"; nt.cycle = cy; }
    seen[id] = true;
    if (id > maxId) maxId = id;
    out.tasks.push(nt);
  });
  function copyMap(src, dst) {
    if (!src || typeof src !== "object") return;
    Object.keys(src).forEach(function (ds) {
      var r = src[ds];
      if (!isDateStr(ds) || !r || typeof r !== "object") return;
      Object.keys(r).forEach(function (k) {
        if (r[k] && seen[Number(k)]) { if (!dst[ds]) dst[ds] = {}; dst[ds][Number(k)] = true; }
      });
    });
  }
  copyMap(d.records, out.records);
  copyMap(d.skips, out.skips);
  if (d.memos && typeof d.memos === "object") {
    Object.keys(d.memos).forEach(function (ds) {
      if (isDateStr(ds) && typeof d.memos[ds] === "string" && d.memos[ds]) out.memos[ds] = d.memos[ds];
    });
  }
  out.pin = typeof d.pin === "string" && d.pin ? d.pin : null;
  out.honest = d.honest !== false;
  out.nextId = Math.max(Number(d.nextId) || 1, maxId + 1);
  out.history = cleanHist(d.history);
  return out;
}
function load() {
  var raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) {}
  if (raw) {
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) {}
    var d = normalize(parsed);
    if (d) {
      if (!parsed.ver) {
        try { if (!localStorage.getItem(KEY + "-pre-v2")) localStorage.setItem(KEY + "-pre-v2", raw); } catch (e) {}
      }
      return d;
    }
    try { localStorage.setItem(KEY + "-corrupt", raw); } catch (e) {}
    loadNotice = "저장된 데이터를 읽지 못해서 원본을 따로 보관했어요. 설정의 백업 칸에서 확인할 수 있어요.";
  }
  return freshData();
}
function save() {
  schedCache = null;
  data.ver = 2;
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) {}
  if (data.history.length > 20) {
    data.history.splice(0, data.history.length - 20);
    try { localStorage.setItem(KEY, JSON.stringify(data)); toast("저장 공간이 부족해서 오래된 내역을 지웠어요"); return true; } catch (e2) {}
  }
  alert("저장에 실패했어요. 브라우저 저장공간을 확인해 주세요.");
  return false;
}

var data = load();
save();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
  window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
}

var now0 = new Date();
var viewYear = now0.getFullYear();
var viewMonth = now0.getMonth();
var fstate = { sel: null, archived: true, period: prefs.statsPeriod, from: "", to: "", unit: "day" };
var revWeek = weekStart(todayS());

// ---------- 기본 계산 ----------
function allDates() { return rangeList(data.startDate, todayS()); }
function monthDates(y, m) {
  var l = [], last = new Date(y, m + 1, 0).getDate();
  for (var d = 1; d <= last; d++) l.push(dateStr(new Date(y, m, d)));
  return l;
}
function startYM() { var p = data.startDate.split("-"); return Number(p[0]) * 12 + Number(p[1]) - 1; }
function currentYM() { var n = new Date(); return n.getFullYear() * 12 + n.getMonth(); }
function canEdit(ds) {
  if (!data.honest) return true;
  var t = todayS();
  return ds === t || ds === addDays(t, -1);
}
function taskById(id) { return data.tasks.find(function (t) { return t.id === id; }); }
function isDone(id, ds) { return !!(data.records[ds] && data.records[ds][id]); }
function isSkipped(id, ds) { return !!(data.skips[ds] && data.skips[ds][id]); }
function skipCount(id, ym) {
  var c = 0;
  Object.keys(data.skips).forEach(function (ds) { if (ds.indexOf(ym) === 0 && data.skips[ds][id]) c += 1; });
  return c;
}
function setMap(map, id, ds, val) {
  if (val) { if (!map[ds]) map[ds] = {}; map[ds][id] = true; }
  else if (map[ds]) { delete map[ds][id]; if (!Object.keys(map[ds]).length) delete map[ds]; }
}
function setRec(id, ds, val) { setMap(data.records, id, ds, val); }
function setSkip(id, ds, val) { setMap(data.skips, id, ds, val); }

function isArchived(t) { return !!(t.off && t.off.length && t.off[t.off.length - 1].to === null); }
function archivedOn(t, ds) {
  if (!t.off) return false;
  for (var i = 0; i < t.off.length; i++) {
    var r = t.off[i];
    if (ds >= r.from && (r.to === null || ds < r.to)) return true;
  }
  return false;
}
function taskDays(t) { return (t.days && t.days.length) ? t.days : [0, 1, 2, 3, 4, 5, 6]; }
function isCycle(t) { return t.mode === "cycle" && t.cycle && t.cycle.names && t.cycle.names.length >= 2; }
function cycleRest(t) { return Math.min(3, Math.max(1, Number(t.cycle && t.cycle.rest) || 1)); }

// 목표 (주간/월간). 목표가 없으면 기존처럼 매일 해야 하는 일
function goalOn(t, ds) {
  if (isCycle(t)) return null;
  var b = null;
  (t.goals || []).forEach(function (g) {
    if (g.from <= ds && (g.to === null || ds <= g.to) && (!b || g.from >= b.from)) b = g;
  });
  return b;
}
function goalForRange(t, ps, pe) {
  var b = null;
  (t.goals || []).forEach(function (g) {
    if (g.from <= pe && (g.to === null || g.to >= ps) && (!b || g.from >= b.from)) b = g;
  });
  return b;
}
function periodRange(type, ds) {
  if (type === "weekly") { var ws = weekStart(ds); return { from: ws, to: addDays(ws, 6) }; }
  return { from: monthStart(ds), to: monthEnd(ds) };
}
function countDone(t, a, b) {
  var c = 0;
  rangeList(a, b).forEach(function (ds) { if (isDone(t.id, ds)) c += 1; });
  return c;
}
function goalPeriods(t, today) {
  var out = [], seen = {};
  if (isCycle(t)) return out;
  (t.goals || []).forEach(function (g) {
    var end = (g.to !== null && g.to < today) ? g.to : today;
    if (g.from > end) return;
    var cur = periodRange(g.type, g.from).from;
    for (var i = 0; i < 700; i++) {
      var pr = periodRange(g.type, cur);
      if (pr.from > end) break;
      var key = g.type + pr.from;
      if (!seen[key] && goalForRange(t, pr.from, pr.to) === g) {
        seen[key] = 1;
        var cnt = countDone(t, pr.from, pr.to < today ? pr.to : today);
        out.push({ type: g.type, from: pr.from, to: pr.to, target: g.count, done: cnt, finished: pr.to < today, achieved: cnt >= g.count });
      }
      cur = g.type === "weekly" ? addDays(pr.from, 7) : addDays(pr.to, 1);
    }
  });
  out.sort(function (a, b) { return a.from < b.from ? -1 : 1; });
  return out;
}
function goalSummary(t) {
  var ps = goalPeriods(t, todayS()), cur = null, fin = [];
  ps.forEach(function (p) { if (p.finished) fin.push(p); else cur = p; });
  var ach = fin.filter(function (p) { return p.achieved; }).length;
  return { cur: cur, fin: fin, ach: ach, all: ps };
}
function goalLabel(g) { return (g.type === "weekly" ? "주 " : "월 ") + g.count + "회 목표"; }

// 순환 일정 계산 (A -> B -> C -> 쉼)
function buildCycle(t, today) {
  var res = {}, names = t.cycle.names, n = names.length, total = n + cycleRest(t), pos = 0;
  var d = parseDate(t.created);
  for (var i = 0; i < 5000; i++) {
    var ds = dateStr(d);
    if (ds > today) break;
    if (archivedOn(t, ds)) res[ds] = { s: "off" };
    else if (pos >= n) { res[ds] = { s: "rest" }; pos = (pos + 1) % total; }
    else if (isSkipped(t.id, ds)) res[ds] = { s: "skip", label: names[pos] };
    else { res[ds] = { s: "work", label: names[pos] }; if (isDone(t.id, ds)) pos = (pos + 1) % total; }
    d.setDate(d.getDate() + 1);
  }
  return res;
}
// before / future / off / rest / skip / free(목표 방식) / work
function cellState(t, ds) {
  var today = todayS();
  if (ds < t.created) return { s: "before" };
  if (ds > today) return { s: "future" };
  if (isCycle(t)) {
    if (!schedCache || schedCache.day !== today) schedCache = { day: today, map: {} };
    var m = schedCache.map[t.id];
    if (!m) { m = buildCycle(t, today); schedCache.map[t.id] = m; }
    return m[ds] || { s: "before" };
  }
  if (archivedOn(t, ds)) return { s: "off" };
  if (taskDays(t).indexOf(parseDate(ds).getDay()) === -1) return { s: "rest" };
  if (isSkipped(t.id, ds)) return { s: "skip" };
  if (goalOn(t, ds)) return { s: "free" };
  return { s: "work" };
}
function isReq(t, ds) { return cellState(t, ds).s === "work"; }
function daysLabel(t) {
  if (isCycle(t)) return "순환 " + t.cycle.names.join(" → ") + " → 쉼" + (cycleRest(t) > 1 ? "×" + cycleRest(t) : "");
  var d = taskDays(t), s = d.length === 7 ? "매일" : d.map(function (i) { return DAYNAMES[i]; }).join(" ");
  var g = goalOn(t, todayS());
  return g ? s + " 중 " + goalLabel(g) : s;
}
function dayInfo(ds, tasks) {
  var req = 0, done = 0, cycRest = 0, skipN = 0;
  (tasks || data.tasks).forEach(function (t) {
    var s = cellState(t, ds).s;
    if (s === "work") { req += 1; if (isDone(t.id, ds)) done += 1; }
    else if (s === "skip") skipN += 1;
    else if (s === "rest" && isCycle(t)) cycRest += 1;
  });
  return { req: req, done: done, restDay: (req === 0 && cycRest > 0 && skipN === 0) };
}
function isPerfect(info) { return (info.req > 0 && info.done === info.req) || info.restDay; }
function sumInfo(dates, tasks) {
  var req = 0, done = 0, perfect = 0, withData = 0;
  dates.forEach(function (ds) {
    var i = dayInfo(ds, tasks);
    req += i.req; done += i.done;
    if (i.req > 0) withData += 1;
    if (isPerfect(i)) perfect += 1;
  });
  return { req: req, done: done, perfect: perfect, withData: withData };
}
function taskInfo(t, dates) {
  var req = 0, done = 0;
  dates.forEach(function (ds) {
    if (isReq(t, ds)) { req += 1; if (isDone(t.id, ds)) done += 1; }
  });
  return { req: req, done: done };
}
function streakInfo(dates, tasks) {
  var today = todayS(), cur = 0, best = 0;
  dates.forEach(function (ds) {
    var i = dayInfo(ds, tasks);
    if (i.req === 0 && !i.restDay) return;
    if (isPerfect(i)) { cur += 1; if (cur > best) best = cur; }
    else if (ds !== today) cur = 0;
  });
  return { cur: cur, best: best };
}
function missStreak(t) {
  var d = addDays(todayS(), -1), c = 0;
  for (var i = 0; i < 800; i++) {
    if (d < t.created) break;
    if (cellState(t, d).s === "work") { if (isDone(t.id, d)) break; c += 1; }
    d = addDays(d, -1);
  }
  return c;
}
function orderedActive() {
  var a = data.tasks.filter(function (t) { return !isArchived(t); });
  return a.filter(function (t) { return t.pinned; }).concat(a.filter(function (t) { return !t.pinned; }));
}

// ---------- 변경 내역 / 되돌리기 ----------
function histNextId() {
  var m = 0;
  data.history.forEach(function (h) { if (h.id > m) m = h.id; });
  return m + 1;
}
function logH(type, label, undo) {
  data.history.push({ id: histNextId(), t: Date.now(), type: type, label: label, undo: undo || null, undone: false });
  if (data.history.length > HIST_MAX) data.history.splice(0, data.history.length - HIST_MAX);
}
function taskSnap(t) {
  return clone({ name: t.name, mode: t.mode, days: t.days, cycle: t.cycle || null, goals: t.goals || [], pinned: !!t.pinned });
}
function applySnap(t, s) {
  t.name = s.name; t.mode = s.mode; t.days = s.days; t.goals = s.goals; t.pinned = !!s.pinned;
  if (s.cycle) t.cycle = s.cycle; else delete t.cycle;
}
function ordIds() { return data.tasks.map(function (t) { return t.id; }); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// 결과: 문자열이면 실패 이유, null이면 성공
function undoEntry(e) {
  var u = e.undo;
  if (!u) return "되돌릴 수 없는 작업이에요.";
  if (e.undone) return "이미 되돌린 작업이에요.";
  var CONF = "그 뒤에 같은 항목이 또 바뀌어서 되돌릴 수 없어요. 최근 작업부터 되돌려 주세요.";
  var HON = "정직 모드: 오늘과 어제 기록만 되돌릴 수 있어요.";
  try {
    var t;
    switch (u.k) {
      case "rec":
        if (!taskById(u.id)) return "그 할 일이 지금은 없어요.";
        if (!canEdit(u.ds)) return HON;
        if (isDone(u.id, u.ds) !== u.to) return CONF;
        setRec(u.id, u.ds, u.from);
        break;
      case "skip":
        if (!taskById(u.id)) return "그 할 일이 지금은 없어요.";
        if (!canEdit(u.ds)) return HON;
        if (isSkipped(u.id, u.ds) !== u.to) return CONF;
        setSkip(u.id, u.ds, u.from);
        break;
      case "memo":
        if ((data.memos[u.ds] || "") !== u.to) return CONF;
        if (u.from) data.memos[u.ds] = u.from; else delete data.memos[u.ds];
        break;
      case "add":
        t = taskById(u.id);
        if (!t) return "그 할 일이 지금은 없어요.";
        var hasRec = Object.keys(data.records).some(function (d) { return data.records[d][u.id]; }) ||
                     Object.keys(data.skips).some(function (d) { return data.skips[d][u.id]; });
        if (hasRec) return "그 할 일에 이미 기록이 있어서 되돌릴 수 없어요. 직접 삭제해 주세요.";
        data.tasks = data.tasks.filter(function (x) { return x.id !== u.id; });
        break;
      case "edit":
        t = taskById(u.id);
        if (!t) return "그 할 일이 지금은 없어요.";
        if (!same(taskSnap(t), u.after)) return CONF;
        applySnap(t, clone(u.before));
        break;
      case "arc":
        t = taskById(u.id);
        if (!t) return "그 할 일이 지금은 없어요.";
        if (!same(t.off || [], u.after)) return CONF;
        t.off = clone(u.before);
        break;
      case "order":
        if (!same(ordIds(), u.after)) return CONF;
        var map = {};
        data.tasks.forEach(function (x) { map[x.id] = x; });
        data.tasks = u.before.map(function (id) { return map[id]; });
        break;
      case "del":
        if (taskById(u.task.id)) return "같은 할 일이 이미 있어요.";
        var nt = normalize({ startDate: data.startDate, tasks: [u.task], records: {}, nextId: 1 });
        if (!nt || !nt.tasks.length) return "삭제 기록이 손상되어 복구할 수 없어요.";
        var idx = Math.min(Math.max(0, Number(u.index) || 0), data.tasks.length);
        data.tasks.splice(idx, 0, nt.tasks[0]);
        Object.keys(u.records || {}).forEach(function (d) { if (isDateStr(d)) setRec(u.task.id, d, true); });
        Object.keys(u.skips || {}).forEach(function (d) { if (isDateStr(d)) setSkip(u.task.id, d, true); });
        if (u.task.id >= data.nextId) data.nextId = u.task.id + 1;
        break;
      default:
        return "되돌릴 수 없는 기록이에요.";
    }
  } catch (err) {
    return "되돌리는 중 오류가 났어요. 데이터는 바뀌지 않았어요.";
  }
  e.undone = true;
  e.undoneAt = Date.now();
  save();
  return null;
}
function lastUndoable() {
  for (var i = data.history.length - 1; i >= 0; i--) {
    var h = data.history[i];
    if (h.undo && !h.undone) return h;
  }
  return null;
}
function doUndo(h) {
  var r = undoEntry(h);
  if (r) { toast(r); alert(r); return; }
  toast("되돌렸어요");
  render(true);
}

// ---------- 데이터를 바꾸는 동작 (모두 내역에 기록) ----------
function toggleRec(id, ds) {
  var t = taskById(id);
  if (!t) return;
  var from = isDone(id, ds);
  setRec(id, ds, !from);
  logH("체크", t.name + " (" + fmtDate(ds) + ") " + (from ? "O → X" : "X → O"), { k: "rec", id: id, ds: ds, from: from, to: !from });
  save();
  render(true);
}
function changeSkip(id, ds, val) {
  var t = taskById(id);
  var from = isSkipped(id, ds);
  if (from === val) return;
  setSkip(id, ds, val);
  logH("스킵", t.name + " (" + fmtDate(ds) + ") 스킵 " + (val ? "설정" : "취소"), { k: "skip", id: id, ds: ds, from: from, to: val });
  save();
}
function changeMemo(ds, text) {
  var from = data.memos[ds] || "";
  if (from === text) return;
  if (text) data.memos[ds] = text; else delete data.memos[ds];
  logH("메모", fmtDate(ds) + " 메모 " + (!from ? "추가" : (text ? "수정" : "삭제")), { k: "memo", ds: ds, from: from, to: text });
  save();
  render(true);
}
function addTask(name) {
  var t = { id: data.nextId, name: name, created: todayS(), mode: "days", days: [0, 1, 2, 3, 4, 5, 6], off: [], pinned: false, goals: [] };
  data.nextId += 1;
  data.tasks.push(t);
  logH("추가", "할 일 추가 : " + name, { k: "add", id: t.id });
  save();
  render(true);
}
function changeTask(t, mutate, label) {
  var before = taskSnap(t);
  mutate();
  var after = taskSnap(t);
  if (same(before, after)) return;
  logH("수정", label(before, after), { k: "edit", id: t.id, before: before, after: after });
  save();
}
function deleteTask(id) {
  var t = taskById(id);
  if (!t) return false;
  if (!confirm("'" + t.name + "' 을(를) 삭제할까요?\n이 일의 기록도 함께 사라져요.\n(실수하면 내역 탭에서 되돌릴 수 있어요)")) return false;
  var recs = {}, sk = {};
  Object.keys(data.records).forEach(function (d) { if (data.records[d][id]) recs[d] = true; });
  Object.keys(data.skips).forEach(function (d) { if (data.skips[d][id]) sk[d] = true; });
  var index = data.tasks.indexOf(t);
  logH("삭제", "할 일 삭제 : " + t.name, { k: "del", task: clone(t), index: index, records: recs, skips: sk });
  data.tasks = data.tasks.filter(function (x) { return x.id !== id; });
  Object.keys(recs).forEach(function (d) { setRec(id, d, false); });
  Object.keys(sk).forEach(function (d) { setSkip(id, d, false); });
  save();
  return true;
}
function archiveTask(t) {
  var before = clone(t.off || []);
  if (!t.off) t.off = [];
  t.off.push({ from: todayS(), to: null });
  logH("보관", "할 일 보관 : " + t.name, { k: "arc", id: t.id, before: before, after: clone(t.off) });
  save();
}
function restoreTask(t) {
  var before = clone(t.off || []), today = todayS();
  var last = t.off && t.off[t.off.length - 1];
  if (last && last.to === null) {
    if (last.from === today) t.off.pop(); else last.to = today;
  }
  logH("복원", "보관 복원 : " + t.name, { k: "arc", id: t.id, before: before, after: clone(t.off) });
  save();
}
function moveTask(id, dir) {
  var list = orderedActive(), t = taskById(id);
  var group = list.filter(function (x) { return !!x.pinned === !!t.pinned; });
  var gi = group.indexOf(t), other = group[gi + dir];
  if (!other) return;
  var before = ordIds(), i = data.tasks.indexOf(t), j = data.tasks.indexOf(other);
  data.tasks[i] = other; data.tasks[j] = t;
  logH("순서", "순서 변경 : " + t.name + (dir < 0 ? " ▲" : " ▼"), { k: "order", before: before, after: ordIds() });
  save();
  render(true);
}
function togglePin(t) {
  changeTask(t, function () { t.pinned = !t.pinned; }, function () { return (t.pinned ? "상단 고정 : " : "고정 해제 : ") + t.name; });
  render(true);
}

// ---------- 공통 화면 도우미 ----------
function toast(msg) {
  var el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(function () { el.hidden = true; }, 2200);
}
function openPanel(html) {
  document.getElementById("panel").innerHTML = html;
  document.getElementById("overlay").hidden = false;
}
function closePanel() {
  document.getElementById("overlay").hidden = true;
  document.getElementById("panel").innerHTML = "";
}
function seg(attr, items, cur) {
  return "<div class='seg'>" + items.map(function (it) {
    return "<button data-" + attr + "='" + it[0] + "' class='" + (String(it[0]) === String(cur) ? "on" : "") + "'>" + it[1] + "</button>";
  }).join("") + "</div>";
}
function copyText(text, okMsg) {
  var done = function () { toast(okMsg); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, okMsg); });
      return;
    }
  } catch (e) {}
  fallbackCopy(text, okMsg);
}
function fallbackCopy(text, okMsg) {
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  var ok = false;
  try { ok = document.execCommand("copy"); } catch (e) {}
  ta.remove();
  toast(ok ? okMsg : "복사하지 못했어요. 파일로 저장해 주세요");
}
function downloadText(name, text) {
  var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
}

// ---------- 기록 화면 ----------
function statBox(label, info, wide) {
  return "<div class='stat" + (wide ? " wide" : "") + "'><div class='label'>" + label + "</div>" +
         "<div class='value'>" + percent(info.done, info.req) + "%</div>" +
         "<div class='sub'>" + info.done + " / " + info.req + "</div></div>";
}
function renderStatCards(all) {
  var today = todayS(), c = prefs.cards, h = "";
  var mp = viewYear + "-" + pad(viewMonth + 1) + "-", yp = viewYear + "-";
  var wk = weekStart(today), we = addDays(wk, 6);
  var allInfo = sumInfo(all);
  if (c.today) h += statBox("오늘 달성률", sumInfo([today]));
  if (c.week) h += statBox("이번 주 달성률", sumInfo(all.filter(function (d) { return d >= wk && d <= we; })));
  if (c.month) h += statBox((viewMonth + 1) + "월 달성률", sumInfo(all.filter(function (d) { return d.indexOf(mp) === 0; })));
  if (c.year) h += statBox(viewYear + "년 달성률", sumInfo(all.filter(function (d) { return d.indexOf(yp) === 0; })));
  if (c.all) h += statBox("지금까지의 달성률", allInfo, true);
  if (c.perfect) h += "<div class='stat black'><div class='label'>PERFECT DAY</div><div class='value'>" + allInfo.perfect + "번</div><div class='sub'>지금까지</div></div>";
  if (c.streak) {
    var st = streakInfo(all);
    h += "<div class='stat black'><div class='label'>연속 PERFECT DAY</div><div class='value'>" + st.cur + "일</div><div class='sub'>최고 " + st.best + "일</div></div>";
  }
  document.getElementById("stats").innerHTML = h;
}
function renderWarn() {
  var el = document.getElementById("warnBox"), today = todayS(), msgs = [];
  data.tasks.forEach(function (t) {
    if (isArchived(t)) return;
    var cs = cellState(t, today);
    if (cs.s === "work" && isDone(t.id, today)) return;
    var m = missStreak(t);
    if (m >= 2) msgs.push("[경고] " + esc(t.name) + " : " + m + "일 연속 X." + (cs.s === "work" ? " 오늘 O로 끊어!" : ""));
    else if (m === 1 && cs.s === "work") msgs.push("[주의] " + esc(t.name) + " : 어제 X. 오늘도 빼먹으면 2일 연속!");
  });
  el.innerHTML = msgs.join("<br>");
  el.hidden = msgs.length === 0;
}
function renderUndoBar() {
  var el = document.getElementById("undoBar"), h = lastUndoable();
  if (!h) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = "<span>마지막 작업 : " + esc(h.label) + "</span><button id='undoBtn'>되돌리기</button>";
  document.getElementById("undoBtn").addEventListener("click", function () { doUndo(h); });
}
function renderMonthNav() {
  document.getElementById("monthLabel").textContent = viewYear + "년 " + (viewMonth + 1) + "월";
  var v = viewYear * 12 + viewMonth;
  document.getElementById("prevBtn").disabled = v <= startYM();
  document.getElementById("nextBtn").disabled = v >= currentYM();
}
function changeMonth(diff) {
  var d = new Date(viewYear, viewMonth + diff, 1), ym = d.getFullYear() * 12 + d.getMonth();
  if (ym < startYM() || ym > currentYM()) return;
  viewYear = d.getFullYear();
  viewMonth = d.getMonth();
  renderHome(false);
}
function cellHtml(t, ds, cs) {
  var a = "data-id='" + t.id + "' data-date='" + ds + "'";
  if (cs.s === "future") return { c: "none", h: "·" };
  if (cs.s === "before") return { c: "none", h: "-" };
  if (cs.s === "rest") return { c: "none", h: "쉼" };
  if (cs.s === "off") return { c: "none", h: "보관" };
  var ok = canEdit(ds), done = isDone(t.id, ds), act = ok ? "toggle" : "locked";
  if (cs.s === "skip") {
    return { c: "", h: "<button class='cell sk' data-act='" + (ok ? "unskip" : "locked") + "' " + a + " aria-label='스킵한 날'>" +
      (cs.label ? "<span class='lab'>" + esc(cs.label) + "</span>" : "") + "<span class='mk'>스킵</span></button>" };
  }
  if (cs.s === "free") {
    return { c: "", h: "<button class='cell " + (done ? "o" : "fr") + "' data-act='" + act + "' " + a + "><span class='mk'>" + (done ? "O" : "+") + "</span></button>" };
  }
  var cyc = !!cs.label;
  return { c: "", h: "<button class='cell " + (done ? "o" : "x") + (cyc ? " cyc" : "") + "' data-act='" + act + "' " + a + ">" +
    (cyc ? "<span class='lab'>" + esc(cs.label) + "</span>" : "") + "<span class='mk'>" + (done ? "O" : "X") + "</span></button>" };
}
function nameCellHtml(t, active, all, today) {
  var ti = taskInfo(t, all), gs = goalSummary(t), cs = cellState(t, today);
  var group = active.filter(function (x) { return !!x.pinned === !!t.pinned; }), gi = group.indexOf(t);
  var h = "<div class='name-text'>" + esc(t.name) + (t.pinned ? "<span class='pin-tag'>고정</span>" : "") + "</div>";
  h += "<div class='days-text'>" + esc(daysLabel(t)) + "</div>";
  if (isCycle(t)) {
    var tl = cs.s === "work" ? cs.label : (cs.s === "rest" ? "쉼" : (cs.s === "skip" ? "스킵" : "-"));
    h += "<div class='days-text'>오늘 차례 : " + esc(tl) + ((cs.s === "work" && isDone(t.id, today)) ? " (완료)" : "") + "</div>";
  }
  h += "<div class='chip-row'>";
  if (ti.req > 0) h += "<span class='task-rate'>달성률 " + percent(ti.done, ti.req) + "% (" + ti.done + "/" + ti.req + ")</span>";
  if (gs.all.length) {
    if (gs.cur && goalOn(t, today)) {
      h += "<span class='goal-chip" + (gs.cur.achieved ? " ok" : "") + "'>" + (gs.cur.type === "weekly" ? "이번 주 " : "이번 달 ") +
           gs.cur.done + "/" + gs.cur.target + (gs.cur.achieved ? " 달성" : "") + "</span>";
    }
    if (gs.fin.length) h += "<span class='goal-chip'>목표 달성 " + gs.ach + "/" + gs.fin.length + "기간 (" + percent(gs.ach, gs.fin.length) + "%)</span>";
  }
  h += "</div><div class='tools'>" +
    "<button data-act='edit' data-id='" + t.id + "'>수정</button>" +
    "<button data-act='arc' data-id='" + t.id + "'>보관</button>" +
    "<button data-act='skip' data-id='" + t.id + "'>스킵</button>" +
    "<button data-act='pin' data-id='" + t.id + "'>" + (t.pinned ? "고정 해제" : "고정") + "</button>" +
    "<button data-act='up' data-id='" + t.id + "' aria-label='위로'" + (gi === 0 ? " disabled" : "") + ">▲</button>" +
    "<button data-act='down' data-id='" + t.id + "' aria-label='아래로'" + (gi === group.length - 1 ? " disabled" : "") + ">▼</button></div>";
  return h;
}
function renderHome(keep) {
  schedCache = null;
  var wrap = document.getElementById("tableWrap"), old = wrap.scrollLeft;
  var all = allDates(), today = todayS();
  renderStatCards(all);
  renderMonthNav();
  renderWarn();
  renderUndoBar();
  document.getElementById("honestNote").textContent = data.honest ? "정직 모드 ON : 오늘과 어제만 체크할 수 있어요" : "";
  document.getElementById("viewBtn").textContent = "보기 : " + (prefs.view === "cards" ? "날짜별 카드" : "표");
  document.getElementById("hideBtn").textContent = "완료한 할 일 : " + (prefs.hideDone ? "숨김" : "표시");
  wrap.className = "table-wrap" + (prefs.view === "cards" ? " cardsmode" : "");

  var active = orderedActive();
  if (!active.length) {
    wrap.innerHTML = "<div class='empty'>" + (data.tasks.length ? "보관되지 않은 할 일이 없어요.<br>위에서 추가하거나 설정의 보관함을 확인해 보세요." : "아직 해야 할 일이 없어요.<br>위에서 추가해 보세요!") + "</div>";
    return;
  }
  var rows = active, hidden = 0;
  if (prefs.hideDone) {
    rows = active.filter(function (t) {
      var s = cellState(t, today).s, dn = (s === "work" || s === "free") && isDone(t.id, today);
      if (dn) hidden += 1;
      return !dn;
    });
  }
  if (!rows.length) {
    wrap.innerHTML = "<div class='empty'>오늘 할 일을 모두 끝냈어요.<br>(완료한 할 일 " + hidden + "개 숨김 중)</div>";
    return;
  }
  if (prefs.view === "cards") renderCards(wrap, rows, active, all, today);
  else renderTable(wrap, rows, active, all, today, keep, old);
}
function renderTable(wrap, rows, active, all, today, keep, old) {
  var dates = monthDates(viewYear, viewMonth);
  var h = "<table><thead><tr><th class='name-col'>해야 할 일</th>";
  dates.forEach(function (ds) { h += "<th class='" + (ds === today ? "today" : "") + "'>" + esc(fmtDate(ds)) + "</th>"; });
  h += "</tr></thead><tbody>";
  rows.forEach(function (t) {
    h += "<tr><td class='name-col'>" + nameCellHtml(t, active, all, today) + "</td>";
    dates.forEach(function (ds) {
      var c = cellHtml(t, ds, cellState(t, ds));
      h += "<td class='" + c.c + "'>" + c.h + "</td>";
    });
    h += "</tr>";
  });
  h += "<tr class='result'><td class='name-col'>결과</td>";
  dates.forEach(function (ds) {
    var i = dayInfo(ds);
    if (ds > today || (i.req === 0 && !i.restDay)) h += "<td class='none'>-</td>";
    else if (isPerfect(i)) h += "<td class='perfect-cell'><div class='perfect'>PERFECT<br>DAY" + (i.restDay ? "<br>(쉼)" : "") + "</div></td>";
    else h += "<td>X</td>";
  });
  h += "</tr><tr class='rate'><td class='name-col'>날짜별 달성률</td>";
  dates.forEach(function (ds) {
    var i = dayInfo(ds);
    h += (ds > today || i.req === 0) ? "<td class='none'>-</td>" : "<td>" + percent(i.done, i.req) + "%</td>";
  });
  h += "</tr><tr class='memo'><td class='name-col'>한 줄 메모</td>";
  dates.forEach(function (ds) {
    if (ds > today) { h += "<td class='none'>·</td>"; return; }
    var m = data.memos[ds];
    h += "<td><button class='memo-btn" + (m ? "" : " empty-memo") + "' data-act='memo' data-date='" + ds + "'>" + (m ? esc(m) : "+") + "</button></td>";
  });
  h += "</tr></tbody></table>";
  wrap.innerHTML = h;
  if (keep) wrap.scrollLeft = old;
  else {
    var th = wrap.querySelector("th.today");
    wrap.scrollLeft = th ? Math.max(0, th.offsetLeft - 230) : 0;
  }
}
function renderCards(wrap, rows, active, all, today) {
  var h = "<div class='dcard'><div class='dhead'><span>내 할 일</span><span>" + rows.length + "개</span></div>";
  rows.forEach(function (t) { h += "<div class='drow'><div class='dname'>" + nameCellHtml(t, active, all, today) + "</div></div>"; });
  h += "</div>";
  var dates = monthDates(viewYear, viewMonth).filter(function (d) { return d <= today && d >= data.startDate; }).reverse();
  if (!dates.length) h += "<div class='empty'>이 달에는 표시할 날짜가 없어요.</div>";
  dates.forEach(function (ds) {
    var i = dayInfo(ds), p = isPerfect(i);
    var status = p ? "PERFECT DAY" + (i.restDay ? " (쉼)" : "") : (i.req ? percent(i.done, i.req) + "% (" + i.done + "/" + i.req + ")" : "기록 없음");
    h += "<div class='dcard'><div class='dhead" + (p ? " perfectday" : "") + "'><span>" + esc(fmtDate(ds, true)) + "</span><span>" + status + "</span></div>";
    rows.forEach(function (t) {
      var c = cellHtml(t, ds, cellState(t, ds));
      h += "<div class='drow'><div class='dname'>" + esc(t.name) + "</div><div class='dcell " + c.c + "'>" + c.h + "</div></div>";
    });
    var m = data.memos[ds];
    h += "<div class='dmemo'><button class='memo-btn" + (m ? "" : " empty-memo") + "' data-act='memo' data-date='" + ds + "'>" + (m ? esc(m) : "메모 +") + "</button></div></div>";
  });
  wrap.innerHTML = h;
}

// ---------- 통계 화면 (필터 + 기간 비교 + 기존 통계 통합) ----------
function filteredTasks() {
  return data.tasks.filter(function (t) {
    if (!fstate.archived && isArchived(t)) return false;
    if (fstate.sel && fstate.sel.indexOf(t.id) < 0) return false;
    return true;
  });
}
function curRange() {
  var today = todayS();
  if (fstate.period === "custom") {
    var f = fstate.from, t = fstate.to;
    if (!isDateStr(f) || !isDateStr(t) || f > t || t > today || daysBetween(f, t) > 1100) return null;
    return { from: f, to: t };
  }
  var n = Number(fstate.period);
  return { from: addDays(today, -(n - 1)), to: today };
}
function prevRange(r) {
  var n = daysBetween(r.from, r.to) + 1;
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}
function rateOf(s) { return s.req ? percent(s.done, s.req) : null; }
function rateText(r) { return r === null ? "기록 없음" : r + "%"; }
function diffText(c, p) {
  if (c === null || p === null) return "비교 불가";
  var d = c - p;
  return (d > 0 ? "+" : "") + d + "%p";
}
function buckets(range, unit) {
  var days = rangeList(range.from, range.to), out = [], cur = null;
  days.forEach(function (d) {
    var key = unit === "day" ? d : (unit === "week" ? weekStart(d) : d.slice(0, 7));
    if (!cur || cur.key !== key) {
      var label = unit === "day" ? shortD(d) : (unit === "week" ? shortD(d) + "~" : Number(d.slice(5, 7)) + "월");
      cur = { key: key, label: label, dates: [] };
      out.push(cur);
    }
    cur.dates.push(d);
  });
  return out;
}
function heatClass(pc) { return pc >= 100 ? "l4" : (pc >= 75 ? "l3" : (pc >= 50 ? "l2" : (pc >= 1 ? "l1" : "l0"))); }

function filterHtml() {
  var h = "<div class='chart'><div class='chart-title'>필터</div>";
  h += "<span class='label-s'>할 일 (여러 개 선택 가능)</span><div class='chips'>";
  h += "<button class='chip" + (fstate.sel === null ? " on" : "") + "' data-f='all'>전체</button>";
  data.tasks.forEach(function (t) {
    if (!fstate.archived && isArchived(t)) return;
    var on = fstate.sel && fstate.sel.indexOf(t.id) >= 0;
    h += "<button class='chip" + (on ? " on" : "") + "' data-f='task' data-id='" + t.id + "'>" + esc(t.name) + (isArchived(t) ? " (보관)" : "") + "</button>";
  });
  h += "</div><span class='label-s'>보관된 할 일</span><div class='chips'><button class='chip" + (fstate.archived ? " on" : "") + "' data-f='arch'>보관된 할 일 포함 : " + (fstate.archived ? "켜짐" : "꺼짐") + "</button></div>";
  h += "<span class='label-s'>기간</span>" + seg("fp", [[7, "최근 7일"], [30, "최근 30일"], [90, "최근 90일"], ["custom", "직접 지정"]], fstate.period);
  if (fstate.period === "custom") {
    var today = todayS();
    h += "<label class='label-s' for='fFrom'>시작일</label><input type='date' id='fFrom' data-fi='from' value='" + esc(fstate.from) + "' min='" + data.startDate + "' max='" + today + "'>";
    h += "<label class='label-s' for='fTo'>끝일</label><input type='date' id='fTo' data-fi='to' value='" + esc(fstate.to) + "' min='" + data.startDate + "' max='" + today + "'>";
  }
  h += "<span class='label-s'>그래프 단위</span>" + seg("fu", [["day", "일"], ["week", "주"], ["month", "월"]], fstate.unit);
  return h + "</div>";
}
function compareHtml(cr, ft) {
  var pr = prevRange(cr);
  var cs = sumInfo(rangeList(cr.from, cr.to), ft), ps = sumInfo(rangeList(pr.from, pr.to), ft);
  var cd = daysBetween(cr.from, cr.to) + 1;
  var cRate = rateOf(cs), pRate = rateOf(ps);
  var h = "<div class='chart'><div class='chart-title'>기간 비교</div>";
  h += "<div class='note'>최근 기간 : " + esc(fmtDate(cr.from)) + " ~ " + esc(fmtDate(cr.to)) + " (" + cd + "일)<br>이전 기간 : " + esc(fmtDate(pr.from)) + " ~ " + esc(fmtDate(pr.to)) + " (같은 길이)</div>";
  h += "<table class='tbl'><tr><th></th><th>이전</th><th>최근</th><th>변화</th></tr>";
  h += "<tr><td class='l'>달성률</td><td>" + rateText(pRate) + "</td><td>" + rateText(cRate) + "</td><td class='up'>" + diffText(cRate, pRate) + "</td></tr>";
  h += "<tr><td class='l'>완료 / 해야 한 횟수</td><td>" + ps.done + " / " + ps.req + "</td><td>" + cs.done + " / " + cs.req + "</td><td>" + (cs.done - ps.done > 0 ? "+" : "") + (cs.done - ps.done) + "회</td></tr>";
  h += "<tr><td class='l'>PERFECT DAY</td><td>" + ps.perfect + "번</td><td>" + cs.perfect + "번</td><td>" + (cs.perfect - ps.perfect > 0 ? "+" : "") + (cs.perfect - ps.perfect) + "번</td></tr>";
  h += "<tr><td class='l'>기록 있는 날</td><td>" + ps.withData + "일</td><td>" + cs.withData + "일</td><td></td></tr></table>";
  h += "<div class='note'>%p는 퍼센트포인트예요. 두 달성률의 차이를 뜻해요. (예: 70% → 78% 는 +8%p) 해야 할 일이 없었던 날은 0%가 아니라 '기록 없음'으로 따로 취급해요.</div></div>";
  return h;
}
function unitChartHtml(cr, ft) {
  var bs = buckets(cr, fstate.unit);
  var h = "<div class='chart'><div class='chart-title'>" + ({ day: "일별", week: "주별", month: "월별" })[fstate.unit] + " 달성률</div><div class='ucols'>";
  bs.forEach(function (b) {
    var r = rateOf(sumInfo(b.dates, ft));
    h += "<div class='ucol'><div class='uval'>" + (r === null ? "-" : r + "%") + "</div><div class='ubar-wrap'>" +
         (r === null ? "<div class='ubar nodata'></div>" : "<div class='ubar' style='height:" + Math.max(r, 2) + "%'></div>") +
         "</div><div class='ulab'>" + esc(b.label) + "</div></div>";
  });
  return h + "</div><div class='note'>점선 칸은 기록 없음, 검은 막대는 달성률이에요.</div></div>";
}
function weekdayHtml(cr, ft) {
  var pr = prevRange(cr), cd = rangeList(cr.from, cr.to), pd = rangeList(pr.from, pr.to);
  var h = "<div class='chart'><div class='chart-title'>요일별 비교</div><table class='tbl'><tr><th>요일</th><th>이전</th><th>최근</th><th>변화</th></tr>";
  [1, 2, 3, 4, 5, 6, 0].forEach(function (d) {
    var c = rateOf(sumInfo(cd.filter(function (x) { return parseDate(x).getDay() === d; }), ft));
    var p = rateOf(sumInfo(pd.filter(function (x) { return parseDate(x).getDay() === d; }), ft));
    h += "<tr><td class='l'>" + DAYNAMES[d] + "요일</td><td>" + rateText(p) + "</td><td>" + rateText(c) + "</td><td>" + diffText(c, p) + "</td></tr>";
  });
  return h + "</table></div>";
}
function taskCompareHtml(cr, ft) {
  var pr = prevRange(cr), cd = rangeList(cr.from, cr.to), pd = rangeList(pr.from, pr.to);
  var h = "<div class='chart'><div class='chart-title'>할 일별 비교</div>";
  if (!ft.length) return h + "<div class='note'>선택된 할 일이 없어요.</div></div>";
  h += "<table class='tbl'><tr><th>할 일</th><th>완료</th><th>이전</th><th>최근</th><th>변화</th></tr>";
  ft.forEach(function (t) {
    var ci = taskInfo(t, cd), pi = taskInfo(t, pd);
    var c = ci.req ? percent(ci.done, ci.req) : null, p = pi.req ? percent(pi.done, pi.req) : null;
    var cnt = countDone(t, cr.from, cr.to);
    h += "<tr><td class='l'>" + esc(t.name) + (isArchived(t) ? " (보관)" : "") + "</td><td>" + cnt + "회</td><td>" + rateText(p) + "</td><td>" + rateText(c) + "</td><td>" + diffText(c, p) + "</td></tr>";
  });
  return h + "</table><div class='note'>목표(주간/월간) 방식의 날은 '해야 한 횟수'에 넣지 않아서 달성률이 '기록 없음'일 수 있어요. 아래 목표 현황을 봐 주세요.</div></div>";
}
function goalHtml(ft) {
  var list = ft.filter(function (t) { return goalSummary(t).all.length; });
  var h = "<div class='chart'><div class='chart-title'>목표 현황</div>";
  if (!list.length) return h + "<div class='note'>주간/월간 목표를 정한 할 일이 없어요. 할 일의 '수정'에서 목표를 정할 수 있어요.</div></div>";
  list.forEach(function (t) {
    var gs = goalSummary(t), g = goalOn(t, todayS());
    h += "<div class='arc'><div class='name-text'>" + esc(t.name) + "</div>";
    if (g) h += "<div class='note'>지금 목표 : " + goalLabel(g) + "</div>";
    if (gs.cur) h += "<div class='note ok'>" + (gs.cur.type === "weekly" ? "이번 주 " : "이번 달 ") + gs.cur.done + "/" + gs.cur.target + (gs.cur.achieved ? " 달성" : "") + "</div>";
    if (gs.fin.length) {
      h += "<div class='note'>지난 기간 목표 달성 " + gs.ach + "/" + gs.fin.length + " (" + percent(gs.ach, gs.fin.length) + "%) — 이 숫자는 매일 달성률과 별개예요</div>";
      h += "<table class='tbl'><tr><th>기간</th><th>횟수</th><th>결과</th></tr>";
      gs.fin.slice(-6).reverse().forEach(function (p) {
        h += "<tr><td class='l'>" + esc(shortD(p.from)) + (p.type === "weekly" ? " 주" : " 월") + "</td><td>" + p.done + "/" + p.target + "</td><td>" + (p.achieved ? "O 달성" : "X 미달") + "</td></tr>";
      });
      h += "</table>";
    } else {
      h += "<div class='note'>아직 끝난 기간이 없어서 달성률은 데이터 부족이에요.</div>";
    }
    h += "</div>";
  });
  return h + "</div>";
}
function heatHtml(ft) {
  var n = new Date(), todayS2 = dateStr(n), idx = (n.getDay() + 6) % 7, WEEKS = 20;
  var d0 = n.getDate() - idx - 7 * (WEEKS - 1), cells = "";
  for (var w = 0; w < WEEKS; w++) {
    for (var r = 0; r < 7; r++) {
      var ds = dateStr(new Date(n.getFullYear(), n.getMonth(), d0 + w * 7 + r)), label = fmtDate(ds), i = dayInfo(ds, ft);
      if (ds > todayS2 || ds < data.startDate || (i.req === 0 && !i.restDay)) {
        cells += "<button class='hc' data-info='" + esc(label) + " : 해당 없음' aria-label='" + esc(label) + " 해당 없음'></button>";
      } else {
        var pc = i.restDay ? 100 : percent(i.done, i.req);
        var txt = i.restDay ? "쉬는 날 PERFECT DAY" : pc + "% (" + i.done + "/" + i.req + ")" + (pc === 100 ? " PERFECT DAY" : "");
        cells += "<button class='hc " + heatClass(pc) + "' data-info='" + esc(label) + " : " + txt + "' aria-label='" + esc(label) + " " + txt + "'></button>";
      }
    }
  }
  var labels = ["월", "화", "수", "목", "금", "토", "일"].map(function (x) { return "<div>" + x + "</div>"; }).join("");
  return "<div class='chart'><div class='chart-title'>활동 잔디 (최근 20주)</div><div class='heat-wrap'><div class='heat-days'>" + labels +
    "</div><div class='heat-scroll' id='heatScroll'><div class='heat-grid'>" + cells + "</div></div></div>" +
    "<div class='legend'>낮음 <i class='l0'></i><i class='l1'></i><i class='l2'></i><i class='l3'></i><i class='l4'></i> 높음 &nbsp; <i></i> 없음</div>" +
    "<div class='note' id='heatInfo'>칸을 누르면 날짜별 달성률이 나와요</div></div>";
}
function weakHtml(ft, all) {
  var h = "<div class='chart'><div class='chart-title'>약점 분석</div>", list = [];
  ft.forEach(function (t) {
    var ti = taskInfo(t, all);
    if (ti.req > 0) list.push({ name: t.name + (isArchived(t) ? " (보관)" : ""), req: ti.req, done: ti.done, pc: percent(ti.done, ti.req) });
  });
  if (!list.length) return h + "<div class='note'>기록이 쌓이면 약점을 찾아줄게요.</div></div>";
  list.sort(function (a, b) { return (a.pc - b.pc) || ((b.req - b.done) - (a.req - a.done)); });
  var w = list[0];
  h += w.pc === 100
    ? "<div class='warn'><div class='wl'>가장 약한 할 일</div><div class='wv'>약점 없음</div><div class='ws'>모든 할 일이 100%예요</div></div>"
    : "<div class='warn'><div class='wl'>가장 자주 빼먹는 할 일</div><div class='wv'>" + esc(w.name) + "</div><div class='ws'>달성률 " + w.pc + "% / 빼먹은 횟수 " + (w.req - w.done) + "번</div></div>";
  var rows = [1, 2, 3, 4, 5, 6, 0].map(function (d) {
    var s = sumInfo(all.filter(function (x) { return parseDate(x).getDay() === d; }), ft);
    return { d: d, req: s.req, pc: percent(s.done, s.req), done: s.done };
  });
  var cands = rows.filter(function (r) { return r.req > 0; });
  cands.sort(function (a, b) { return (a.pc - b.pc) || (b.req - a.req); });
  var wd = cands.length ? cands[0] : null;
  if (wd) {
    h += wd.pc === 100
      ? "<div class='warn'><div class='wl'>가장 약한 요일</div><div class='wv'>약점 없음</div><div class='ws'>모든 요일이 100%예요</div></div>"
      : "<div class='warn'><div class='wl'>가장 약한 요일</div><div class='wv'>" + DAYNAMES[wd.d] + "요일</div><div class='ws'>달성률 " + wd.pc + "% (" + wd.done + "/" + wd.req + ")</div></div>";
  }
  h += "<span class='label-s'>요일별 달성률 (전체 기간)</span>";
  rows.forEach(function (r) {
    var weak = wd && wd.pc < 100 && r.d === wd.d;
    h += "<div class='bar-row'><div class='bar-label'>" + DAYNAMES[r.d] + "요일" + (weak ? " !" : "") + "</div><div class='bar-track'><div class='bar-fill' style='width:" + (r.req > 0 ? r.pc : 0) + "%'></div></div><div class='bar-val'>" + (r.req > 0 ? r.pc + "%" : "-") + "</div></div>";
  });
  return h + "</div>";
}
function monthChartHtml(ft, all) {
  var months = {}, order = [];
  all.forEach(function (ds) { var k = ds.slice(0, 7); if (!months[k]) { months[k] = []; order.push(k); } months[k].push(ds); });
  var h = "<div class='chart'><div class='chart-title'>월별 달성률</div>";
  order.slice(-12).forEach(function (k) {
    var r = rateOf(sumInfo(months[k], ft));
    h += "<div class='bar-row'><div class='bar-label'>" + k.replace("-", ".") + "</div><div class='bar-track'><div class='bar-fill' style='width:" + (r === null ? 0 : r) + "%'></div></div><div class='bar-val'>" + (r === null ? "-" : r + "%") + "</div></div>";
  });
  return h + "</div>";
}
function renderStatsTab() {
  var el = document.getElementById("scr-stats"), y = window.scrollY || 0, ft = filteredTasks(), all = allDates();
  schedCache = null;
  var cr = curRange(), h = "<h2>통계</h2>" + filterHtml();
  if (!cr) {
    h += "<div class='chart'><div class='note'>기간을 올바르게 정해 주세요. (시작일 ≤ 끝일 ≤ 오늘)</div></div>";
  } else if (!data.tasks.length) {
    h += "<div class='chart'><div class='note'>아직 할 일이 없어요. 기록 탭에서 할 일을 추가해 보세요.</div></div>";
  } else {
    h += compareHtml(cr, ft) + unitChartHtml(cr, ft) + weekdayHtml(cr, ft) + taskCompareHtml(cr, ft) + goalHtml(ft);
  }
  h += heatHtml(ft) + weakHtml(ft, all) + monthChartHtml(ft, all);
  el.innerHTML = h;
  var sc = document.getElementById("heatScroll");
  if (sc) sc.scrollLeft = sc.scrollWidth;
  window.scrollTo(0, y);
}
function onStatsClick(e) {
  var b = e.target.closest("button");
  if (!b) return;
  var f = b.getAttribute("data-f");
  if (b.classList.contains("hc")) { document.getElementById("heatInfo").textContent = b.getAttribute("data-info"); return; }
  if (f === "all") fstate.sel = null;
  else if (f === "task") {
    var id = Number(b.getAttribute("data-id"));
    if (!fstate.sel) fstate.sel = [id];
    else {
      var i = fstate.sel.indexOf(id);
      if (i >= 0) fstate.sel.splice(i, 1); else fstate.sel.push(id);
      if (!fstate.sel.length) fstate.sel = null;
    }
  } else if (f === "arch") {
    fstate.archived = !fstate.archived;
    if (!fstate.archived && fstate.sel) {
      fstate.sel = fstate.sel.filter(function (id) { var t = taskById(id); return t && !isArchived(t); });
      if (!fstate.sel.length) fstate.sel = null;
    }
  } else if (b.hasAttribute("data-fp")) {
    var v = b.getAttribute("data-fp");
    fstate.period = v === "custom" ? "custom" : Number(v);
    if (v === "custom" && !fstate.from) { fstate.to = todayS(); fstate.from = addDays(fstate.to, -6); }
  } else if (b.hasAttribute("data-fu")) {
    fstate.unit = b.getAttribute("data-fu");
  } else return;
  renderStatsTab();
}
function onStatsChange(e) {
  var k = e.target.getAttribute && e.target.getAttribute("data-fi");
  if (!k) return;
  fstate[k] = e.target.value;
  renderStatsTab();
}

// ---------- 주간 리뷰 (저장된 기록만으로 계산, 월요일~일요일) ----------
function buildReview(ws) {
  var we = addDays(ws, 6), today = todayS(), end = we < today ? we : today;
  var dates = rangeList(ws, end).filter(function (d) { return d >= data.startDate; });
  var pws = addDays(ws, -7);
  var pdates = rangeList(pws, addDays(pws, 6)).filter(function (d) { return d >= data.startDate && d <= today; });
  var cur = sumInfo(dates), prev = sumInfo(pdates);
  var inProg = we >= today, sec = [], sug = [];
  var cRate = rateOf(cur), pRate = rateOf(prev);

  // 요약
  var s1 = [];
  if (cur.req === 0) s1.push("이 주에는 해야 할 일 기록이 없어서 데이터가 부족해.");
  else {
    s1.push("전체 달성률은 " + cRate + "% (" + cur.done + "/" + cur.req + ")이야." + (inProg ? " 이번 주는 아직 진행 중이라 기록된 " + cur.withData + "일 기준이야." : ""));
    if (pRate === null) s1.push("지난주는 기록이 없어서 비교할 수 없어.");
    else {
      var df = cRate - pRate;
      s1.push(df > 0 ? "지난주(" + pRate + "%)보다 " + df + "%p 높아졌어." : (df < 0 ? "지난주(" + pRate + "%)보다 " + (-df) + "%p 낮아졌어." : "지난주(" + pRate + "%)와 달성률이 같아."));
    }
  }
  var st = streakInfo(allDates().filter(function (d) { return d <= end; }));
  s1.push("PERFECT DAY는 " + cur.perfect + "번이고, 연속 기록은 " + (inProg ? "현재 " : "이 주가 끝난 시점에 ") + st.cur + "일(최고 " + st.best + "일)이야.");
  sec.push({ title: "요약", items: s1 });

  // 할 일별
  var tl = [];
  data.tasks.forEach(function (t) {
    var i = taskInfo(t, dates), p = taskInfo(t, pdates);
    if (i.req > 0) tl.push({ name: t.name, req: i.req, done: i.done, rate: percent(i.done, i.req), prate: p.req ? percent(p.done, p.req) : null });
  });
  var s2 = [];
  if (!tl.length) s2.push("이 주에 매일/요일/순환으로 기록된 할 일이 없어서 데이터가 부족해.");
  else if (tl.length === 1) s2.push("기록된 할 일은 " + tl[0].name + " 하나이고 달성률은 " + tl[0].rate + "%야.");
  else {
    var srt = tl.slice().sort(function (a, b) { return (b.rate - a.rate) || (b.done - a.done); });
    var best = srt[0], worst = srt.slice().sort(function (a, b) { return (a.rate - b.rate) || ((b.req - b.done) - (a.req - a.done)); })[0];
    if (best.rate === worst.rate) s2.push("모든 할 일의 달성률이 " + best.rate + "%로 같아.");
    else {
      s2.push("가장 잘 지킨 할 일은 " + best.name + " (" + best.rate + "%, " + best.done + "/" + best.req + ")이야.");
      s2.push("가장 자주 놓친 할 일은 " + worst.name + " (" + worst.rate + "%, " + (worst.req - worst.done) + "번 놓침)이야.");
    }
    var drop = null, rise = null;
    tl.forEach(function (x) {
      if (x.prate === null) return;
      var d = x.rate - x.prate;
      if (d <= -10 && (!drop || d < drop.d)) drop = { n: x.name, d: d };
      if (d >= 10 && (!rise || d > rise.d)) rise = { n: x.name, d: d };
    });
    if (rise) s2.push(rise.n + "은(는) 지난주보다 " + rise.d + "%p 올랐어.");
    if (drop) s2.push(drop.n + "은(는) 지난주보다 " + (-drop.d) + "%p 줄었어.");
    if (worst.rate < 70 && best.rate !== worst.rate) sug.push(worst.name + " 달성률이 " + worst.rate + "%로 가장 낮았어. 다음 주에는 하는 시간이나 요일을 정해 두고 해 보자.");
  }
  sec.push({ title: "할 일별", items: s2 });

  // 날짜(요일)별
  var dl = [];
  dates.forEach(function (d) {
    var i = dayInfo(d);
    if (i.req > 0) dl.push({ d: d, rate: percent(i.done, i.req), miss: i.req - i.done });
  });
  var s3 = [];
  if (!dl.length) s3.push("요일별로 비교할 기록이 없어서 데이터가 부족해.");
  else {
    var hi = dl[0], lo = dl[0], mm = dl[0];
    dl.forEach(function (x) {
      if (x.rate > hi.rate) hi = x;
      if (x.rate < lo.rate || (x.rate === lo.rate && x.miss > lo.miss)) lo = x;
      if (x.miss > mm.miss) mm = x;
    });
    if (hi.rate === lo.rate) s3.push("기록된 날의 달성률이 모두 " + hi.rate + "%로 같아.");
    else s3.push("달성률이 가장 높은 날은 " + dayName(hi.d) + " (" + hi.rate + "%), 가장 낮은 날은 " + dayName(lo.d) + " (" + lo.rate + "%)야.");
    if (mm.miss > 0) {
      s3.push("이번 주에는 " + dayName(mm.d) + "에 완료하지 못한 할 일이 가장 많았어 (" + mm.miss + "개).");
      if (mm.miss >= 2 && lo.rate < 70) sug.push(dayName(mm.d) + "에 놓친 게 많았어. 그날은 할 일을 하루 전에 미리 정리해 두자.");
    } else s3.push("놓친 할 일이 하나도 없었어.");
  }
  sec.push({ title: "날짜별", items: s3 });

  // 목표
  var s4 = [];
  data.tasks.forEach(function (t) {
    goalPeriods(t, today).forEach(function (p) {
      if (p.type === "weekly" && p.from === ws) {
        s4.push(t.name + " : 주 " + p.target + "회 목표 중 " + p.done + "회 " + (p.achieved ? "(달성)" : "(" + (p.target - p.done) + "회 부족" + (p.finished ? "" : ", 아직 진행 중") + ")"));
        if (!p.achieved && p.finished) sug.push(t.name + " 주 " + p.target + "회 목표를 못 채웠어. 목표 횟수를 줄이거나 하는 날을 먼저 정해 보자.");
      }
      if (p.type === "monthly" && p.from === monthStart(end)) {
        s4.push(t.name + " : " + Number(p.from.slice(5, 7)) + "월 목표 " + p.target + "회 중 " + p.done + "회까지 (" + (p.achieved ? "달성" : "남은 " + (p.target - p.done) + "회") + ")");
      }
    });
  });
  if (s4.length) sec.push({ title: "목표", items: s4 });

  // 다음 주 제안
  if (cur.req === 0) sug.push("먼저 할 일을 추가하고 며칠 기록해 보자.");
  if (cRate !== null && pRate !== null && cRate - pRate <= -10) sug.push("달성률이 많이 내려갔어. 지난주와 무엇이 달랐는지 먼저 떠올려 보자.");
  var chain = 0;
  data.tasks.forEach(function (t) {
    var run = 0, mx = 0;
    dates.forEach(function (d) {
      if (cellState(t, d).s !== "work") return;
      if (isDone(t.id, d)) run = 0; else { run += 1; if (run > mx) mx = run; }
    });
    if (mx > chain) { chain = mx; }
    if (mx >= 2 && sug.length < 3) sug.push(t.name + "을(를) " + mx + "일 연속 놓친 구간이 있었어. 한 번 놓쳐도 바로 다음 날 다시 하는 게 중요해.");
  });
  if (cRate !== null && cRate >= 90 && !inProg) sug.push("거의 다 지켰어. 이대로 유지하거나 목표를 조금 올려 봐도 좋아.");
  if (!sug.length) sug.push(cur.req === 0 ? "기록이 쌓이면 더 구체적인 제안을 해 줄게." : "특별히 걸리는 점이 없어. 지금 방식을 유지하자.");
  sec.push({ title: "다음 주에 해볼 것", items: sug.slice(0, 3) });
  return { ws: ws, we: we, inProg: inProg, sections: sec };
}
function reviewText(R) {
  var t = "주간 리뷰 (" + fmtDate(R.ws) + " ~ " + fmtDate(R.we) + ")" + (R.inProg ? " - 진행 중" : "") + "\n";
  R.sections.forEach(function (s) {
    t += "\n[" + s.title + "]\n";
    s.items.forEach(function (i) { t += "- " + i + "\n"; });
  });
  return t;
}
function renderReviewTab() {
  var el = document.getElementById("scr-review");
  schedCache = null;
  var R = buildReview(revWeek);
  var minWs = weekStart(data.startDate), curWs = weekStart(todayS());
  var h = "<h2>주간 리뷰</h2><div class='rev-nav'><button data-rv='prev' aria-label='지난 주'" + (revWeek <= minWs ? " disabled" : "") + ">&lt;</button><div>" +
    esc(fmtDate(R.ws)) + " ~ " + esc(fmtDate(R.we)) + "<br><small>" + (R.inProg ? "이번 주 (진행 중)" : "지난 리뷰") + "</small></div><button data-rv='next' aria-label='다음 주'" + (revWeek >= curWs ? " disabled" : "") + ">&gt;</button></div>";
  R.sections.forEach(function (s) {
    h += "<div class='rev-sec'><h3>" + esc(s.title) + "</h3>";
    s.items.forEach(function (i) { h += "<p>" + esc(i) + "</p>"; });
    h += "</div>";
  });
  h += "<div class='row'><button class='btn light' data-rv='copy'>텍스트 복사</button><button class='btn light' data-rv='save'>파일로 저장</button></div>";
  if (revWeek !== curWs) h += "<button class='btn small light' data-rv='now'>이번 주로 돌아가기</button>";
  h += "<div class='note'>월요일부터 일요일까지가 한 주예요. 스킵한 날과 보관한 할 일은 기존 통계와 같은 기준으로 계산해요.</div>";
  el.innerHTML = h;
}
function onReviewClick(e) {
  var b = e.target.closest("button");
  if (!b) return;
  var a = b.getAttribute("data-rv");
  if (a === "prev") revWeek = addDays(revWeek, -7);
  else if (a === "next") revWeek = addDays(revWeek, 7);
  else if (a === "now") revWeek = weekStart(todayS());
  else if (a === "copy") { copyText(reviewText(buildReview(revWeek)), "리뷰를 복사했어요"); return; }
  else if (a === "save") { downloadText("weekly-review-" + revWeek + ".txt", reviewText(buildReview(revWeek))); toast("파일로 저장했어요"); return; }
  renderReviewTab();
}

// ---------- 내역 화면 ----------
function fmtTime(ms) {
  var d = new Date(ms);
  return fmtDate(dateStr(d)) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function renderHistTab() {
  var el = document.getElementById("scr-hist"), h = "<h2>변경 내역</h2>";
  h += "<div class='note'>기록 체크, 메모, 스킵, 할 일 추가·수정·삭제·보관·순서 변경이 여기에 남아요. 최근 " + HIST_MAX + "개까지만 보관해요. 되돌리기는 지금 데이터와 충돌하지 않을 때만 돼요.</div>";
  var list = data.history.slice().reverse();
  if (!list.length) h += "<div class='empty'>아직 변경 내역이 없어요.</div>";
  list.forEach(function (x) {
    h += "<div class='hist-item" + (x.undone ? " undone" : "") + "'><div class='hist-top'><span class='hist-tag'>" + esc(x.type) + "</span><span>" + esc(fmtTime(x.t)) + "</span></div><div class='hist-label'>" + esc(x.label) + "</div>";
    if (x.undone) h += "<div class='note'>되돌림 완료" + (x.undoneAt ? " (" + esc(fmtTime(x.undoneAt)) + ")" : "") + "</div>";
    else if (x.undo) h += "<button class='btn small light' data-hid='" + x.id + "'>되돌리기</button>";
    else h += "<div class='note'>되돌릴 수 없는 작업이에요</div>";
    h += "</div>";
  });
  el.innerHTML = h;
}
function onHistClick(e) {
  var b = e.target.closest("button");
  if (!b || !b.hasAttribute("data-hid")) return;
  var id = Number(b.getAttribute("data-hid"));
  var h = data.history.find(function (x) { return x.id === id; });
  if (!h) return;
  var r = undoEntry(h);
  if (r) { toast(r); alert(r); return; }
  toast("되돌렸어요");
  renderHistTab();
}

// ---------- 설정 화면 ----------
function recCount(d) {
  var n = 0;
  Object.keys(d.records).forEach(function (k) { n += Object.keys(d.records[k]).length; });
  return n;
}
function hashPin(s) {
  var h = 7;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000000007;
  return "p" + h;
}
function swapIn(nd, label) {
  data = nd;
  logH("복원", label, null);
  save();
  var n = new Date();
  viewYear = n.getFullYear();
  viewMonth = n.getMonth();
  fstate.sel = null;
  render(false);
}
function restoreFrom(text) {
  var parsed;
  try { parsed = JSON.parse(text); } catch (e) {
    alert("백업 내용이 올바르지 않아요. (글자가 중간에 잘렸거나 다른 글이 섞였을 수 있어요) 지금 기록은 그대로예요.");
    return;
  }
  var nd = normalize(parsed);
  if (!nd) { alert("이 파일은 백업 형식이 아니에요. 지금 기록은 그대로예요."); return; }
  var dropped = Array.isArray(parsed.tasks) ? parsed.tasks.length - nd.tasks.length : 0;
  var msg = "백업 내용\n- 할 일 " + nd.tasks.length + "개\n- 체크 기록 " + recCount(nd) + "건\n- 시작일 " + nd.startDate + "\n" +
            (dropped > 0 ? "- 읽을 수 없는 할 일 " + dropped + "개는 빠져요\n" : "") +
            "\n지금 기록이 이 백업으로 바뀌어요. (바뀌기 전 기록은 따로 한 번 보관해요) 계속할까요?";
  if (!confirm(msg)) return;
  try { localStorage.setItem(KEY + "-prev", JSON.stringify(data)); } catch (e) {
    if (!confirm("안전 사본을 만들지 못했어요. 그래도 복원할까요?")) return;
  }
  swapIn(nd, "백업 복원 (할 일 " + nd.tasks.length + "개, 체크 " + recCount(nd) + "건)");
  toast("복원이 끝났어요");
}
function restorePrev() {
  var raw = null, parsed = null;
  try { raw = localStorage.getItem(KEY + "-prev"); parsed = JSON.parse(raw); } catch (e) {}
  var nd = normalize(parsed);
  if (!nd) { alert("되돌릴 이전 기록이 없어요."); return; }
  if (!confirm("복원 직전 기록(할 일 " + nd.tasks.length + "개, 체크 " + recCount(nd) + "건)으로 되돌릴까요?\n지금 기록은 다시 따로 보관해요.")) return;
  try { localStorage.setItem(KEY + "-prev", JSON.stringify(data)); } catch (e) {}
  swapIn(nd, "복원 직전 기록으로 되돌림");
  toast("되돌렸어요");
}
function renderSetTab() {
  var el = document.getElementById("scr-set"), allD = allDates(), h = "<h2>설정</h2>";
  var cardChips = CARD_KEYS.map(function (k) {
    return "<button class='chip" + (prefs.cards[k] ? " on" : "") + "' data-card='" + k + "'>" + CARD_NAMES[k] + "</button>";
  }).join("");
  h += "<div class='sec'>화면</div>" +
    "<span class='label-s'>테마</span>" + seg("ps", [["theme|light", "밝게"], ["theme|dark", "어둡게"]], "theme|" + prefs.theme) +
    "<span class='label-s'>글자 크기</span>" + seg("ps", [["font|small", "작게"], ["font|normal", "보통"], ["font|large", "크게"], ["font|xlarge", "아주 크게"]], "font|" + prefs.font) +
    "<span class='label-s'>날짜 표시</span>" + seg("ps", [["dateFmt|md", "10/4"], ["dateFmt|kor", "10월 4일"], ["dateFmt|iso", "2026-10-04"]], "dateFmt|" + prefs.dateFmt) +
    "<span class='label-s'>시작 화면</span>" + seg("ps", [["startTab|home", "기록"], ["startTab|stats", "통계"], ["startTab|review", "리뷰"], ["startTab|hist", "내역"]], "startTab|" + prefs.startTab) +
    "<span class='label-s'>기본 통계 기간</span>" + seg("ps", [["statsPeriod|7", "7일"], ["statsPeriod|30", "30일"], ["statsPeriod|90", "90일"]], "statsPeriod|" + prefs.statsPeriod) +
    "<span class='label-s'>기록 보기 방식</span>" + seg("ps", [["view|table", "표"], ["view|cards", "날짜별 카드"]], "view|" + prefs.view) +
    "<span class='label-s'>완료한 할 일</span>" + seg("ps", [["hideDone|0", "표시"], ["hideDone|1", "숨김"]], "hideDone|" + (prefs.hideDone ? 1 : 0)) +
    "<span class='label-s'>기록 화면 통계 카드 (눌러서 켜고 끄기)</span><div class='chips'>" + cardChips + "</div>" +
    "<div class='note'>화면 설정은 이 기기에만 저장돼요. 숨겨도 기록과 통계 데이터는 그대로 남아요.</div>";

  h += "<div class='sec'>정직 모드</div><div class='note'>켜면 오늘과 어제 칸만 바꿀 수 있어요. 며칠 뒤에 몰아서 O로 바꾸는 걸 막아줘요.</div>" +
    "<button class='btn' id='honestBtn'>정직 모드 : " + (data.honest ? "켜짐 (누르면 끔)" : "꺼짐 (누르면 켬)") + "</button>";

  var arc = "";
  data.tasks.filter(isArchived).forEach(function (t) {
    var ti = taskInfo(t, allD);
    arc += "<div class='arc'><div class='name-text'>" + esc(t.name) + "</div><div class='note'>보관 전 달성률 " + percent(ti.done, ti.req) + "% (" + ti.done + "/" + ti.req + ")</div>" +
      "<div class='row'><button class='btn light' data-arc='restore' data-id='" + t.id + "'>되살리기</button><button class='btn light' data-arc='del' data-id='" + t.id + "'>영구 삭제</button></div></div>";
  });
  h += "<div class='sec'>보관함</div><div class='note'>보관한 일은 표에서 숨겨지고, 보관한 날부터 달성률에 안 들어가요. 지난 기록은 그대로 남아요.</div><div id='arcList'>" + (arc || "<div class='note'>보관한 할 일이 없어요.</div>") + "</div>";

  var hasPrev = false;
  try { hasPrev = !!localStorage.getItem(KEY + "-prev"); } catch (e) {}
  h += "<div class='sec'>기록 백업 / 복원</div><div class='note'>백업을 해두면 폰을 바꾸거나 앱을 지워도 기록을 살릴 수 있어요. 가끔 백업해서 메모장이나 카톡 나에게 보내기에 보관해 두세요. 기록은 이 기기에만 저장되고 다른 기기와 자동으로 합쳐지지 않아요.</div>" +
    "<label class='sr' for='bk'>백업 글</label><textarea id='bk' placeholder='여기에 백업 글이 나오거나, 복원할 글을 붙여넣어요'></textarea>" +
    "<button class='btn' id='bkCopy'>백업 복사하기</button><button class='btn' id='bkFile'>백업 파일로 저장</button>" +
    "<button class='btn light' id='bkRestoreText'>위 칸에 붙여넣은 글로 복원</button><button class='btn light' id='bkRestoreFile'>백업 파일에서 복원</button>" +
    "<input type='file' id='bkInput' accept='.json,application/json' hidden>" +
    (hasPrev ? "<button class='btn light' id='bkPrev'>복원 직전 기록으로 되돌리기</button>" : "");

  h += "<div class='sec'>잠금</div><div class='note'>가볍게 남이 못 열게 하는 잠금이에요. 숫자 4자리를 써요.</div>" +
    "<button class='btn' id='pinSet'>" + (data.pin ? "비밀번호 변경" : "비밀번호 설정") + "</button>" +
    (data.pin ? "<button class='btn light' id='pinOff'>비밀번호 끄기</button>" : "");

  var kb = 0;
  try { kb = Math.round(JSON.stringify(data).length / 1024); } catch (e) {}
  h += "<div class='sec'>앱 정보</div><div class='note'>버전 " + APP_VERSION + " / 할 일 " + data.tasks.length + "개 / 체크 기록 " + recCount(data) + "건 / 변경 내역 " + data.history.length + "개 / 저장 크기 약 " + kb + "KB</div>";
  el.innerHTML = h;

  document.getElementById("honestBtn").addEventListener("click", function () {
    if (data.honest) { if (!confirm("정말 끌까요?\n상남자는 정직해야 해요.")) return; data.honest = false; }
    else data.honest = true;
    save();
    toast("정직 모드를 " + (data.honest ? "켰어요" : "껐어요"));
    renderSetTab();
  });
  document.getElementById("arcList").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    var id = Number(b.getAttribute("data-id")), t = taskById(id);
    if (!t) return;
    if (b.getAttribute("data-arc") === "restore") { restoreTask(t); toast("되살렸어요"); renderSetTab(); }
    else if (b.getAttribute("data-arc") === "del") { if (deleteTask(id)) { toast("삭제했어요 (내역에서 되돌릴 수 있어요)"); renderSetTab(); } }
  });
  var ta = document.getElementById("bk");
  document.getElementById("bkCopy").addEventListener("click", function () {
    ta.value = JSON.stringify(data);
    ta.focus(); ta.select();
    copyText(ta.value, "백업을 복사했어요! 메모장에 붙여넣어 보관하세요");
  });
  document.getElementById("bkFile").addEventListener("click", function () {
    downloadText("todo-backup-" + todayS() + ".json", JSON.stringify(data));
    toast("백업 파일로 저장했어요");
  });
  document.getElementById("bkRestoreText").addEventListener("click", function () {
    if (!ta.value.trim()) { alert("위 칸에 백업 글을 붙여넣어 주세요."); return; }
    restoreFrom(ta.value);
  });
  var fi = document.getElementById("bkInput");
  document.getElementById("bkRestoreFile").addEventListener("click", function () { fi.click(); });
  fi.addEventListener("change", function () {
    var f = fi.files && fi.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () { restoreFrom(String(r.result)); };
    r.onerror = function () { alert("파일을 읽지 못했어요."); };
    r.readAsText(f);
  });
  var bp = document.getElementById("bkPrev");
  if (bp) bp.addEventListener("click", restorePrev);
  document.getElementById("pinSet").addEventListener("click", function () {
    if (data.pin) {
      var cur = prompt("지금 비밀번호를 입력하세요");
      if (cur === null) return;
      if (hashPin(cur) !== data.pin) { alert("비밀번호가 틀렸어요."); return; }
    }
    var p = prompt("새 비밀번호 (숫자 4자리)");
    if (p === null) return;
    if (!/^\d{4}$/.test(p)) { alert("숫자 4자리로 입력해 주세요."); return; }
    data.pin = hashPin(p);
    save();
    toast("비밀번호를 저장했어요. 잊어버리지 마세요!");
    renderSetTab();
  });
  var po = document.getElementById("pinOff");
  if (po) po.addEventListener("click", function () {
    var cur = prompt("지금 비밀번호를 입력하세요");
    if (cur === null) return;
    if (hashPin(cur) !== data.pin) { alert("비밀번호가 틀렸어요."); return; }
    data.pin = null;
    save();
    toast("잠금을 껐어요");
    renderSetTab();
  });
}
function onSetClick(e) {
  var b = e.target.closest("button");
  if (!b) return;
  if (b.hasAttribute("data-card")) {
    var k = b.getAttribute("data-card");
    prefs.cards[k] = !prefs.cards[k];
  } else if (b.hasAttribute("data-ps")) {
    var kv = b.getAttribute("data-ps").split("|"), key = kv[0], v = kv[1];
    if (key === "statsPeriod") { prefs.statsPeriod = Number(v); fstate.period = Number(v); }
    else if (key === "hideDone") prefs.hideDone = v === "1";
    else prefs[key] = v;
  } else return;
  savePrefs();
  applyPrefs();
  toast("설정을 저장했어요");
  renderSetTab();
}

// ---------- 할 일 수정 / 스킵 창 ----------
function openEdit(id) {
  var t = taskById(id);
  if (!t) return;
  var today = todayS(), cyc = isCycle(t);
  var mode = cyc ? "cycle" : "days", sel = taskDays(t).slice(), rest = cyc ? cycleRest(t) : 1;
  var namesVal = cyc ? t.cycle.names.join(", ") : "A, B, C";
  var ig = goalOn(t, today);
  var g0 = ig ? { type: ig.type, count: ig.count, from: ig.from, to: ig.to || "" } : { type: "daily", count: 3, from: today, to: "" };
  var gType = g0.type, pinned = !!t.pinned;
  var dayHtml = "", restHtml = "";
  for (var i = 0; i < 7; i++) dayHtml += "<button data-d='" + i + "' class='" + (sel.indexOf(i) !== -1 ? "on" : "") + "'>" + DAYNAMES[i] + "</button>";
  for (var r = 1; r <= 3; r++) restHtml += "<button data-r='" + r + "' class='" + (r === rest ? "on" : "") + "'>" + r + "일</button>";

  openPanel(
    "<h2>할 일 수정</h2>" +
    "<label class='label-s' for='editName'>이름</label><input type='text' id='editName' value=\"" + esc(t.name) + "\">" +
    "<span class='label-s'>방식</span><div class='seg' id='modeBtns'><button data-m='days'>매일 / 요일 지정</button><button data-m='cycle'>순환 (A→B→C→쉼)</button></div>" +
    "<div id='daysBox'><span class='label-s'>해야 하는 요일 (눌러서 켜고 끄기)</span><div class='seg' id='dayBtns'>" + dayHtml + "</div></div>" +
    "<div id='cycleBox'><label class='label-s' for='cycNames'>순환 이름 (쉼표로 구분, 2~6개)</label><input type='text' id='cycNames' value=\"" + esc(namesVal) + "\">" +
      "<div class='note'>예: A, B, C 또는 가슴, 등, 하체. 못 한 날은 같은 차례가 다음 날로 넘어가요.</div>" +
      "<span class='label-s'>순환이 끝난 뒤 쉬는 날</span><div class='seg' id='restBtns'>" + restHtml + "</div></div>" +
    "<div id='goalBox'><span class='label-s'>목표</span>" + seg("gt", [["daily", "매일 완료"], ["weekly", "주간 횟수"], ["monthly", "월간 횟수"]], gType) +
      "<div id='goalFields'><label class='label-s' for='gCount' id='gCountL'>목표 횟수</label><input type='number' id='gCount' min='1' max='31' value='" + g0.count + "'>" +
      "<label class='label-s' for='gTo'>목표 종료일 (비우면 계속)</label><input type='date' id='gTo' value='" + esc(g0.to) + "'></div>" +
      "<label class='label-s' for='gFrom'>적용 시작일</label><input type='date' id='gFrom' value='" + esc(g0.from) + "'>" +
      "<div class='note'>목표를 바꿔도 지난 기록은 그대로예요. 이미 있는 목표를 바꾸면 시작일은 오늘부터로 맞춰져요. 시작일이 포함된 주(또는 달) 전체부터 새 목표로 계산하고, 종료일 다음 날부터는 다시 매일 하는 일이 돼요. 목표 방식의 날은 매일 달성률과 PERFECT DAY 계산에 넣지 않아요.</div></div>" +
    "<span class='label-s'>상단 고정</span><button class='btn light small' id='pinBtn'></button>" +
    "<div class='note'>방식을 바꾸면 지난 날짜의 계산도 새 방식으로 다시 계산돼요. O/X 기록은 그대로 남아요.</div>" +
    "<button class='btn' id='editSave'>저장</button><button class='btn light' id='editCancel'>취소</button>" +
    "<div class='sec'>삭제</div><div class='note'>기록을 남기고 싶으면 삭제 말고 표의 '보관'을 쓰세요. 삭제해도 내역 탭에서 되돌릴 수 있어요.</div>" +
    "<button class='btn light' id='editDel'>이 할 일 삭제</button>"
  );
  function sync() {
    document.getElementById("daysBox").hidden = mode !== "days";
    document.getElementById("cycleBox").hidden = mode !== "cycle";
    document.getElementById("goalBox").hidden = mode !== "days";
    document.getElementById("goalFields").hidden = gType === "daily";
    document.getElementById("gCount").max = gType === "weekly" ? 7 : 31;
    document.getElementById("gCountL").textContent = gType === "weekly" ? "주간 목표 횟수 (1~7)" : "월간 목표 횟수 (1~31)";
    var mb = document.querySelectorAll("#modeBtns button");
    for (var k = 0; k < mb.length; k++) mb[k].className = mb[k].getAttribute("data-m") === mode ? "on" : "";
    var gb = document.querySelectorAll("#goalBox [data-gt]");
    for (var q = 0; q < gb.length; q++) gb[q].className = gb[q].getAttribute("data-gt") === gType ? "on" : "";
    document.getElementById("pinBtn").textContent = "상단 고정 : " + (pinned ? "켜짐" : "꺼짐");
  }
  sync();
  document.getElementById("modeBtns").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { mode = b.getAttribute("data-m"); sync(); } });
  document.getElementById("goalBox").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-gt]");
    if (!b) return;
    gType = b.getAttribute("data-gt");
    var gfEl = document.getElementById("gFrom");
    if (ig && gfEl.value === ig.from) gfEl.value = today;
    sync();
  });
  document.getElementById("pinBtn").addEventListener("click", function () { pinned = !pinned; sync(); });
  document.getElementById("dayBtns").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    var d = Number(b.getAttribute("data-d")), p = sel.indexOf(d);
    if (p === -1) { sel.push(d); b.className = "on"; } else { sel.splice(p, 1); b.className = ""; }
  });
  document.getElementById("restBtns").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    rest = Number(b.getAttribute("data-r"));
    var all = document.querySelectorAll("#restBtns button");
    for (var k = 0; k < all.length; k++) all[k].className = Number(all[k].getAttribute("data-r")) === rest ? "on" : "";
  });
  document.getElementById("editCancel").addEventListener("click", closePanel);
  document.getElementById("editSave").addEventListener("click", function () {
    var name = document.getElementById("editName").value.trim();
    if (!name) { alert("이름을 입력해 주세요."); return; }
    var newDays = null, newCycle = null, goalChange = null;
    if (mode === "days") {
      if (!sel.length) { alert("요일을 하나 이상 선택해 주세요."); return; }
      newDays = sel.slice().sort(function (a, b) { return a - b; });
      var gc = Number(document.getElementById("gCount").value), gf = document.getElementById("gFrom").value, gt = document.getElementById("gTo").value;
      if (!isDateStr(gf)) gf = today;
      if (gf < t.created) gf = t.created;
      var same0 = gType === "daily" ? g0.type === "daily"
        : (g0.type === gType && g0.count === gc && g0.from === gf && g0.to === gt);
      if (!same0) {
        if (ig && gf <= ig.from) gf = today;
        if (gType !== "daily") {
          var max = gType === "weekly" ? 7 : 31;
          if (!(gc >= 1 && gc <= max) || gc % 1 !== 0) { alert("목표 횟수는 1~" + max + " 사이 정수로 입력해 주세요."); return; }
          if (gt && (!isDateStr(gt) || gt < gf)) { alert("종료일은 시작일 이후 날짜여야 해요."); return; }
        }
        goalChange = { type: gType, count: gc, from: gf, to: gt || null };
      }
    } else {
      var arr = document.getElementById("cycNames").value.split(/[,，\n]/).map(function (s) { return s.trim().slice(0, 8); }).filter(function (s) { return s; });
      if (arr.length < 2 || arr.length > 6) { alert("순환 이름은 2개~6개로 입력해 주세요. (예: A, B, C)"); return; }
      newCycle = { names: arr, rest: rest };
    }
    changeTask(t, function () {
      t.name = name;
      t.pinned = pinned;
      if (mode === "days") {
        t.mode = "days";
        t.days = newDays;
        if (goalChange) {
          var out = [];
          (t.goals || []).forEach(function (g) {
            if (g.from >= goalChange.from) return;
            var ng = clone(g);
            if (ng.to === null || ng.to >= goalChange.from) ng.to = addDays(goalChange.from, -1);
            out.push(ng);
          });
          if (goalChange.type !== "daily") out.push({ type: goalChange.type, count: goalChange.count, from: goalChange.from, to: goalChange.to });
          t.goals = out;
        }
      } else { t.mode = "cycle"; t.cycle = newCycle; }
    }, function (b, a) { return "할 일 수정 : " + (b.name !== a.name ? b.name + " → " + a.name : a.name); });
    closePanel();
    toast("저장했어요");
    render(true);
  });
  document.getElementById("editDel").addEventListener("click", function () {
    if (deleteTask(id)) { closePanel(); toast("삭제했어요 (내역에서 되돌릴 수 있어요)"); render(true); }
  });
}
function openSkip(id) {
  var t = taskById(id);
  if (!t) return;
  var back = data.honest ? 1 : 7, rows = "";
  for (var i = 0; i <= back; i++) {
    var ds = addDays(todayS(), -i), cs = cellState(t, ds), cnt = skipCount(id, ds.slice(0, 7)), info = "", btn = "";
    var label = fmtDate(ds, true) + (i === 0 ? " 오늘" : (i === 1 ? " 어제" : ""));
    if (cs.s === "before") info = "시작 전";
    else if (cs.s === "skip") { info = "스킵함"; btn = "<button class='btn light' data-sk='un' data-date='" + ds + "'>스킵 취소</button>"; }
    else if (cs.s === "work") {
      if (isDone(id, ds)) info = "O 완료 (스킵 불가)";
      else { info = "X (아직 안 함)"; btn = "<button class='btn' data-sk='do' data-date='" + ds + "'>이 날 스킵</button>"; }
    } else if (cs.s === "rest") info = "쉬는 날 (스킵 필요 없음)";
    else if (cs.s === "free") info = "목표 방식 (스킵 필요 없음)";
    else info = "보관 중";
    rows += "<div class='arc'><div class='name-text'>" + esc(label) + "</div><div class='note'>" + info + " / " + Number(ds.slice(5, 7)) + "월 스킵 " + cnt + "/" + SKIP_LIMIT + "</div>" + btn + "</div>";
  }
  openPanel("<h2>스킵 : " + esc(t.name) + "</h2><div class='note'>아프거나 사정이 있는 날만 쓰세요. 한 달에 " + SKIP_LIMIT +
    "번까지만 돼요. 스킵한 날은 달성률에서 빠지고 연속 기록도 안 끊겨요." + (data.honest ? " 정직 모드라서 오늘과 어제만 스킵할 수 있어요." : "") +
    "</div><div id='skList'>" + rows + "</div><button class='btn light' id='skClose' style='margin-top:1.1rem'>닫기</button>");
  document.getElementById("skList").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    var act = b.getAttribute("data-sk"), d = b.getAttribute("data-date");
    if (!canEdit(d)) { alert("정직 모드: 오늘과 어제만 바꿀 수 있어요."); return; }
    if (act === "do") {
      if (cellState(t, d).s !== "work" || isDone(id, d)) return;
      if (skipCount(id, d.slice(0, 7)) >= SKIP_LIMIT) { alert("그 달의 스킵을 다 썼어요. (" + SKIP_LIMIT + "번)"); return; }
      changeSkip(id, d, true);
    } else changeSkip(id, d, false);
    render(true);
    openSkip(id);
  });
  document.getElementById("skClose").addEventListener("click", closePanel);
}

// ---------- 잠금 / 화면 전환 / 이벤트 ----------
function showLock() {
  if (!data.pin) return;
  document.getElementById("lock").hidden = false;
  document.getElementById("lockInput").value = "";
  document.getElementById("lockMsg").textContent = "";
}
function render(keep) {
  if (curTab === "home") renderHome(keep);
  else if (curTab === "stats") renderStatsTab();
  else if (curTab === "review") renderReviewTab();
  else if (curTab === "hist") renderHistTab();
  else renderSetTab();
}
function showTab(name) {
  curTab = name;
  TABS.forEach(function (n) { document.getElementById("scr-" + n).hidden = n !== name; });
  var bs = document.querySelectorAll("#tabs button");
  for (var i = 0; i < bs.length; i++) bs[i].className = bs[i].getAttribute("data-tab") === name ? "on" : "";
  render(false);
  window.scrollTo(0, 0);
}
function addFromInput() {
  var input = document.getElementById("newTask"), name = input.value.trim();
  if (!name) return;
  addTask(name);
  input.value = "";
  toast("할 일을 추가했어요");
}
document.getElementById("addBtn").addEventListener("click", addFromInput);
document.getElementById("newTask").addEventListener("keydown", function (e) { if (e.key === "Enter") addFromInput(); });
document.getElementById("settingsBtn").addEventListener("click", function () { showTab("set"); });
document.getElementById("prevBtn").addEventListener("click", function () { changeMonth(-1); });
document.getElementById("nextBtn").addEventListener("click", function () { changeMonth(1); });
document.getElementById("viewBtn").addEventListener("click", function () {
  prefs.view = prefs.view === "cards" ? "table" : "cards";
  savePrefs(); toast("보기 방식을 바꿨어요"); renderHome(false);
});
document.getElementById("hideBtn").addEventListener("click", function () {
  prefs.hideDone = !prefs.hideDone;
  savePrefs(); toast(prefs.hideDone ? "완료한 할 일을 숨겨요" : "완료한 할 일을 보여줘요"); renderHome(true);
});
document.getElementById("tabs").addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (b) showTab(b.getAttribute("data-tab"));
});
document.getElementById("scr-stats").addEventListener("click", onStatsClick);
document.getElementById("scr-stats").addEventListener("change", onStatsChange);
document.getElementById("scr-review").addEventListener("click", onReviewClick);
document.getElementById("scr-hist").addEventListener("click", onHistClick);
document.getElementById("scr-set").addEventListener("click", onSetClick);
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && !document.getElementById("overlay").hidden) closePanel();
});

document.getElementById("tableWrap").addEventListener("click", function (e) {
  var btn = e.target.closest("button");
  if (!btn || btn.disabled) return;
  var act = btn.getAttribute("data-act"), id = Number(btn.getAttribute("data-id")), ds = btn.getAttribute("data-date");
  if (act === "locked") { alert("정직 모드: 오늘과 어제만 바꿀 수 있어요."); return; }
  if (act === "toggle") {
    if (!canEdit(ds)) { alert("정직 모드: 오늘과 어제만 바꿀 수 있어요."); return; }
    toggleRec(id, ds);
  } else if (act === "unskip") {
    if (!canEdit(ds)) { alert("정직 모드: 오늘과 어제만 바꿀 수 있어요."); return; }
    if (confirm("이 날의 스킵을 취소할까요?")) { changeSkip(id, ds, false); render(true); }
  } else if (act === "skip") openSkip(id);
  else if (act === "edit") openEdit(id);
  else if (act === "pin") { var tp = taskById(id); if (tp) togglePin(tp); }
  else if (act === "arc") {
    var ta = taskById(id);
    if (ta && confirm("'" + ta.name + "' 을(를) 보관할까요?\n오늘부터 달성률에 안 들어가요. 지난 기록은 그대로 남고, 설정의 보관함에서 되살릴 수 있어요.")) { archiveTask(ta); render(true); }
  } else if (act === "up") moveTask(id, -1);
  else if (act === "down") moveTask(id, 1);
  else if (act === "memo") {
    var cur = data.memos[ds] || "";
    var m = prompt(fmtDate(ds) + " 한 줄 메모 (지우려면 비워두기)", cur);
    if (m !== null) changeMemo(ds, m.trim());
  }
});

document.getElementById("lockInput").addEventListener("input", function () {
  var inp = document.getElementById("lockInput");
  if (inp.value.length < 4) return;
  if (hashPin(inp.value) === data.pin) {
    document.getElementById("lock").hidden = true;
    inp.value = "";
    document.getElementById("lockMsg").textContent = "";
  } else {
    document.getElementById("lockMsg").textContent = "비밀번호가 틀렸어요";
    inp.value = "";
  }
});
document.getElementById("lockForgot").addEventListener("click", function () {
  if (confirm("잠금을 끌까요?\n기록은 지워지지 않아요. 비밀번호만 없어져요.")) {
    data.pin = null;
    save();
    document.getElementById("lock").hidden = true;
  }
});
document.addEventListener("visibilitychange", function () {
  if (document.hidden) showLock(); else render(true);
});

// ---------- 시작 ----------
applyPrefs();
if (loadNotice) {
  var nt = document.getElementById("notice");
  nt.textContent = loadNotice;
  nt.hidden = false;
}
showTab(prefs.startTab);
showLock(); 