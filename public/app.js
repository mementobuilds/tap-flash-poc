const TOTAL_ROUNDS = 5;
const STORAGE_KEY = 'tap-flash-best-average';
const LEADERBOARD_KEY = 'tap-flash-daily-leaderboard';
const LEADERBOARD_LIMIT = 10;

const arenaButton = document.getElementById('arenaButton');
const restartButton = document.getElementById('restartButton');
const statusMessage = document.getElementById('statusMessage');
const roundDisplay = document.getElementById('roundDisplay');
const averageDisplay = document.getElementById('averageDisplay');
const bestDisplay = document.getElementById('bestDisplay');
const lastResult = document.getElementById('lastResult');
const leaderboardSection = document.getElementById('leaderboardSection');
const leaderboardList = document.getElementById('leaderboardList');
const leaderboardEmpty = document.getElementById('leaderboardEmpty');
const leaderboardDate = document.getElementById('leaderboardDate');
const leaderboardForm = document.getElementById('leaderboardForm');
const initialsInput = document.getElementById('initialsInput');
const qualifyingScore = document.getElementById('qualifyingScore');
const leaderboardMessage = document.getElementById('leaderboardMessage');

const audioState = {
  context: null,
  enabled: false
};

const state = {
  phase: 'idle',
  round: 0,
  reactionStart: 0,
  timeoutId: null,
  scores: [],
  bestAverage: loadBestAverage(),
  leaderboard: loadLeaderboard(),
  pendingEntry: null
};

updateBestDisplay();
renderLeaderboard();
setArenaState('idle', 'Start game');

arenaButton.addEventListener('click', handleArenaClick);
restartButton.addEventListener('click', resetGame);
leaderboardForm.addEventListener('submit', handleLeaderboardSubmit);
initialsInput.addEventListener('input', () => {
  initialsInput.value = sanitizeInitials(initialsInput.value);
});

function handleArenaClick() {
  ensureAudio();

  if (state.phase === 'idle' || state.phase === 'finished') {
    beginRound();
    return;
  }

  if (state.phase === 'waiting') {
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
    playTone('early');
    setArenaState('too-soon', 'Too soon');
    statusMessage.textContent = 'Too early. That round restarts.';
    lastResult.textContent = 'Jumped the flash. Stay cooler next round.';
    window.setTimeout(beginRound, 850);
    return;
  }

  if (state.phase === 'ready') {
    playTone('tap');
    const reaction = performance.now() - state.reactionStart;
    recordReaction(reaction);
  }
}

function beginRound() {
  if (state.round === 0 && state.scores.length === 0) {
    restartButton.classList.add('hidden');
  }

  if (state.scores.length >= TOTAL_ROUNDS) {
    finishGame();
    return;
  }

  state.phase = 'waiting';
  state.round = state.scores.length + 1;
  roundDisplay.textContent = `${state.round} / ${TOTAL_ROUNDS}`;
  statusMessage.textContent = `Round ${state.round}: wait for the flash.`;
  lastResult.textContent = 'Focus. No early taps.';
  setArenaState('waiting', 'Wait…');

  const delay = 1100 + Math.random() * 2600;
  state.timeoutId = window.setTimeout(() => {
    state.phase = 'ready';
    state.reactionStart = performance.now();
    playTone('ready');
    statusMessage.textContent = 'Tap now.';
    setArenaState('ready', 'TAP');
  }, delay);
}

function recordReaction(reaction) {
  state.scores.push(reaction);
  state.phase = 'idle';
  state.timeoutId = null;

  const rounded = Math.round(reaction);
  lastResult.textContent = `Round ${state.round}: ${rounded} ms`;
  averageDisplay.textContent = `${Math.round(getAverage(state.scores))} ms`;
  statusMessage.textContent = state.scores.length === TOTAL_ROUNDS
    ? 'Run complete.'
    : 'Nice. Tap to start the next round.';
  setArenaState('idle', state.scores.length === TOTAL_ROUNDS ? 'See results' : 'Next round');

  if (state.scores.length === TOTAL_ROUNDS) {
    finishGame();
  }
}

function finishGame() {
  const average = Math.round(getAverage(state.scores));
  state.phase = 'finished';
  state.pendingEntry = null;
  statusMessage.textContent = average < 260
    ? 'Ridiculously fast.'
    : average < 340
      ? 'Sharp reflexes.'
      : 'Solid run.';

  averageDisplay.textContent = `${average} ms`;
  lastResult.textContent = `Final average: ${average} ms across ${TOTAL_ROUNDS} rounds.`;
  setArenaState('idle', 'Play again');
  restartButton.classList.remove('hidden');

  if (state.bestAverage === null || average < state.bestAverage) {
    state.bestAverage = average;
    localStorage.setItem(STORAGE_KEY, String(average));
    bestDisplay.textContent = `${average} ms`;
  }

  maybeQualifyForLeaderboard(average);
}

