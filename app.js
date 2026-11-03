(function () {
  "use strict";

  const VERSION = "2.0.0";
  const STORAGE = {
    settings: "alarmchan.settings.v2",
    runtime: "alarmchan.runtime.v2",
    stats: "alarmchan.stats.v2",
    legacy: "linuxAlarmDrill.v1",
  };
  // アプリが止められていて鳴らせなかったアラームを、再表示時に何分後まで鳴らすか
  const MISSED_GRACE_MS = 30 * 60 * 1000;
  const RECENT_LIMIT = 15;
  const NOTIFY_TAG = "alarmchan-ring";

  const CATEGORY_LIST = [
    { id: "lpic201", label: "LPIC-2 201" },
    { id: "lpic202", label: "LPIC-2 202" },
    { id: "lpic1", label: "LPIC-1" },
    { id: "field", label: "現場頻出" },
    { id: "deep", label: "マニアック" },
  ];
  const CATEGORY_LABELS = Object.fromEntries(CATEGORY_LIST.map((category) => [category.id, category.label]));
  const TOPIC_LABELS = {
    200: "キャパシティプランニング",
    201: "Linux カーネル",
    202: "システムの起動",
    203: "ファイルシステムとデバイス",
    204: "高度なストレージ管理",
    205: "ネットワーク構成",
    206: "システムの保守",
    207: "DNS",
    208: "HTTP サービス",
    209: "ファイル共有",
    210: "ネットワーククライアント管理",
    211: "電子メールサービス",
    212: "システムセキュリティ",
  };
  const TYPE_LABELS = { single: "単一選択", multi: "複数選択", command: "コマンド入力", fill: "記述式" };
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const LETTERS = "ABCDEFGH";
  const LPIC2 = ["lpic201", "lpic202"];

  const DEFAULT_SETTINGS = {
    alarmTime: "07:00",
    enabled: false,
    days: [0, 1, 2, 3, 4, 5, 6],
    requiredCorrect: 3,
    categories: ["lpic201", "lpic202"],
    studyCategories: ["lpic201", "lpic202"],
    examFocus: true,
    keepAwake: true,
    vibrate: true,
    rampVolume: true,
  };

  const Matcher = window.AlarmMatcher;
  const QUESTIONS = (window.LINUX_ALARM_QUESTIONS || []).filter(isUsable);
  const QUESTION_BY_ID = new Map(QUESTIONS.map((question) => [question.id, question]));

  const $ = (selector) => document.querySelector(selector);
  const els = {
    views: {
      alarm: $("#view-alarm"),
      study: $("#view-study"),
      stats: $("#view-stats"),
      settings: $("#view-settings"),
    },
    tabs: Array.from(document.querySelectorAll(".tab")),
    clockNow: $("#clockNow"),
    clockDate: $("#clockDate"),
    alarmCard: $("#alarmCard"),
    alarmTime: $("#alarmTime"),
    alarmTimeDisplay: $("#alarmTimeDisplay"),
    alarmEnabled: $("#alarmEnabled"),
    alarmNext: $("#alarmNext"),
    weekdays: $("#weekdays"),
    missedNote: $("#missedNote"),
    reqMinus: $("#reqMinus"),
    reqPlus: $("#reqPlus"),
    reqValue: $("#reqValue"),
    alarmCategories: $("#alarmCategories"),
    alarmPoolCount: $("#alarmPoolCount"),
    examFocusNote: $("#examFocusNote"),
    nightBtn: $("#nightBtn"),
    testBtn: $("#testBtn"),
    quickButtons: Array.from(document.querySelectorAll("[data-quick]")),
    quick201Sub: $("#quick201Sub"),
    quick202Sub: $("#quick202Sub"),
    quickWeakSub: $("#quickWeakSub"),
    quickUnseenSub: $("#quickUnseenSub"),
    studyCategories: $("#studyCategories"),
    studyTopic: $("#studyTopic"),
    studyPoolCount: $("#studyPoolCount"),
    studyStart: $("#studyStart"),
    statAnswered: $("#statAnswered"),
    statAccuracy: $("#statAccuracy"),
    statWakeups: $("#statWakeups"),
    statWeak: $("#statWeak"),
    categoryBars: $("#categoryBars"),
    topicBars: $("#topicBars"),
    resetStats: $("#resetStats"),
    optExamFocus: $("#optExamFocus"),
    optRamp: $("#optRamp"),
    optVibrate: $("#optVibrate"),
    optKeepAwake: $("#optKeepAwake"),
    soundPreview: $("#soundPreview"),
    notifyBtn: $("#notifyBtn"),
    notifyStatus: $("#notifyStatus"),
    notifyAction: $("#notifyAction"),
    installBtn: $("#installBtn"),
    resetAll: $("#resetAll"),
    aboutText: $("#aboutText"),
    quiz: $("#quiz"),
    quizBadge: $("#quizBadge"),
    quizCount: $("#quizCount"),
    quizClose: $("#quizClose"),
    quizMeter: $("#quizMeter"),
    quizScroll: $("#quizScroll"),
    qMeta: $("#qMeta"),
    qText: $("#qText"),
    qCode: $("#qCode"),
    answerForm: $("#answerForm"),
    qFieldset: $("#qFieldset"),
    qOptions: $("#qOptions"),
    qInputWrap: $("#qInputWrap"),
    qInputLabel: $("#qInputLabel"),
    qInput: $("#qInput"),
    qHint: $("#qHint"),
    qHintText: $("#qHintText"),
    qResult: $("#qResult"),
    qResultTitle: $("#qResultTitle"),
    qResultAnswer: $("#qResultAnswer"),
    qResultExplain: $("#qResultExplain"),
    quizAction: $("#quizAction"),
    night: $("#night"),
    nightBody: $("#nightBody"),
    nightClock: $("#nightClock"),
    nightDate: $("#nightDate"),
    nightNext: $("#nightNext"),
    nightExit: $("#nightExit"),
    sheet: $("#sheet"),
    sheetTitle: $("#sheetTitle"),
    sheetBody: $("#sheetBody"),
    sheetActions: $("#sheetActions"),
    toast: $("#toast"),
  };

  let settings = loadSettings();
  let runtime = loadRuntime();
  let stats = loadStats();

  const ui = {
    tab: "alarm",
    nightOpen: false,
    nightIdleTimer: null,
    deferredInstall: null,
    toastTimer: null,
    lastMinute: -1,
    overlayHistory: false,
    ignorePop: false,
  };

  const quiz = {
    open: false,
    mode: null, // "alarm" | "study"
    deck: [],
    index: 0,
    current: null, // { q, order }
    answered: false,
    results: [],
    finished: false,
    alarmSummary: null,
    recent: [],
  };

  // ───────── 保存 ─────────

  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // プライベートモードなどで保存できなくても動作は続ける
    }
  }

  function removeKey(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // 無視
    }
  }

  function sanitizeCategories(list) {
    const result = [];
    for (const id of Array.isArray(list) ? list : []) {
      if (id === "lpic2") result.push(...LPIC2); // 旧版のカテゴリ
      else if (CATEGORY_LABELS[id]) result.push(id);
    }
    return [...new Set(result)];
  }

  function loadSettings() {
    const result = structuredCloneSafe(DEFAULT_SETTINGS);
    const stored = readJSON(STORAGE.settings);
    const source = stored || readJSON(STORAGE.legacy) || {};

    if (typeof source.alarmTime === "string" && parseTime(source.alarmTime)) result.alarmTime = source.alarmTime;
    if (Number.isInteger(source.requiredCorrect)) result.requiredCorrect = clamp(source.requiredCorrect, 1, 10);
    for (const key of ["categories", "studyCategories"]) {
      const categories = sanitizeCategories(source[key]);
      if (categories.length) result[key] = categories;
    }
    if (Array.isArray(source.days)) {
      result.days = [...new Set(source.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
    }
    for (const key of ["examFocus", "keepAwake", "vibrate", "rampVolume"]) {
      if (typeof source[key] === "boolean") result[key] = source[key];
    }
    // 旧版から移行した場合は、勝手に鳴らないようオフで始める
    if (stored && typeof stored.enabled === "boolean") result.enabled = stored.enabled;
    return result;
  }

  function saveSettings() {
    writeJSON(STORAGE.settings, settings);
  }

  function loadRuntime() {
    const stored = readJSON(STORAGE.runtime) || {};
    const ringing = stored.ringing && typeof stored.ringing === "object" ? stored.ringing : null;
    return {
      nextAlarmAt: Number.isFinite(stored.nextAlarmAt) ? stored.nextAlarmAt : null,
      missedAt: Number.isFinite(stored.missedAt) ? stored.missedAt : null,
      ringing: ringing
        ? {
            since: Number.isFinite(ringing.since) ? ringing.since : Date.now(),
            correct: Number.isInteger(ringing.correct) ? ringing.correct : 0,
            answered: Number.isInteger(ringing.answered) ? ringing.answered : 0,
            required: Number.isInteger(ringing.required) ? clamp(ringing.required, 1, 10) : 3,
            test: Boolean(ringing.test),
          }
        : null,
    };
  }

  function saveRuntime() {
    writeJSON(STORAGE.runtime, runtime);
  }

  function loadStats() {
    const stored = readJSON(STORAGE.stats);
    return {
      q: stored && stored.q && typeof stored.q === "object" ? stored.q : {},
      wakeups: stored && Number.isInteger(stored.wakeups) ? stored.wakeups : 0,
    };
  }

  function saveStats() {
    writeJSON(STORAGE.stats, stats);
  }

  function recordAnswer(question, ok) {
    const entry = stats.q[question.id] || { c: 0, w: 0 };
    if (ok) entry.c += 1;
    else entry.w += 1;
    entry.last = ok ? "c" : "w";
    entry.t = Date.now();
    stats.q[question.id] = entry;
    saveStats();
  }

  // ───────── 小物 ─────────

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function hm(date) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatDay(date) {
    return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAYS[date.getDay()]})`;
  }

  function formatDateLong(date) {
    return `${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAYS[date.getDay()]}）`;
  }

  function formatRemaining(ms) {
    const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours >= 24) return `${Math.floor(hours / 24)}日${hours % 24}時間後`;
    if (hours > 0) return `${hours}時間${minutes}分後`;
    return `${minutes}分後`;
  }

  function formatDuration(ms) {
    const seconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    return minutes > 0 ? `${minutes}分${seconds % 60}秒` : `${seconds}秒`;
  }

  function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === "className") node.className = value;
        else if (key === "text") node.textContent = value;
        else node.setAttribute(key, value === true ? "" : value);
      }
    }
    for (const child of children) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : String(child));
    }
    return node;
  }

  // --create のようなハイフン入りの短い ASCII 語を折り返さないよう span で包む
  const NOWRAP_TOKEN = /[!-~]*-[!-~]*/g;

  function setRichText(node, text) {
    const value = String(text == null ? "" : text);
    node.textContent = "";
    let last = 0;
    for (const match of value.matchAll(NOWRAP_TOKEN)) {
      const token = match[0];
      if (token.length < 2 || token.length > 22) continue;
      node.append(value.slice(last, match.index), el("span", { className: "nb", text: token }));
      last = match.index + token.length;
    }
    node.append(value.slice(last));
    return node;
  }

  function richEl(tag, className, text) {
    return setRichText(el(tag, { className }), text);
  }

  function hideToast() {
    clearTimeout(ui.toastTimer);
    els.toast.hidden = true;
  }

  function toast(message, duration = 2600) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, duration);
  }

  function isTouchDevice() {
    return window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  }

  // ───────── 問題の選び方 ─────────

  function isUsable(question) {
    if (!question || typeof question.id !== "string" || typeof question.text !== "string") return false;
    if (question.type === "single" || question.type === "multi") {
      return Array.isArray(question.options) && Array.isArray(question.answer) && question.answer.length > 0;
    }
    if (question.type === "command" || question.type === "fill") {
      return Array.isArray(question.answers) && question.answers.length > 0;
    }
    return false;
  }

  function isChoice(question) {
    return question.type === "single" || question.type === "multi";
  }

  function poolFor(categories) {
    const set = new Set(categories);
    return QUESTIONS.filter((question) => set.has(question.category));
  }

  function isWeak(question) {
    const entry = stats.q[question.id];
    return Boolean(entry && entry.last === "w");
  }

  function isSeen(question) {
    return Boolean(stats.q[question.id]);
  }

  // 頻出度と学習状況から出題の重みを決める
  function weightOf(question) {
    const freqWeight = settings.examFocus ? { 1: 1, 2: 2, 3: 4 }[question.freq] || 2 : 1;
    const entry = stats.q[question.id];
    let factor = 1.4; // 未出題
    if (entry) {
      if (entry.last === "w") factor = 2.6; // 直近で間違えた
      else if (entry.c >= 2 && entry.w === 0) factor = 0.45; // 安定して正解している
      else factor = 1;
    }
    return freqWeight * factor;
  }

  function weightedPick(list) {
    const weights = list.map(weightOf);
    let rest = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
    for (let i = 0; i < list.length; i += 1) {
      rest -= weights[i];
      if (rest <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  // 重み付きの非復元抽出（Efraimidis–Spirakis）
  function weightedSample(list, count) {
    return list
      .map((question) => ({ question, key: Math.pow(Math.random(), 1 / weightOf(question)) }))
      .sort((a, b) => b.key - a.key)
      .slice(0, count)
      .map((item) => item.question);
  }

  function pickAlarmQuestion() {
    let pool = poolFor(settings.categories);
    if (pool.length === 0) pool = QUESTIONS;
    const recent = new Set(quiz.recent);
    const fresh = pool.filter((question) => !recent.has(question.id));
    const question = weightedPick(fresh.length ? fresh : pool);
    const keep = Math.min(RECENT_LIMIT, Math.max(0, pool.length - 1));
    quiz.recent = [question.id, ...quiz.recent.filter((id) => id !== question.id)].slice(0, keep);
    return question;
  }

  // ───────── アラームの予定 ─────────

  function parseTime(value) {
    const match = /^(\d{1,2}):(\d{2})/.exec(value || "");
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return { hours, minutes };
  }

  function computeNextAlarm(from) {
    const time = parseTime(settings.alarmTime);
    if (!time || settings.days.length === 0) return null;
    for (let offset = 0; offset <= 7; offset += 1) {
      const candidate = new Date(
        from.getFullYear(),
        from.getMonth(),
        from.getDate() + offset,
        time.hours,
        time.minutes,
        0,
        0,
      );
      if (candidate > from && settings.days.includes(candidate.getDay())) return candidate.getTime();
    }
    return null;
  }

  function scheduleNext() {
    runtime.nextAlarmAt = settings.enabled ? computeNextAlarm(new Date()) : null;
    saveRuntime();
  }

  function nextAlarmLabel() {
    if (!settings.enabled) return "アラームはオフです";
    if (!runtime.nextAlarmAt) return "曜日が選ばれていません";
    const next = new Date(runtime.nextAlarmAt);
    return `${formatDay(next)} ${hm(next)}（${formatRemaining(runtime.nextAlarmAt - Date.now())}）`;
  }

  function tick() {
    const now = new Date();
    els.clockNow.innerHTML = `${hm(now)}<span class="clock-sec">${pad(now.getSeconds())}</span>`;
    els.clockDate.textContent = formatDateLong(now);

    if (!runtime.ringing && runtime.nextAlarmAt && now.getTime() >= runtime.nextAlarmAt) {
      if (now.getTime() - runtime.nextAlarmAt <= MISSED_GRACE_MS) {
        startAlarm(false);
      } else {
        runtime.missedAt = runtime.nextAlarmAt;
        scheduleNext();
      }
    }

    renderAlarmStatus();
    if (ui.nightOpen) renderNight(now);
    ui.lastMinute = now.getMinutes();
  }

  // ───────── アラーム音 ─────────

  const sound = {
    audio: null,
    ctx: null,
    playing: false,
    primed: false,
    startedAt: 0,
    rampTimer: null,
    vibrateTimer: null,
    toneTimer: null,
    previewTimer: null,
  };

  function writeAscii(view, offset, text) {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  }

  // 「ピピピッ」1.2 秒分の WAV を端末内で生成する（外部ファイル不要）
  function makeAlarmWavUrl() {
    const rate = 22050;
    const length = Math.round(rate * 1.2);
    const beeps = [
      [0, 0.12, 988],
      [0.17, 0.12, 988],
      [0.34, 0.2, 1319],
    ];
    const samples = new Int16Array(length);
    for (const [start, duration, frequency] of beeps) {
      const from = Math.round(start * rate);
      const to = Math.min(length, Math.round((start + duration) * rate));
      for (let i = from; i < to; i += 1) {
        const t = (i - from) / rate;
        const envelope = Math.min(1, t / 0.005, (to - i) / rate / 0.012);
        const x = 2 * Math.PI * frequency * t;
        const wave = (Math.sin(x) + 0.35 * Math.sin(3 * x) + 0.15 * Math.sin(5 * x)) / 1.5;
        samples[i] = Math.round(wave * envelope * 0.92 * 32767);
      }
    }
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + length * 2, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, length * 2, true);
    samples.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true));
    return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  }

  function getAudio() {
    if (!sound.audio) {
      const audio = new Audio();
      audio.src = makeAlarmWavUrl();
      audio.loop = true;
      audio.preload = "auto";
      audio.setAttribute("playsinline", "");
      sound.audio = audio;
    }
    return sound.audio;
  }

  function useLoudAudioSession() {
    // iOS 17 以降: マナーモードでも再生する音声として扱う
    try {
      if (navigator.audioSession) navigator.audioSession.type = "playback";
    } catch {
      // 未対応
    }
  }

  // ユーザー操作の中で一度だけ無音で再生し、後から操作なしでも鳴らせるようにしておく
  function primeAudio() {
    if (sound.primed || sound.playing) return;
    useLoudAudioSession();
    const audio = getAudio();
    audio.muted = true;
    const attempt = audio.play();
    const settle = () => {
      if (!sound.playing) {
        audio.pause();
        try {
          audio.currentTime = 0;
        } catch {
          // 無視
        }
      }
      audio.muted = false;
    };
    if (attempt && typeof attempt.then === "function") {
      attempt
        .then(() => {
          sound.primed = true;
          settle();
        })
        .catch(() => {
          audio.muted = false;
        });
    } else {
      sound.primed = true;
      settle();
    }
    getAudioContext();
  }

  function getAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!sound.ctx) {
      try {
        sound.ctx = new AudioContextClass();
      } catch {
        return null;
      }
    }
    if (sound.ctx.state === "suspended") sound.ctx.resume().catch(() => {});
    return sound.ctx;
  }

  function currentLevel() {
    if (!settings.rampVolume) return 1;
    return Math.min(1, 0.25 + (Date.now() - sound.startedAt) / 40000);
  }

  function applyRamp() {
    if (!sound.audio) return;
    try {
      sound.audio.volume = currentLevel(); // iPhone では無視される
    } catch {
      // 無視
    }
  }

  function canVibrate() {
    if (!settings.vibrate || !navigator.vibrate) return false;
    // 一度も画面に触れていない状態で呼ぶとブラウザに拒否される
    return !navigator.userActivation || navigator.userActivation.hasBeenActive;
  }

  function vibratePattern() {
    if (canVibrate()) navigator.vibrate([320, 140, 320, 140, 640]);
  }

  function startSound() {
    if (sound.playing) return;
    sound.playing = true;
    sound.startedAt = Date.now();
    useLoudAudioSession();
    const audio = getAudio();
    audio.muted = false;
    audio.loop = true;
    applyRamp();
    const attempt = audio.play();
    if (attempt && typeof attempt.catch === "function") {
      attempt.then(stopFallbackTone).catch(startFallbackTone);
    }
    clearInterval(sound.rampTimer);
    sound.rampTimer = setInterval(applyRamp, 1000);
    clearInterval(sound.vibrateTimer);
    vibratePattern();
    sound.vibrateTimer = setInterval(vibratePattern, 1800);
  }

  function resumeSoundIfNeeded() {
    if (!runtime.ringing || !sound.playing) return;
    const audio = getAudio();
    if (audio.paused) {
      const attempt = audio.play();
      if (attempt && typeof attempt.then === "function") attempt.then(stopFallbackTone).catch(() => {});
    }
  }

  function stopSound() {
    sound.playing = false;
    clearInterval(sound.rampTimer);
    clearInterval(sound.vibrateTimer);
    sound.rampTimer = null;
    sound.vibrateTimer = null;
    if (sound.audio) {
      sound.audio.pause();
      try {
        sound.audio.currentTime = 0;
      } catch {
        // 無視
      }
    }
    stopFallbackTone();
    if (canVibrate()) navigator.vibrate(0);
  }

  // <audio> が再生できなかったときの予備（Web Audio）
  function startFallbackTone() {
    if (!sound.playing || sound.toneTimer) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const burst = () => {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const start = ctx.currentTime + 0.03;
      const level = 0.32 * currentLevel();
      beep(ctx, start, 0.12, 988, level);
      beep(ctx, start + 0.17, 0.12, 988, level);
      beep(ctx, start + 0.34, 0.2, 1319, level);
    };
    burst();
    sound.toneTimer = setInterval(burst, 1200);
  }

  function stopFallbackTone() {
    clearInterval(sound.toneTimer);
    sound.toneTimer = null;
  }

  function beep(ctx, start, duration, frequency, volume) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.setValueAtTime(volume, start + duration - 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function previewSound() {
    if (sound.playing) return;
    useLoudAudioSession();
    const audio = getAudio();
    audio.muted = false;
    try {
      audio.volume = 1;
      audio.currentTime = 0;
    } catch {
      // 無視
    }
    const attempt = audio.play();
    if (attempt && typeof attempt.catch === "function") {
      attempt.catch(() => toast("音を再生できませんでした。マナーモードや音量を確認してください"));
    }
    clearTimeout(sound.previewTimer);
    sound.previewTimer = setTimeout(() => {
      if (!sound.playing) {
        audio.pause();
        try {
          audio.currentTime = 0;
        } catch {
          // 無視
        }
      }
    }, 2400);
  }

  // ───────── 通知・画面スリープ ─────────

  async function getRegistration() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      return (await navigator.serviceWorker.getRegistration()) || null;
    } catch {
      return null;
    }
  }

  async function notifyAlarm() {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;
    const title = "⏰ 起きる時間です";
    const options = {
      body: "問題に正解するまで止まりません。タップして開く",
      tag: NOTIFY_TAG,
      renotify: true,
      requireInteraction: true,
      icon: "./assets/icon-192.png",
      badge: "./assets/icon-192.png",
      vibrate: [320, 140, 320, 140, 640],
    };
    try {
      const registration = await getRegistration();
      if (registration) await registration.showNotification(title, options);
      else new Notification(title, options);
    } catch {
      // 通知できない環境
    }
  }

  async function closeAlarmNotification() {
    const registration = await getRegistration();
    if (!registration || !registration.getNotifications) return;
    try {
      const list = await registration.getNotifications({ tag: NOTIFY_TAG });
      list.forEach((notification) => notification.close());
    } catch {
      // 無視
    }
  }

  const wake = { lock: null, pending: false };

  function wantWakeLock() {
    return (
      document.visibilityState === "visible" &&
      Boolean(runtime.ringing || ui.nightOpen || (settings.keepAwake && settings.enabled))
    );
  }

  function releaseWakeLock() {
    if (!wake.lock) return;
    wake.lock.release().catch(() => {});
    wake.lock = null;
  }

  async function syncWakeLock() {
    if (!("wakeLock" in navigator)) return;
    if (!wantWakeLock()) {
      releaseWakeLock();
      return;
    }
    if (wake.lock || wake.pending) return;
    wake.pending = true;
    try {
      const lock = await navigator.wakeLock.request("screen");
      wake.lock = lock;
      lock.addEventListener("release", () => {
        if (wake.lock === lock) wake.lock = null;
      });
    } catch {
      wake.lock = null;
    } finally {
      wake.pending = false;
    }
    if (!wantWakeLock()) releaseWakeLock();
  }

  // ───────── 戻るボタン対策 ─────────

  function pushOverlayState() {
    if (ui.overlayHistory) return;
    try {
      history.pushState({ alarmchan: "overlay" }, "");
      ui.overlayHistory = true;
    } catch {
      // 無視
    }
  }

  function popOverlayState() {
    if (!ui.overlayHistory) return;
    ui.overlayHistory = false;
    ui.ignorePop = true;
    try {
      history.back();
    } catch {
      ui.ignorePop = false;
    }
  }

  function onPopState() {
    if (ui.ignorePop) {
      ui.ignorePop = false;
      return;
    }
    if (!ui.overlayHistory) return;
    ui.overlayHistory = false;
    if (quiz.open && quiz.mode === "alarm") {
      if (quiz.finished) {
        const summary = quiz.alarmSummary;
        closeQuiz();
        showMorningSheet(summary);
        return;
      }
      pushOverlayState();
      toast("正解するまで止まりません");
      return;
    }
    if (quiz.open) {
      requestCloseStudy();
      return;
    }
    if (ui.nightOpen) closeNight();
  }

  // ───────── アラームの鳴動 ─────────

  function startAlarm(test) {
    if (runtime.ringing) return;
    runtime.ringing = {
      since: Date.now(),
      correct: 0,
      answered: 0,
      required: test ? 1 : settings.requiredCorrect,
      test: Boolean(test),
    };
    if (!test) runtime.missedAt = null;
    saveRuntime();
    enterAlarmUI(false);
  }

  function enterAlarmUI(restored) {
    if (ui.nightOpen) closeNight(false);
    closeSheet();
    openQuiz("alarm");
    startSound();
    notifyAlarm();
    syncWakeLock();
    renderAll();
    if (restored) toast("アラームの途中です。正解するまで止まりません", 3600);
  }

  function onAlarmAnswered(ok) {
    const ringing = runtime.ringing;
    if (!ringing) return;
    ringing.answered += 1;
    if (ok) ringing.correct += 1;
    saveRuntime();
    if (ringing.correct >= ringing.required) completeAlarm();
  }

  function completeAlarm() {
    const ringing = runtime.ringing;
    if (!ringing) return;
    stopSound();
    closeAlarmNotification();
    quiz.finished = true;
    quiz.alarmSummary = { ...ringing, endedAt: Date.now() };
    if (!ringing.test) {
      stats.wakeups += 1;
      saveStats();
    }
    runtime.ringing = null;
    if (ringing.test) saveRuntime();
    else scheduleNext();
    els.quiz.classList.add("is-done");
    if (canVibrate()) navigator.vibrate([40, 60, 40]);
    syncWakeLock();
    renderAll();
  }

  // ───────── 出題画面 ─────────

  function openQuiz(mode, deck) {
    Object.assign(quiz, {
      open: true,
      mode,
      deck: deck || [],
      index: 0,
      results: [],
      finished: false,
      alarmSummary: null,
    });
    hideToast();
    els.quiz.hidden = false;
    els.quiz.classList.toggle("is-alarm", mode === "alarm");
    els.quiz.classList.remove("is-done");
    document.body.classList.add("has-overlay");
    pushOverlayState();
    els.quizMeter.style.transition = "none";
    showQuestion(mode === "alarm" ? pickAlarmQuestion() : quiz.deck[0]);
    void els.quizMeter.offsetWidth;
    els.quizMeter.style.transition = "";
  }

  function closeQuiz() {
    quiz.open = false;
    quiz.current = null;
    els.quiz.hidden = true;
    if (document.activeElement && els.quiz.contains(document.activeElement)) document.activeElement.blur();
    if (!ui.nightOpen) {
      document.body.classList.remove("has-overlay");
      popOverlayState();
    }
  }

  function requestCloseStudy() {
    if (!quiz.open || quiz.mode !== "study") return;
    if (quiz.results.length > 0) finishStudy();
    else closeQuiz();
  }

  function addMeta(text, className) {
    els.qMeta.append(el("span", { className, text }));
  }

  function showQuestion(question) {
    const order = isChoice(question)
      ? question.noShuffle
        ? question.options.map((_, index) => index)
        : shuffle(question.options.map((_, index) => index))
      : [];
    quiz.current = { q: question, order };
    quiz.answered = false;

    els.qMeta.textContent = "";
    addMeta(CATEGORY_LABELS[question.category] || question.level || "問題");
    if (question.topic && TOPIC_LABELS[question.topic]) addMeta(`主題 ${question.topic} ${TOPIC_LABELS[question.topic]}`);
    addMeta(question.type === "multi" ? `複数選択・${question.answer.length}つ` : TYPE_LABELS[question.type]);
    if (question.freq === 3) addMeta("最頻出", "is-hot");

    const [lead, ...blocks] = question.text.split("\n\n");
    setRichText(els.qText, lead);
    els.qCode.textContent = "";
    for (const block of blocks) els.qCode.append(el("pre", { className: "q-code", text: block }));

    els.qFieldset.disabled = false;
    els.qOptions.textContent = "";
    els.qOptions.classList.toggle("is-multi", question.type === "multi");
    const textAnswer = !isChoice(question);
    els.qOptions.hidden = textAnswer;
    els.qInputWrap.hidden = !textAnswer;
    els.qInput.value = "";
    els.qInput.className = "";

    if (textAnswer) {
      els.qInputLabel.textContent = question.type === "command" ? "コマンドを入力" : "答えを入力";
      els.qInput.placeholder = question.type === "command" ? "例: ls -l /etc" : "";
    } else {
      const inputType = question.type === "multi" ? "checkbox" : "radio";
      order.forEach((optionIndex, position) => {
        const text = question.options[optionIndex];
        const id = `opt-${position}`;
        const label = el(
          "label",
          { className: "opt", for: id, "data-index": optionIndex },
          el("input", { type: inputType, name: "answer", id, value: optionIndex }),
          el("span", { className: "opt-key", "aria-hidden": "true", text: LETTERS[position] }),
          richEl("span", /^[\x20-\x7e]+$/.test(text) ? "opt-text is-code" : "opt-text", text),
        );
        els.qOptions.append(label);
      });
    }

    els.qHint.open = false;
    els.qHint.hidden = !question.hint;
    setRichText(els.qHintText, question.hint || "");
    els.qResult.hidden = true;
    els.quizScroll.scrollTop = 0;

    updateQuizHeader();
    updateQuizAction();
    if (textAnswer && !isTouchDevice()) els.qInput.focus({ preventScroll: true });
  }

  function hasResponse() {
    const question = quiz.current && quiz.current.q;
    if (!question) return false;
    if (isChoice(question)) return Boolean(els.qOptions.querySelector("input:checked"));
    return els.qInput.value.trim() !== "";
  }

  function syncSelectedOptions() {
    els.qOptions.querySelectorAll(".opt").forEach((label) => {
      label.classList.toggle("is-selected", label.querySelector("input").checked);
    });
    updateQuizAction();
  }

  function updateQuizHeader() {
    if (quiz.mode === "alarm") {
      const info = runtime.ringing || quiz.alarmSummary || { correct: 0, required: 1 };
      els.quizBadge.textContent = quiz.finished ? "停止しました" : "⏰ 鳴動中";
      els.quizCount.textContent = quiz.finished
        ? `${info.correct} 問正解でストップ`
        : `正解 ${info.correct} / ${info.required}（あと ${Math.max(0, info.required - info.correct)} 問）`;
      els.quizMeter.style.width = `${Math.min(100, (info.correct / info.required) * 100)}%`;
      els.quizClose.hidden = true;
      return;
    }
    const total = quiz.deck.length;
    const done = quiz.index + (quiz.answered ? 1 : 0);
    const correct = quiz.results.filter((result) => result.ok).length;
    els.quizBadge.textContent = "学習";
    els.quizCount.textContent = `${quiz.index + 1} / ${total} 問目 · 正解 ${correct}`;
    els.quizMeter.style.width = `${total ? (done / total) * 100 : 0}%`;
    els.quizClose.hidden = false;
  }

  function updateQuizAction() {
    const button = els.quizAction;
    if (quiz.finished) {
      button.disabled = false;
      button.textContent = "おはようございます ☀ 閉じる";
      return;
    }
    if (quiz.answered) {
      button.disabled = false;
      button.textContent = quiz.mode === "study" && quiz.index >= quiz.deck.length - 1 ? "結果を見る" : "次の問題";
      return;
    }
    button.textContent = "解答する";
    button.disabled = !hasResponse();
  }

  function correctAnswerText(question, order) {
    if (!isChoice(question)) {
      const others = question.answers.length - 1;
      return `正答例: ${question.answers[0]}${others > 0 ? `（ほか ${others} 通りの書き方も正解）` : ""}`;
    }
    const lines = order
      .map((optionIndex, position) => ({ optionIndex, position }))
      .filter((item) => question.answer.includes(item.optionIndex))
      .map((item) => `${LETTERS[item.position]}. ${question.options[item.optionIndex]}`);
    return `正答: ${lines.join(" / ")}`;
  }

  function grade() {
    const { q: question, order } = quiz.current;
    let ok;
    let selected = [];
    if (isChoice(question)) {
      selected = Array.from(els.qOptions.querySelectorAll("input:checked")).map((input) => Number(input.value));
      if (selected.length === 0) return;
      const want = [...question.answer].sort((a, b) => a - b);
      const got = [...selected].sort((a, b) => a - b);
      ok = want.length === got.length && want.every((value, index) => value === got[index]);
    } else {
      const input = els.qInput.value;
      if (!input.trim()) return;
      ok = Matcher.matchesAny(input, question.answers, question.match, question.ignoreCase);
    }

    quiz.answered = true;
    recordAnswer(question, ok);
    quiz.results.push({ id: question.id, ok });

    els.qFieldset.disabled = true;
    if (isChoice(question)) {
      els.qOptions.querySelectorAll(".opt").forEach((label) => {
        const optionIndex = Number(label.dataset.index);
        const isAnswer = question.answer.includes(optionIndex);
        const chosen = selected.includes(optionIndex);
        label.classList.remove("is-selected");
        label.classList.toggle("is-correct", isAnswer);
        label.classList.toggle("is-missed", isAnswer && !chosen);
        label.classList.toggle("is-wrong", chosen && !isAnswer);
      });
    } else {
      els.qInput.classList.add(ok ? "is-correct" : "is-wrong");
      els.qInput.blur();
    }

    els.qResult.hidden = false;
    els.qResult.className = `q-result ${ok ? "is-ok" : "is-ng"}`;
    els.qResultTitle.textContent = ok ? "正解！" : "不正解";
    setRichText(els.qResultAnswer, correctAnswerText(question, order));
    setRichText(els.qResultExplain, question.explain || question.hint || "");

    if (quiz.mode === "alarm") onAlarmAnswered(ok);
    else if (!ok && canVibrate()) navigator.vibrate(60);

    updateQuizHeader();
    updateQuizAction();
    requestAnimationFrame(() => els.qResult.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  function advance() {
    if (quiz.mode === "alarm") {
      showQuestion(pickAlarmQuestion());
      return;
    }
    if (quiz.index + 1 >= quiz.deck.length) {
      finishStudy();
      return;
    }
    quiz.index += 1;
    showQuestion(quiz.deck[quiz.index]);
  }

  function onQuizSubmit(event) {
    event.preventDefault();
    if (!quiz.open || !quiz.current) return;
    if (quiz.finished) {
      const summary = quiz.alarmSummary;
      closeQuiz();
      showMorningSheet(summary);
      return;
    }
    if (!quiz.answered) {
      if (!hasResponse()) {
        els.quizAction.classList.remove("shake");
        void els.quizAction.offsetWidth;
        els.quizAction.classList.add("shake");
        return;
      }
      grade();
      return;
    }
    advance();
  }

  // ───────── 学習モード ─────────

  function startStudy({ categories, topic, count, filter, emptyMessage }) {
    let pool = poolFor(categories);
    if (topic) pool = pool.filter((question) => question.topic === topic);
    if (filter === "weak") pool = pool.filter(isWeak);
    if (filter === "unseen") pool = pool.filter((question) => !isSeen(question));
    if (pool.length === 0) {
      toast(emptyMessage || "該当する問題がありません");
      return;
    }
    const size = count === "all" ? pool.length : Math.min(Number(count) || 10, pool.length);
    primeAudio();
    openQuiz("study", weightedSample(pool, size));
  }

  function startQuick(kind) {
    if (kind === "lpic201" || kind === "lpic202") {
      startStudy({ categories: [kind], count: 10 });
    } else if (kind === "weak") {
      startStudy({
        categories: CATEGORY_LIST.map((category) => category.id),
        filter: "weak",
        count: 20,
        emptyMessage: "苦手な問題はまだありません",
      });
    } else if (kind === "unseen") {
      startStudy({
        categories: LPIC2,
        filter: "unseen",
        count: 10,
        emptyMessage: "LPIC-2 の問題はすべて出題済みです",
      });
    }
  }

  function finishStudy() {
    const results = quiz.results.slice();
    closeQuiz();
    showStudySheet(results);
    renderAll();
  }

  // ───────── シート ─────────

  function openSheet(title, body, actions) {
    els.sheetTitle.textContent = title;
    els.sheetBody.replaceChildren(...body.filter(Boolean));
    els.sheetActions.replaceChildren(
      ...actions.map((action) => {
        const kind = action.kind === "primary" ? " btn-primary" : action.kind === "danger" ? " btn-danger" : "";
        const button = el("button", { type: "button", className: `btn btn-block${kind}`, text: action.label });
        button.addEventListener("click", () => {
          closeSheet();
          if (action.onClick) action.onClick();
        });
        return button;
      }),
    );
    els.sheet.hidden = false;
    const first = els.sheetActions.querySelector("button");
    if (first) first.focus({ preventScroll: true });
  }

  function closeSheet() {
    els.sheet.hidden = true;
  }

  function summaryList(rows) {
    return el("ul", { className: "summary-list" }, ...rows.map(([label, value]) => el("li", null, el("span", { text: label }), el("span", { text: value }))));
  }

  function showMorningSheet(summary) {
    if (!summary) return;
    const body = [
      el("p", { text: summary.test ? "鳴動テストを終了しました。" : "正解して止めました。今日もいい一日を。" }),
      summaryList([
        ["止めるまで", formatDuration(summary.endedAt - summary.since)],
        ["解答", `${summary.answered} 問`],
        ["正解", `${summary.correct} 問`],
        ["次のアラーム", nextAlarmLabel()],
      ]),
    ];
    openSheet(summary.test ? "テスト完了" : "おはようございます ☀", body, [
      { label: "閉じる", kind: "primary" },
      { label: "このまま学習する", onClick: () => switchTab("study") },
    ]);
  }

  function showStudySheet(results) {
    if (results.length === 0) return;
    const total = results.length;
    const correct = results.filter((result) => result.ok).length;
    const rate = Math.round((correct / total) * 100);
    const wrong = [];
    const seen = new Set();
    for (const result of results) {
      if (result.ok || seen.has(result.id)) continue;
      seen.add(result.id);
      const question = QUESTION_BY_ID.get(result.id);
      if (question) wrong.push(question);
    }
    const message =
      rate >= 80
        ? "この範囲はかなり仕上がっています。"
        : rate >= 60
          ? "あと一歩。間違えた問題の解説を見直しましょう。"
          : "解説を読んで、もう一度挑戦しましょう。";
    const body = [
      el("p", { className: "score" }, el("strong", { text: correct }), ` / ${total} 問正解（${rate}%）`),
      el("p", { text: message }),
    ];
    if (wrong.length) {
      body.push(el("p", { text: "間違えた問題" }));
      body.push(
        el(
          "ul",
          { className: "review-list" },
          ...wrong.map((question) => {
            const lead = question.text.split("\n\n")[0];
            const answer = isChoice(question)
              ? question.answer.map((index) => question.options[index]).join(" / ")
              : question.answers[0];
            return el(
              "li",
              null,
              richEl("span", "review-q", lead.length > 80 ? `${lead.slice(0, 80)}…` : lead),
              richEl("span", "review-a", answer),
            );
          }),
        ),
      );
    }
    const actions = [];
    if (wrong.length) {
      actions.push({
        label: `間違えた ${wrong.length} 問をもう一度`,
        kind: "primary",
        onClick: () => openQuiz("study", shuffle(wrong)),
      });
    }
    actions.push({ label: "閉じる", kind: wrong.length ? undefined : "primary" });
    openSheet("結果", body, actions);
  }

  function confirmSheet(title, message, confirmLabel, onConfirm) {
    openSheet(title, [el("p", { text: message })], [
      { label: confirmLabel, kind: "danger", onClick: onConfirm },
      { label: "キャンセル" },
    ]);
  }

  // ───────── おやすみモード ─────────

  function openNight() {
    primeAudio();
    ui.nightOpen = true;
    els.night.hidden = false;
    document.body.classList.add("has-overlay");
    pushOverlayState();
    wakeNightControls();
    renderNight(new Date());
    syncWakeLock();
    const root = document.documentElement;
    if (root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(() => {});
    if (!settings.enabled) toast("アラームがオフになっています", 3200);
  }

  function closeNight(popHistory = true) {
    ui.nightOpen = false;
    els.night.hidden = true;
    clearTimeout(ui.nightIdleTimer);
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    if (!quiz.open) {
      document.body.classList.remove("has-overlay");
      if (popHistory) popOverlayState();
    }
    syncWakeLock();
  }

  function wakeNightControls() {
    els.night.classList.remove("is-idle");
    clearTimeout(ui.nightIdleTimer);
    ui.nightIdleTimer = setTimeout(() => els.night.classList.add("is-idle"), 5000);
  }

  function renderNight(now) {
    els.nightClock.textContent = hm(now);
    els.nightDate.textContent = formatDateLong(now);
    els.nightNext.textContent = settings.enabled && runtime.nextAlarmAt ? `⏰ ${nextAlarmLabel()}` : "アラームはオフです";
    if (now.getMinutes() !== ui.lastMinute) {
      // 有機 EL の焼き付き防止に、毎分すこしだけ位置をずらす
      const x = Math.round((Math.random() - 0.5) * 28);
      const y = Math.round((Math.random() - 0.5) * 40);
      els.nightBody.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  // ───────── 描画 ─────────

  function buildWeekdays() {
    els.weekdays.textContent = "";
    for (const day of WEEKDAY_ORDER) {
      els.weekdays.append(
        el(
          "label",
          { className: "day" },
          el("input", { type: "checkbox", name: "day", value: day, "aria-label": `${WEEKDAYS[day]}曜日` }),
          el("span", { text: WEEKDAYS[day], "aria-hidden": "true" }),
        ),
      );
    }
  }

  function buildCategoryChips(container, name) {
    container.textContent = "";
    for (const category of CATEGORY_LIST) {
      const count = QUESTIONS.filter((question) => question.category === category.id).length;
      if (count === 0) continue;
      container.append(
        el(
          "label",
          { className: "chip" },
          el("input", { type: "checkbox", name, value: category.id }),
          el("span", null, category.label, el("em", { text: count })),
        ),
      );
    }
  }

  function syncChecks(container, selected) {
    const wanted = new Set(selected.map(String));
    container.querySelectorAll("input").forEach((input) => {
      input.checked = wanted.has(input.value);
    });
  }

  function renderAlarmStatus() {
    const on = settings.enabled;
    els.alarmCard.classList.toggle("is-on", on);
    els.alarmCard.classList.toggle("is-off", !on);
    if (!on) els.alarmNext.textContent = "オフ（右のスイッチでオン）";
    else if (!runtime.nextAlarmAt) els.alarmNext.textContent = "鳴らす曜日を選んでください";
    else els.alarmNext.textContent = `次は ${nextAlarmLabel()}`;

    if (runtime.missedAt) {
      const missed = new Date(runtime.missedAt);
      els.missedNote.hidden = false;
      els.missedNote.textContent = `${formatDay(missed)} ${hm(missed)} のアラームは、アプリが止まっていたため鳴りませんでした。寝る前はおやすみモードにしておくと確実です。`;
    } else {
      els.missedNote.hidden = true;
    }
  }

  function formatAlarmTime(value) {
    const time = parseTime(value);
    return time ? `${pad(time.hours)}:${pad(time.minutes)}` : "--:--";
  }

  function renderAlarmForm() {
    if (document.activeElement !== els.alarmTime) els.alarmTime.value = settings.alarmTime;
    els.alarmTimeDisplay.textContent = formatAlarmTime(document.activeElement === els.alarmTime ? els.alarmTime.value : settings.alarmTime);
    els.alarmEnabled.checked = settings.enabled;
    syncChecks(els.weekdays, settings.days);
    syncChecks(els.alarmCategories, settings.categories);
    els.reqValue.textContent = String(settings.requiredCorrect);
    els.reqMinus.disabled = settings.requiredCorrect <= 1;
    els.reqPlus.disabled = settings.requiredCorrect >= 10;
    els.alarmPoolCount.textContent = `${poolFor(settings.categories).length} 問から出題`;
    els.examFocusNote.textContent = settings.examFocus
      ? "試験に出やすい問題・間違えた問題ほど出やすくなります。"
      : "すべての問題が同じ確率で出ます（間違えた問題はやや出やすくなります）。";
  }

  function renderStudy() {
    const count201 = poolFor(["lpic201"]).length;
    const count202 = poolFor(["lpic202"]).length;
    els.quick201Sub.textContent = `10 問 · 全 ${count201} 問`;
    els.quick202Sub.textContent = `10 問 · 全 ${count202} 問`;
    els.quickWeakSub.textContent = `${QUESTIONS.filter(isWeak).length} 問`;
    els.quickUnseenSub.textContent = `LPIC-2 · ${poolFor(LPIC2).filter((question) => !isSeen(question)).length} 問`;

    syncChecks(els.studyCategories, settings.studyCategories);
    const pool = poolFor(settings.studyCategories);
    const topics = [...new Set(pool.map((question) => question.topic).filter(Boolean))].sort();
    const current = els.studyTopic.value;
    els.studyTopic.replaceChildren(
      el("option", { value: "", text: "すべての主題" }),
      ...topics.map((topic) =>
        el("option", {
          value: topic,
          text: `${topic} ${TOPIC_LABELS[topic] || ""}（${pool.filter((question) => question.topic === topic).length} 問）`,
        }),
      ),
    );
    els.studyTopic.value = topics.includes(current) ? current : "";
    const topic = els.studyTopic.value;
    const size = topic ? pool.filter((question) => question.topic === topic).length : pool.length;
    els.studyPoolCount.textContent = `${size} 問`;
  }

  function accuracyClass(rate) {
    if (rate >= 80) return "";
    if (rate >= 60) return "is-mid";
    return "is-low";
  }

  function renderBars(container, groups) {
    container.textContent = "";
    for (const group of groups) {
      let correct = 0;
      let wrong = 0;
      let seen = 0;
      for (const question of group.questions) {
        const entry = stats.q[question.id];
        if (!entry) continue;
        correct += entry.c;
        wrong += entry.w;
        seen += 1;
      }
      const attempts = correct + wrong;
      const rate = attempts ? Math.round((correct / attempts) * 100) : null;
      const fill = el("span", { className: rate == null ? "" : accuracyClass(rate) });
      fill.style.width = `${rate || 0}%`;
      container.append(
        el(
          "div",
          { className: "bar-row" },
          el("div", { className: "bar-label" }, el("strong", { text: group.label }), el("span", { text: rate == null ? "—" : `${rate}%` })),
          el("div", { className: "bar", "aria-hidden": "true" }, fill),
          el("span", { className: "bar-sub", text: `出題済み ${seen} / ${group.questions.length} 問 · 解答 ${attempts} 回` }),
        ),
      );
    }
  }

  function renderStats() {
    let answered = 0;
    let correct = 0;
    for (const [id, entry] of Object.entries(stats.q)) {
      if (!QUESTION_BY_ID.has(id)) continue;
      answered += entry.c + entry.w;
      correct += entry.c;
    }
    els.statAnswered.textContent = String(answered);
    els.statAccuracy.textContent = answered ? `${Math.round((correct / answered) * 100)}%` : "—";
    els.statWakeups.textContent = String(stats.wakeups);
    els.statWeak.textContent = String(QUESTIONS.filter(isWeak).length);

    renderBars(
      els.categoryBars,
      CATEGORY_LIST.map((category) => ({
        label: category.label,
        questions: QUESTIONS.filter((question) => question.category === category.id),
      })).filter((group) => group.questions.length),
    );
    renderBars(
      els.topicBars,
      Object.keys(TOPIC_LABELS)
        .map((topic) => ({
          label: `${topic} ${TOPIC_LABELS[topic]}`,
          questions: QUESTIONS.filter((question) => question.topic === topic),
        }))
        .filter((group) => group.questions.length),
    );
  }

  function renderNotify() {
    let status;
    let action = "—";
    let enabled = false;
    if (!("Notification" in window)) {
      status = "この環境では使えません（iPhone はホーム画面に追加すると使えます）";
    } else if (Notification.permission === "granted") {
      status = "許可済み。バックグラウンドで鳴ったときに通知します";
      action = "許可済み";
    } else if (Notification.permission === "denied") {
      status = "ブロックされています。ブラウザの設定から許可してください";
    } else {
      status = "バックグラウンドで鳴ったときに通知を出します";
      action = "許可する";
      enabled = true;
    }
    els.notifyStatus.textContent = status;
    els.notifyAction.textContent = action;
    els.notifyBtn.disabled = !enabled;
  }

  function renderSettings() {
    els.optExamFocus.checked = settings.examFocus;
    els.optRamp.checked = settings.rampVolume;
    els.optVibrate.checked = settings.vibrate;
    els.optKeepAwake.checked = settings.keepAwake;
    renderNotify();
    els.installBtn.hidden = !ui.deferredInstall;
    const lpic2Count = poolFor(LPIC2).length;
    els.aboutText.textContent = `Linuxと目覚めるアラームちゃん v${VERSION} · 収録 ${QUESTIONS.length} 問（LPIC-2 ${lpic2Count} 問）`;
  }

  function renderAll() {
    renderAlarmForm();
    renderAlarmStatus();
    renderStudy();
    renderStats();
    renderSettings();
  }

  function switchTab(tab) {
    ui.tab = tab;
    for (const [name, view] of Object.entries(els.views)) view.hidden = name !== tab;
    for (const button of els.tabs) {
      const active = button.dataset.tab === tab;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    if (tab === "study") renderStudy();
    if (tab === "stats") renderStats();
    if (tab === "settings") renderSettings();
    window.scrollTo(0, 0);
  }

  // ───────── イベント ─────────

  function checkedValues(container) {
    return Array.from(container.querySelectorAll("input:checked")).map((input) => input.value);
  }

  function onAlarmToggle() {
    settings.enabled = els.alarmEnabled.checked;
    if (settings.enabled) primeAudio();
    saveSettings();
    scheduleNext();
    renderAll();
    syncWakeLock();
    if (settings.enabled && runtime.nextAlarmAt) toast(`${formatRemaining(runtime.nextAlarmAt - Date.now())}に鳴ります`);
    else if (!settings.enabled) toast("アラームをオフにしました");
  }

  // 時刻を変えたら自動でオンにする（フォーカスを外しただけでは何もしない）
  function onTimeChange() {
    const value = els.alarmTime.value;
    if (!parseTime(value) || value === settings.alarmTime) return;
    settings.alarmTime = value;
    settings.enabled = true;
    primeAudio();
    saveSettings();
    scheduleNext();
    renderAll();
    syncWakeLock();
    if (runtime.nextAlarmAt) toast(`${formatRemaining(runtime.nextAlarmAt - Date.now())}に鳴ります`);
  }

  function onCategoryChange(container, key, event) {
    const values = checkedValues(container);
    if (values.length === 0) {
      if (event && event.target) event.target.checked = true;
      toast("1 つ以上選んでください");
      return;
    }
    settings[key] = values;
    saveSettings();
    renderAll();
  }

  function bindEvents() {
    els.tabs.forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));

    els.alarmEnabled.addEventListener("change", onAlarmToggle);
    els.alarmTime.addEventListener("change", onTimeChange);
    els.alarmTime.addEventListener("blur", onTimeChange);
    els.alarmTime.addEventListener("input", () => {
      if (parseTime(els.alarmTime.value)) els.alarmTimeDisplay.textContent = formatAlarmTime(els.alarmTime.value);
    });
    els.alarmTime.addEventListener("click", () => {
      // PC ではアイコンを押さないとピッカーが開かないので明示的に開く
      if (isTouchDevice() || typeof els.alarmTime.showPicker !== "function") return;
      try {
        els.alarmTime.showPicker();
      } catch {
        // 対応していないブラウザ
      }
    });

    els.weekdays.addEventListener("change", () => {
      settings.days = checkedValues(els.weekdays).map(Number);
      saveSettings();
      scheduleNext();
      renderAll();
    });

    els.reqMinus.addEventListener("click", () => {
      settings.requiredCorrect = clamp(settings.requiredCorrect - 1, 1, 10);
      saveSettings();
      renderAlarmForm();
    });
    els.reqPlus.addEventListener("click", () => {
      settings.requiredCorrect = clamp(settings.requiredCorrect + 1, 1, 10);
      saveSettings();
      renderAlarmForm();
    });

    els.alarmCategories.addEventListener("change", (event) => onCategoryChange(els.alarmCategories, "categories", event));
    els.studyCategories.addEventListener("change", (event) =>
      onCategoryChange(els.studyCategories, "studyCategories", event),
    );
    els.studyTopic.addEventListener("change", renderStudy);

    els.nightBtn.addEventListener("click", openNight);
    els.testBtn.addEventListener("click", () => {
      primeAudio();
      startAlarm(true);
    });

    els.quickButtons.forEach((button) => button.addEventListener("click", () => startQuick(button.dataset.quick)));
    els.studyStart.addEventListener("click", () => {
      const countInput = document.querySelector('input[name="studyCount"]:checked');
      startStudy({
        categories: settings.studyCategories,
        topic: els.studyTopic.value || null,
        count: countInput ? countInput.value : 10,
      });
    });

    els.resetStats.addEventListener("click", () =>
      confirmSheet("学習記録をリセット", "正誤の記録と起床回数を消去します。設定は残ります。", "リセットする", () => {
        stats = { q: {}, wakeups: 0 };
        saveStats();
        renderAll();
        toast("学習記録をリセットしました");
      }),
    );

    els.optExamFocus.addEventListener("change", () => {
      settings.examFocus = els.optExamFocus.checked;
      saveSettings();
      renderAll();
    });
    els.optRamp.addEventListener("change", () => {
      settings.rampVolume = els.optRamp.checked;
      saveSettings();
    });
    els.optVibrate.addEventListener("change", () => {
      settings.vibrate = els.optVibrate.checked;
      saveSettings();
      if (settings.vibrate && navigator.vibrate) navigator.vibrate(80);
    });
    els.optKeepAwake.addEventListener("change", () => {
      settings.keepAwake = els.optKeepAwake.checked;
      saveSettings();
      syncWakeLock();
    });

    els.soundPreview.addEventListener("click", previewSound);
    els.notifyBtn.addEventListener("click", () => {
      if (!("Notification" in window)) return;
      Promise.resolve(Notification.requestPermission())
        .catch(() => {})
        .then(renderNotify);
    });
    els.installBtn.addEventListener("click", async () => {
      if (!ui.deferredInstall) return;
      ui.deferredInstall.prompt();
      await ui.deferredInstall.userChoice.catch(() => {});
      ui.deferredInstall = null;
      renderSettings();
    });
    els.resetAll.addEventListener("click", () =>
      confirmSheet("すべてのデータを初期化", "設定・アラーム・学習記録をすべて消去します。元に戻せません。", "初期化する", () => {
        Object.values(STORAGE).forEach(removeKey);
        location.reload();
      }),
    );

    els.answerForm.addEventListener("submit", onQuizSubmit);
    els.qOptions.addEventListener("change", syncSelectedOptions);
    els.qInput.addEventListener("input", updateQuizAction);
    els.quizClose.addEventListener("click", requestCloseStudy);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing || !quiz.open) return;
      if (!(quiz.answered || quiz.finished) || document.activeElement === els.quizAction) return;
      event.preventDefault();
      els.quizAction.click();
    });

    els.night.addEventListener("pointerdown", wakeNightControls);
    els.nightExit.addEventListener("click", () => closeNight());

    els.sheet.addEventListener("click", (event) => {
      if (event.target === els.sheet) closeSheet();
    });

    // ユーザー操作のたびに音声の再生許可を確保し、鳴動中なら止まった音を再開する
    const onGesture = () => {
      primeAudio();
      resumeSoundIfNeeded();
    };
    document.addEventListener("click", onGesture, true);
    document.addEventListener("touchend", onGesture, true);
    document.addEventListener("keydown", onGesture, true);

    window.addEventListener("popstate", onPopState);
    window.addEventListener("pageshow", tick);
    window.addEventListener("beforeunload", (event) => {
      if (!runtime.ringing) return;
      event.preventDefault();
      event.returnValue = "";
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        tick();
        resumeSoundIfNeeded();
      } else if (runtime.ringing) {
        notifyAlarm();
      }
      syncWakeLock();
    });

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      ui.deferredInstall = event;
      renderSettings();
    });
    window.addEventListener("appinstalled", () => {
      ui.deferredInstall = null;
      renderSettings();
    });

    window.addEventListener("storage", (event) => {
      // 別タブでの変更を反映
      if (event.key === STORAGE.settings) settings = loadSettings();
      if (event.key === STORAGE.runtime) runtime = loadRuntime();
      if (event.key === STORAGE.stats) stats = loadStats();
      renderAll();
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  function init() {
    buildWeekdays();
    buildCategoryChips(els.alarmCategories, "alarmCategory");
    buildCategoryChips(els.studyCategories, "studyCategory");
    bindEvents();

    if (settings.enabled && !runtime.nextAlarmAt && !runtime.ringing) scheduleNext();
    if (!settings.enabled && runtime.nextAlarmAt) {
      runtime.nextAlarmAt = null;
      saveRuntime();
    }

    const restoring = Boolean(runtime.ringing);
    renderAll();
    if (restoring) enterAlarmUI(true);
    tick();
    window.setInterval(tick, 1000);
    syncWakeLock();
    registerServiceWorker();
  }

  init();
})();
