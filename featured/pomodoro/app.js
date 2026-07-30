/* 专注番茄钟 / Focus Pomodoro
   All state lives in plain JS variables — NO localStorage (the preview runs in a
   sandboxed iframe where Web Storage throws). Fully offline: the end-of-session
   chime is synthesized with the Web Audio API, no audio files. */
(function () {
  "use strict";

  var RING_LEN = 2 * Math.PI * 104; // circumference for r=104

  var MODES = {
    focus: { label: "保持专注", min: 25 },
    short: { label: "短暂放松", min: 5 },
    long:  { label: "好好休息", min: 15 }
  };

  // --- state ---
  var state = {
    mode: "focus",
    durations: { focus: 25, short: 5, long: 15 }, // minutes
    remaining: 25 * 60, // seconds
    total: 25 * 60,
    running: false,
    ticker: null,
    completedFocus: 0, // toward the 4-in-a-row long-break suggestion
    pomodorosToday: 0
  };
  var tasks = [];
  var taskSeq = 0;

  // --- elements ---
  var $ = function (id) { return document.getElementById(id); };
  var appEl = document.querySelector(".scene"); // data-mode lives on .scene
  var timeEl = $("timeDisplay");
  var phaseEl = $("phaseLabel");
  var ringEl = $("ringProgress");
  var ringSvg = document.querySelector(".ring");
  var startBtn = $("startBtn");
  var startLabel = $("startLabel");
  var resetBtn = $("resetBtn");
  var modeButtons = Array.prototype.slice.call(document.querySelectorAll(".mode"));
  var modeInk = $("modeInk");
  var pomoCountEl = $("pomoCount");
  var pomoDotsEl = $("pomoDots");
  var currentTaskText = $("currentTaskText");
  var taskForm = $("taskForm");
  var taskInput = $("taskInput");
  var taskListEl = $("taskList");
  var tasksEmpty = $("tasksEmpty");
  var tasksCount = $("tasksCount");
  var focusMin = $("focusMin");
  var shortMin = $("shortMin");
  var longMin = $("longMin");

  ringEl.style.strokeDasharray = RING_LEN;

  // --- rendering ---
  function fmt(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  function renderTime() {
    timeEl.textContent = fmt(state.remaining);
    var frac = state.total > 0 ? state.remaining / state.total : 0;
    ringEl.style.strokeDashoffset = RING_LEN * (1 - frac);
    document.title = (state.running ? "▶ " : "") + fmt(state.remaining) +
      " · " + MODES[state.mode].label;
  }

  function renderPomoDots() {
    // Four dots show progress within the current cycle toward a long break.
    var lit = state.completedFocus % 4;
    if (lit === 0 && state.completedFocus > 0) lit = 4; // show a full cycle right after the 4th
    pomoDotsEl.innerHTML = "";
    for (var i = 0; i < 4; i++) {
      var dot = document.createElement("i");
      if (i < lit) dot.className = "on";
      pomoDotsEl.appendChild(dot);
    }
  }

  function currentTask() {
    for (var i = 0; i < tasks.length; i++) if (!tasks[i].done) return tasks[i];
    return null;
  }

  function renderCurrentTask() {
    var t = currentTask();
    if (state.mode === "focus") {
      currentTaskText.textContent = t ? t.text : "添加一个任务开始专注";
    } else {
      currentTaskText.textContent = "休息一下，喝口水 ☕";
    }
    // highlight the current task row
    Array.prototype.forEach.call(taskListEl.children, function (li) {
      li.classList.toggle("current", t && li.dataset.id === String(t.id) && state.mode === "focus");
    });
  }

  function positionInk() {
    var active = document.querySelector(".mode.active");
    if (!active) return;
    modeInk.style.width = active.offsetWidth + "px";
    modeInk.style.transform = "translateX(" + (active.offsetLeft - 5) + "px)";
  }

  // --- audio (Web Audio API, offline) ---
  var audioCtx = null;
  function chime() {
    try {
      if (!audioCtx) {
        var Ctx = window.AudioContext || window["webkitAudioContext"];
        audioCtx = new Ctx();
      }
      var now = audioCtx.currentTime;
      var notes = [880, 1108.73, 1318.51]; // A5, C#6, E6 — a bright major triad
      notes.forEach(function (freq, i) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        var t = now + i * 0.14;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.22, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.95);
      });
    } catch (e) { /* audio unavailable — fail silently */ }
  }

  // --- timer control ---
  function setMode(mode) {
    state.mode = mode;
    appEl.setAttribute("data-mode", mode);
    modeButtons.forEach(function (b) {
      var on = b.dataset.mode === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    phaseEl.textContent = MODES[mode].label;
    positionInk();
    stop();
    state.total = state.durations[mode] * 60;
    state.remaining = state.total;
    renderTime();
    renderCurrentTask();
  }

  function tick() {
    if (state.remaining > 0) {
      state.remaining--;
      renderTime();
    }
    if (state.remaining <= 0) complete();
  }

  function start() {
    if (state.running) { stop(); return; }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    state.running = true;
    startLabel.textContent = "暂停";
    startBtn.classList.add("running");
    startBtn.querySelector(".btn-ico").textContent = "❚❚";
    state.ticker = setInterval(tick, 1000);
  }

  function stop() {
    state.running = false;
    startLabel.textContent = "开始";
    startBtn.classList.remove("running");
    startBtn.querySelector(".btn-ico").textContent = "▶";
    if (state.ticker) { clearInterval(state.ticker); state.ticker = null; }
  }

  function reset() {
    // pull in any edited durations
    state.durations.focus = clampInt(focusMin.value, 1, 90, 25);
    state.durations.short = clampInt(shortMin.value, 1, 30, 5);
    state.durations.long = clampInt(longMin.value, 1, 60, 15);
    focusMin.value = state.durations.focus;
    shortMin.value = state.durations.short;
    longMin.value = state.durations.long;
    stop();
    state.total = state.durations[state.mode] * 60;
    state.remaining = state.total;
    renderTime();
  }

  function complete() {
    stop();
    chime();
    ringSvg.classList.add("flash");
    setTimeout(function () { ringSvg.classList.remove("flash"); }, 1200);

    if (state.mode === "focus") {
      state.pomodorosToday++;
      state.completedFocus++;
      pomoCountEl.textContent = state.pomodorosToday;
      renderPomoDots();
      // auto-complete the task we were focusing on
      var t = currentTask();
      if (t) toggleTask(t.id, true);
      if (state.completedFocus % 4 === 0) {
        showToast("🎉 完成 4 个番茄，去长休息一下吧！");
        setMode("long");
      } else {
        showToast("✅ 专注完成，短暂休息片刻");
        setMode("short");
      }
    } else {
      showToast("🍅 休息结束，回到专注");
      setMode("focus");
    }
  }

  function clampInt(v, lo, hi, dflt) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  }

  // --- toast ---
  var toastEl = null, toastTimer = null;
  function showToast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    void toastEl.offsetWidth;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 3200);
  }

  // --- tasks ---
  function renderTasks() {
    var done = 0;
    tasks.forEach(function (t) { if (t.done) done++; });
    tasksCount.textContent = done + " / " + tasks.length;
    tasksEmpty.classList.toggle("hidden", tasks.length > 0);
    renderCurrentTask();
  }

  function addTaskEl(t) {
    var li = document.createElement("li");
    li.className = "task-item" + (t.done ? " done" : "");
    li.dataset.id = t.id;

    var check = document.createElement("button");
    check.className = "task-check";
    check.setAttribute("aria-label", "标记完成 / Toggle done");
    check.addEventListener("click", function () { toggleTask(t.id); });

    var label = document.createElement("span");
    label.className = "task-label";
    label.textContent = t.text;

    var del = document.createElement("button");
    del.className = "task-del";
    del.setAttribute("aria-label", "删除任务 / Delete task");
    del.textContent = "×";
    del.addEventListener("click", function () { removeTask(t.id); });

    li.appendChild(check);
    li.appendChild(label);
    li.appendChild(del);
    taskListEl.appendChild(li);
  }

  function addTask(text) {
    text = text.trim();
    if (!text) return;
    var t = { id: ++taskSeq, text: text, done: false };
    tasks.push(t);
    addTaskEl(t);
    renderTasks();
  }

  function toggleTask(id, forceDone) {
    var li = taskListEl.querySelector('[data-id="' + id + '"]');
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id) {
        tasks[i].done = forceDone === true ? true : !tasks[i].done;
        if (li) li.classList.toggle("done", tasks[i].done);
        break;
      }
    }
    renderTasks();
  }

  function removeTask(id) {
    var li = taskListEl.querySelector('[data-id="' + id + '"]');
    if (li) {
      li.classList.add("leaving");
      setTimeout(function () { if (li.parentNode) li.parentNode.removeChild(li); }, 300);
    }
    tasks = tasks.filter(function (t) { return t.id !== id; });
    renderTasks();
  }

  // --- wire up ---
  modeButtons.forEach(function (b) {
    b.addEventListener("click", function () { setMode(b.dataset.mode); });
  });
  startBtn.addEventListener("click", start);
  resetBtn.addEventListener("click", reset);
  taskForm.addEventListener("submit", function (e) {
    e.preventDefault();
    addTask(taskInput.value);
    taskInput.value = "";
    taskInput.focus();
  });
  window.addEventListener("resize", positionInk);

  // seed with a couple of inviting example tasks
  addTask("写完项目提案初稿");
  addTask("回复重要邮件");

  setMode("focus");
  renderPomoDots();
  // position ink after layout settles
  requestAnimationFrame(positionInk);
  setTimeout(positionInk, 60);
})();
