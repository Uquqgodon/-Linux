(function () {
  "use strict";

  const storageKey = "linuxAlarmDrill.v1";

  const categoryLabels = {
    field: "現場頻出",
    lpic1: "LPIC-1",
    lpic2: "LPIC-2",
    deep: "マニアック",
  };

  const typeLabels = {
    single: "単一選択",
    multi: "複数選択",
    command: "コマンド入力",
  };

  const els = {
    alarmForm: document.querySelector("#alarmForm"),
    alarmTime: document.querySelector("#alarmTime"),
    requiredCorrect: document.querySelector("#requiredCorrect"),
    keepAwake: document.querySelector("#keepAwake"),
    alarmState: document.querySelector("#alarmState"),
    clockNow: document.querySelector("#clockNow"),
    nextAlarmText: document.querySelector("#nextAlarmText"),
    scoreText: document.querySelector("#scoreText"),
    progressBar: document.querySelector("#progressBar"),
    testAlarm: document.querySelector("#testAlarm"),
    sleepScreen: document.querySelector("#sleepScreen"),
    quizScreen: document.querySelector("#quizScreen"),
    questionCategory: document.querySelector("#questionCategory"),
    questionType: document.querySelector("#questionType"),
    questionText: document.querySelector("#questionText"),
    answerForm: document.querySelector("#answerForm"),
    optionsArea: document.querySelector("#optionsArea"),
    commandAnswerWrap: document.querySelector("#commandAnswerWrap"),
    commandAnswer: document.querySelector("#commandAnswer"),
    hintText: document.querySelector("#hintText"),
    feedbackText: document.querySelector("#feedbackText"),
    nextQuestion: document.querySelector("#nextQuestion"),
    installApp: document.querySelector("#installApp"),
  };

  const state = {
    alarmTime: "",
    requiredCorrect: 3,
    keepAwake: true,
    categories: ["field", "lpic1", "lpic2", "deep"],
    ringing: false,
    correctCount: 0,
    currentQuestion: null,
    nextAlarmAt: null,
    answered: false,
    lastQuestionIds: [],
    wakeLock: null,
    deferredInstallPrompt: null,
    audio: {
      context: null,
      gain: null,
      oscillators: [],
      intervalId: null,
    },
  };

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
      if (typeof stored.alarmTime === "string") state.alarmTime = stored.alarmTime;
      if (Number.isInteger(stored.requiredCorrect)) {
        state.requiredCorrect = clamp(stored.requiredCorrect, 1, 10);
      }
      if (typeof stored.keepAwake === "boolean") state.keepAwake = stored.keepAwake;
      if (Array.isArray(stored.categories) && stored.categories.length > 0) {
        state.categories = stored.categories.filter((category) => categoryLabels[category]);
      }
    } catch {
      localStorage.removeItem(storageKey);
    }
  }

  function saveState() {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        alarmTime: state.alarmTime,
        requiredCorrect: state.requiredCorrect,
        keepAwake: state.keepAwake,
        categories: state.categories,
      }),
    );
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function formatClock(date) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function parseAlarmTime(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return { hours, minutes };
  }

  function computeNextAlarmAt() {
    const parsed = parseAlarmTime(state.alarmTime);
    if (!parsed) {
      state.nextAlarmAt = null;
      return;
    }

    const now = new Date();
    const next = new Date(now);
    next.setHours(parsed.hours, parsed.minutes, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    state.nextAlarmAt = next;
  }

  function formatNextAlarm() {
    if (!state.nextAlarmAt) return "時刻を設定してください。";
    const date = state.nextAlarmAt;
    const day = date.toLocaleDateString("ja-JP", {
      month: "numeric",
      day: "numeric",
      weekday: "short",
    });
    return `次回: ${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function syncForm() {
    els.alarmTime.value = state.alarmTime;
    els.requiredCorrect.value = String(state.requiredCorrect);
    els.keepAwake.checked = state.keepAwake;
    document.querySelectorAll('input[name="category"]').forEach((input) => {
      input.checked = state.categories.includes(input.value);
    });
  }

  async function requestWakeLock() {
    if (!state.keepAwake || state.wakeLock || document.visibilityState !== "visible") return;
    if (!("wakeLock" in navigator)) return;

    try {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => {
        state.wakeLock = null;
      });
    } catch {
      state.wakeLock = null;
    }
  }

  function releaseWakeLock() {
    if (!state.wakeLock) return;
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }

  function syncWakeLock() {
    if (state.keepAwake && (state.nextAlarmAt || state.ringing)) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
  }

  function updateStatus() {
    els.clockNow.textContent = formatClock(new Date());
    els.nextAlarmText.textContent = state.ringing ? "問題に正解すると停止します。" : formatNextAlarm();
    els.alarmState.textContent = state.ringing ? "鳴動中" : state.nextAlarmAt ? "予約済み" : "待機中";
    els.alarmState.classList.toggle("active", state.ringing);

    const required = state.requiredCorrect;
    const count = state.correctCount;
    els.scoreText.textContent = `${count} / ${required}`;
    els.progressBar.style.width = `${Math.min(100, (count / required) * 100)}%`;
  }

  function initAudio() {
    if (state.audio.context) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(context.destination);
    state.audio.context = context;
    state.audio.gain = gain;
  }

  async function unlockAudio() {
    initAudio();
    if (state.audio.context && state.audio.context.state === "suspended") {
      await state.audio.context.resume();
    }
  }

  function startTone() {
    initAudio();
    const { context, gain } = state.audio;
    if (!context || !gain || state.audio.oscillators.length > 0) return;

    const low = context.createOscillator();
    const high = context.createOscillator();
    low.type = "square";
    high.type = "sawtooth";
    low.frequency.value = 520;
    high.frequency.value = 780;
    low.connect(gain);
    high.connect(gain);
    low.start();
    high.start();
    state.audio.oscillators = [low, high];

    let loud = false;
    state.audio.intervalId = window.setInterval(() => {
      loud = !loud;
      gain.gain.setTargetAtTime(loud ? 0.16 : 0.03, context.currentTime, 0.025);
    }, 360);
  }

  function stopTone() {
    const { context, gain } = state.audio;
    if (state.audio.intervalId) {
      window.clearInterval(state.audio.intervalId);
      state.audio.intervalId = null;
    }
    if (gain && context) {
      gain.gain.setTargetAtTime(0, context.currentTime, 0.02);
    }
    state.audio.oscillators.forEach((oscillator) => {
      try {
        oscillator.stop();
        oscillator.disconnect();
      } catch {
        // Oscillators can only be stopped once.
      }
    });
    state.audio.oscillators = [];
  }

  function getQuestionPool() {
    const allQuestions = window.LINUX_ALARM_QUESTIONS || [];
    const selected = allQuestions.filter((question) => state.categories.includes(question.category));
    return selected.length > 0 ? selected : allQuestions;
  }

  function pickQuestion() {
    const pool = getQuestionPool();
    const recent = new Set(state.lastQuestionIds);
    const freshPool = pool.filter((question) => !recent.has(question.id));
    const source = freshPool.length > 0 ? freshPool : pool;
    const question = source[Math.floor(Math.random() * source.length)];
    state.lastQuestionIds = [question.id, ...state.lastQuestionIds].slice(0, 8);
    return question;
  }

  function renderQuestion() {
    const question = pickQuestion();
    state.currentQuestion = question;
    state.answered = false;

    els.questionCategory.textContent = categoryLabels[question.category] || question.level;
    els.questionType.textContent = typeLabels[question.type] || question.type;
    els.questionText.textContent = question.text;
    els.hintText.textContent = question.hint;
    els.feedbackText.textContent = "";
    els.feedbackText.className = "feedback";
    els.nextQuestion.disabled = true;
    els.optionsArea.innerHTML = "";
    els.commandAnswer.value = "";

    const isCommand = question.type === "command";
    els.commandAnswerWrap.classList.toggle("hidden", !isCommand);
    els.optionsArea.classList.toggle("hidden", isCommand);

    if (isCommand) {
      window.setTimeout(() => els.commandAnswer.focus(), 50);
      return;
    }

    question.options.forEach((option, index) => {
      const id = `option-${question.id}-${index}`;
      const label = document.createElement("label");
      label.className = "option-row";
      const input = document.createElement("input");
      input.type = question.type === "multi" ? "checkbox" : "radio";
      input.name = "answer";
      input.value = String(index);
      input.id = id;
      const text = document.createElement("span");
      text.textContent = option;
      label.append(input, text);
      els.optionsArea.append(label);
    });
  }

  function normalizeCommand(value) {
    return value
      .trim()
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ");
  }

  function splitCommand(value) {
    const tokens = [];
    let current = "";
    let quote = "";
    for (const char of normalizeCommand(value)) {
      if ((char === "'" || char === '"') && (!quote || quote === char)) {
        quote = quote ? "" : char;
        current += char;
        continue;
      }
      if (char === " " && !quote) {
        if (current) tokens.push(current);
        current = "";
        continue;
      }
      current += char;
    }
    if (current) tokens.push(current);
    return tokens;
  }

  function commandMatches(input, answer, mode) {
    const normalizedInput = normalizeCommand(input);
    const normalizedAnswer = normalizeCommand(answer);
    if (mode === "normalized") return normalizedInput === normalizedAnswer;

    const inputTokens = splitCommand(normalizedInput);
    const answerTokens = splitCommand(normalizedAnswer);
    let index = 0;
    for (const token of inputTokens) {
      if (token === answerTokens[index]) index += 1;
      if (index === answerTokens.length) return true;
    }
    return inputTokens.length === answerTokens.length && index === answerTokens.length;
  }

  function getCorrectAnswerText(question) {
    if (question.type === "command") return question.answers[0];
    return question.answer.map((index) => question.options[index]).join(" / ");
  }

  function evaluateAnswer() {
    const question = state.currentQuestion;
    if (!question || state.answered) return false;

    if (question.type === "command") {
      const input = els.commandAnswer.value;
      return question.answers.some((answer) => commandMatches(input, answer, question.match));
    }

    const checked = Array.from(els.optionsArea.querySelectorAll("input:checked"))
      .map((input) => Number(input.value))
      .sort((a, b) => a - b);
    const correct = [...question.answer].sort((a, b) => a - b);
    return checked.length === correct.length && checked.every((value, index) => value === correct[index]);
  }

  function showQuiz() {
    els.sleepScreen.classList.add("hidden");
    els.quizScreen.classList.remove("hidden");
    renderQuestion();
  }

  function hideQuiz() {
    els.quizScreen.classList.add("hidden");
    els.sleepScreen.classList.remove("hidden");
  }

  function startAlarm() {
    if (state.ringing) return;
    state.ringing = true;
    state.correctCount = 0;
    unlockAudio().then(startTone);
    requestWakeLock();
    showQuiz();
    updateStatus();
  }

  function stopAlarmAfterSolved() {
    state.ringing = false;
    state.correctCount = 0;
    stopTone();
    computeNextAlarmAt();
    hideQuiz();
    updateStatus();
  }

  function handleAlarmForm(event) {
    event.preventDefault();
    const categories = Array.from(document.querySelectorAll('input[name="category"]:checked')).map(
      (input) => input.value,
    );
    state.alarmTime = els.alarmTime.value;
    state.requiredCorrect = clamp(Number(els.requiredCorrect.value), 1, 10);
    state.keepAwake = els.keepAwake.checked;
    state.categories = categories.length > 0 ? categories : ["field", "lpic1", "lpic2", "deep"];
    computeNextAlarmAt();
    saveState();
    syncForm();
    updateStatus();
    unlockAudio();
    syncWakeLock();
  }

  function handleAnswer(event) {
    event.preventDefault();
    if (!state.ringing || !state.currentQuestion || state.answered) return;

    const correct = evaluateAnswer();
    state.answered = true;
    els.nextQuestion.disabled = false;

    if (correct) {
      state.correctCount += 1;
      els.feedbackText.textContent = "正解。";
      els.feedbackText.classList.add("ok");
      if (state.correctCount >= state.requiredCorrect) {
        els.feedbackText.textContent = "停止条件を達成しました。アラームを止めます。";
        window.setTimeout(stopAlarmAfterSolved, 850);
      }
    } else {
      els.feedbackText.textContent = `不正解。正答: ${getCorrectAnswerText(state.currentQuestion)}`;
      els.feedbackText.classList.add("ng");
    }

    updateStatus();
  }

  function tick() {
    const now = new Date();
    els.clockNow.textContent = formatClock(now);
    if (!state.ringing && state.nextAlarmAt && now >= state.nextAlarmAt) {
      startAlarm();
    }
  }

  function bindEvents() {
    els.alarmForm.addEventListener("submit", handleAlarmForm);
    els.answerForm.addEventListener("submit", handleAnswer);
    els.nextQuestion.addEventListener("click", renderQuestion);
    els.testAlarm.addEventListener("click", () => {
      startAlarm();
    });
    els.installApp.addEventListener("click", async () => {
      if (!state.deferredInstallPrompt) return;
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice.catch(() => {});
      state.deferredInstallPrompt = null;
      els.installApp.hidden = true;
    });
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      state.deferredInstallPrompt = event;
      els.installApp.hidden = false;
    });
    window.addEventListener("appinstalled", () => {
      state.deferredInstallPrompt = null;
      els.installApp.hidden = true;
    });
    document.addEventListener("visibilitychange", () => {
      if (state.ringing) unlockAudio().then(startTone);
      syncWakeLock();
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  function init() {
    loadState();
    computeNextAlarmAt();
    syncForm();
    bindEvents();
    registerServiceWorker();
    updateStatus();
    syncWakeLock();
    window.setInterval(tick, 500);
  }

  init();
})();