function resetGame() {
  clearTimeout(state.timeoutId);
  state.phase = 'idle';
  state.round = 0;
  state.timeoutId = null;
  state.reactionStart = 0;
  state.scores = [];
  state.pendingEntry = null;
  roundDisplay.textContent = `0 / ${TOTAL_ROUNDS}`;
  averageDisplay.textContent = '—';
  statusMessage.textContent = 'Press start when you\'re ready.';
  lastResult.textContent = 'No rounds played yet.';
  restartButton.classList.add('hidden');
  leaderboardForm.classList.add('hidden');
  leaderboardMessage.textContent = '';
  initialsInput.value = '';
  setArenaState('idle', 'Start game');
  renderLeaderboard();
}

function setArenaState(phase, label) {
  arenaButton.className = `arena ${phase}`;
  arenaButton.textContent = label;
}

function getAverage(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function loadBestAverage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function updateBestDisplay() {
  bestDisplay.textContent = state.bestAverage === null ? '—' : `${state.bestAverage} ms`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function formatTodayLabel(key) {
  const date = new Date(`${key}T00:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(date);
}

function loadLeaderboard() {
  const key = todayKey();
  const raw = localStorage.getItem(LEADERBOARD_KEY);
  if (!raw) {
    return { date: key, entries: [] };
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.date === key && Array.isArray(parsed.entries)) {
      return {
        date: key,
        entries: parsed.entries
          .filter((entry) => entry && typeof entry.name === 'string' && Number.isFinite(entry.score))
          .slice(0, LEADERBOARD_LIMIT)
      };
    }
  } catch {}

  return { date: key, entries: [] };
}

function saveLeaderboard() {
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(state.leaderboard));
}

function renderLeaderboard() {
  leaderboardDate.textContent = formatTodayLabel(state.leaderboard.date);
  leaderboardList.innerHTML = '';

  if (!state.leaderboard.entries.length) {
    leaderboardEmpty.classList.remove('hidden');
    leaderboardList.classList.add('hidden');
  } else {
    leaderboardEmpty.classList.add('hidden');
    leaderboardList.classList.remove('hidden');

    state.leaderboard.entries.forEach((entry, index) => {
      const item = document.createElement('li');
      item.className = 'leaderboard-item';
      item.innerHTML = `
        <span class="leaderboard-rank">#${index + 1}</span>
        <span class="leaderboard-name">${entry.name}</span>
        <strong class="leaderboard-score">${entry.score} ms</strong>
      `;
      leaderboardList.appendChild(item);
    });
  }

  if (!state.pendingEntry) {
    leaderboardForm.classList.add('hidden');
  }
}

function maybeQualifyForLeaderboard(score) {
  const entries = state.leaderboard.entries;
  const cutoff = entries.length < LEADERBOARD_LIMIT ? Infinity : entries[entries.length - 1].score;

  if (entries.length < LEADERBOARD_LIMIT || score < cutoff) {
    state.pendingEntry = { score };
    qualifyingScore.textContent = `${score} ms`;
    leaderboardMessage.textContent = entries.length < LEADERBOARD_LIMIT
      ? 'New score enters today\'s top 10. Add your 3-letter name.'
      : `You cracked today\'s top 10. Enter your 3-letter name for ${score} ms.`;
    leaderboardForm.classList.remove('hidden');
    initialsInput.value = '';
    initialsInput.focus();
    return;
  }

  leaderboardForm.classList.add('hidden');
  leaderboardMessage.textContent = `Score ${score} ms did not reach today\'s top 10.`;
}

function handleLeaderboardSubmit(event) {
  event.preventDefault();
  if (!state.pendingEntry) return;

  const name = sanitizeInitials(initialsInput.value);
  if (name.length !== 3) {
    leaderboardMessage.textContent = 'Enter exactly 3 letters.';
    initialsInput.focus();
    return;
  }

  state.leaderboard.entries.push({
    name,
    score: state.pendingEntry.score,
    createdAt: new Date().toISOString()
  });
  state.leaderboard.entries.sort((a, b) => a.score - b.score);
  state.leaderboard.entries = state.leaderboard.entries.slice(0, LEADERBOARD_LIMIT);
  saveLeaderboard();

  leaderboardMessage.textContent = `${name} added with ${state.pendingEntry.score} ms.`;
  leaderboardForm.classList.add('hidden');
  state.pendingEntry = null;
  initialsInput.value = '';
  renderLeaderboard();
}

function sanitizeInitials(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
}

function ensureAudio() {
  if (!window.AudioContext && !window.webkitAudioContext) {
    return null;
  }

  if (!audioState.context) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioState.context = new AudioCtx();
  }

  if (audioState.context.state === 'suspended') {
    audioState.context.resume().catch(() => {});
  }

  audioState.enabled = true;
  return audioState.context;
}

function playTone(type) {
  const context = ensureAudio();
  if (!context) return;

  const presets = {
    ready: { frequency: 880, duration: 0.12, volume: 0.03, wave: 'sine' },
    tap: { frequency: 660, duration: 0.08, volume: 0.05, wave: 'triangle' },
    early: { frequency: 220, duration: 0.16, volume: 0.04, wave: 'sawtooth' }
  };

  const preset = presets[type];
  if (!preset) return;

  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = preset.wave;
  oscillator.frequency.setValueAtTime(preset.frequency, now);
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(preset.volume, now + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + preset.duration);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + preset.duration + 0.02);
}
