(() => {
  // State
  let focusMinutes = 25, shortMinutes = 5, longMinutes = 15;
  const durations = {
    focus: focusMinutes * 60,
    short: shortMinutes * 60,
    long: longMinutes * 60
  };
  let currentMode = 'focus';
  let remaining = durations[currentMode];
  let timerInterval = null;
  let isRunning = false;
  let pomodorosCompleted = 0;
  const tasks = [];

  // DOM
  const modeTabs = document.querySelectorAll('.mode-tab');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const timeDisplay = document.querySelector('.time');
  const progressCircle = document.querySelector('.timer-progress');
  const currentTaskSpan = document.querySelector('.task-name');
  const pomodorosCount = document.querySelector('.pomodoros-count');
  const focusInput = document.getElementById('focusInput');
  const shortInput = document.getElementById('shortInput');
  const longInput = document.getElementById('longInput');
  const taskInput = document.getElementById('taskInput');
  const addTaskBtn = document.getElementById('addTaskBtn');
  const taskList = document.getElementById('taskList');

  // Init
  function init() {
    updateDurationFromInputs();
    renderModeUI();
    updateTimeDisplay();
    updateProgressCircle();
    updateCurrentTask();
    renderTasks();
    // Enable audio context on first user interaction
    document.addEventListener('click', () => {
      if (window.AudioContext || window.webkitAudioContext) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
      }
    }, {once:true});
  }

  // Duration handling
  function updateDurationFromInputs() {
    focusMinutes = parseInt(focusInput.value) || 25;
    shortMinutes = parseInt(shortInput.value) || 5;
    longMinutes = parseInt(longInput.value) || 15;
    durations.focus = focusMinutes * 60;
    durations.short = shortMinutes * 60;
    durations.long = longMinutes * 60;
  }

  // UI updates
  function renderModeUI() {
    modeTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.mode === currentMode);
    });
    progressCircle.className = 'timer-progress ' + currentMode;
  }

  function updateTimeDisplay() {
    const mins = String(Math.floor(remaining / 60)).padStart(2,'0');
    const secs = String(remaining % 60).padStart(2,'0');
    timeDisplay.textContent = `${mins}:${secs}`;
  }

  function updateProgressCircle() {
    const total = durations[currentMode];
    const offset = 283 * (remaining / total); // 2*PI*45 ≈ 283
    progressCircle.style.strokeDashoffset = 283 - offset;
  }

  function updateCurrentTask() {
    const task = tasks.find(t => !t.done);
    currentTaskSpan.textContent = task ? task.text : 'No tasks';
  }

  function renderTasks() {
    taskList.innerHTML = '';
    tasks.forEach(t => {
      const li = document.createElement('li');
      li.className = 'task-item';
      li.innerHTML = `
        <button class="toggle-done" aria-label="${t.done ? 'Mark as undone' : 'Mark as done'}">
          ${t.done ? '✔' : '○'}
        </button>
        <span class="task-text ${t.done ? 'done' : ''}">${t.text}</span>
        <button class="delete" aria-label="Delete task">✕</button>
      `;
      li.querySelector('.toggle-done').addEventListener('click', () => {
        t.done = !t.done;
        updateCurrentTask();
        renderTasks();
      });
      li.querySelector('.delete').addEventListener('click', () => {
        const idx = tasks.indexOf(t);
        if (idx > -1) tasks.splice(idx,1);
        updateCurrentTask();
        renderTasks();
      });
      taskList.appendChild(li);
    });
  }

  // Timer control
  function startTimer() {
    if (isRunning) return;
    isRunning = true;
    timerInterval = setInterval(tick, 1000);
  }

  function pauseTimer() {
    if (!isRunning) return;
    isRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function resetTimer() {
    pauseTimer();
    remaining = durations[currentMode];
    updateTimeDisplay();
    updateProgressCircle();
  }

  function tick() {
    if (remaining <= 0) {
      pauseTimer();
      onTimerEnd();
      return;
    }
    remaining--;
    updateTimeDisplay();
    updateProgressCircle();
  }

  function onTimerEnd() {
    // Flash ring
    progressCircle.classList.add('flash');
    setTimeout(() => progressCircle.classList.remove('flash'), 600);
    // Play chime
    playChime();
    // Handle mode transition
    if (currentMode === 'focus') {
      pomodorosCompleted++;
      pomodorosCount.textContent = pomodorosCompleted;
      // Auto suggest break
      if (pomodorosCompleted % 4 === 0) {
        currentMode = 'long';
      } else {
        currentMode = 'short';
      }
    } else {
      // break ended -> back to focus
      currentMode = 'focus';
    }
    remaining = durations[currentMode];
    updateTimeDisplay();
    updateProgressCircle();
    renderModeUI();
    updateCurrentTask();
  }

  // Chime via Web Audio API
  function playChime() {
    if (!(window.AudioContext || window.webkitAudioContext)) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, ctx.currentTime); // A4
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.01);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  }

  // Event listeners
  modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.dataset.mode === currentMode) return;
      pauseTimer();
      currentMode = tab.dataset.mode;
      remaining = durations[currentMode];
      updateTimeDisplay();
      updateProgressCircle();
      renderModeUI();
      updateCurrentTask();
    });
  });

  startBtn.addEventListener('click', startTimer);
  pauseBtn.addEventListener('click', pauseTimer);
  resetBtn.addEventListener('click', resetTimer);

  focusInput.addEventListener('change', updateDurationFromInputs);
  shortInput.addEventListener('change', updateDurationFromInputs);
  longInput.addEventListener('change', updateDurationFromInputs);

  addTaskBtn.addEventListener('click', () => {
    const text = taskInput.value.trim();
    if (text) {
      tasks.push({ id: Date.now(), text, done: false });
      taskInput.value = '';
      updateCurrentTask();
      renderTasks();
    }
  });

  taskInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') addTaskBtn.click();
  });

  // Initialize
  init();
})();
