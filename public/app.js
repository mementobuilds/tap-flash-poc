const TOTAL_ROUNDS = 5;
const STORAGE_KEY = 'tap-flash-best-average';
const PLAYER_NAME_KEY = 'tap-flash-player-name-v1';
const INTRO_SEEN_KEY = 'tap-flash-intro-seen-v1';
const LEADERBOARD_LIMIT = 10;
const EARLY_CLICK_PENALTY_MS = 100;

const BOARD_DEFINITIONS = {
  daily: {
    key: 'daily',
    label: 'Daily',
    detail: 'Last 24 hours',
    emptyText: 'No scores in the last 24 hours yet. Be the first.'
  },
  weekly: {
    key: 'weekly',
    label: 'Weekly',
    detail: 'Last 7 days',
    emptyText: 'No scores in the last 7 days yet. Set the pace.'
  },
  allTime: {
    key: 'allTime',
    label: 'All-time',
    detail: 'Best ever',
    emptyText: 'No all-time scores yet. Make history.'
  }
};

const arenaButton = document.getElementById('arenaButton');
const restartButton = document.getElementById('restartButton');
const statusMessage = document.getElementById('statusMessage');
const roundDisplay = document.getElementById('roundDisplay');
const averageDisplay = document.getElementById('averageDisplay');
const bestDisplay = document.getElementById('bestDisplay');
const penaltyDisplay = document.getElementById('penaltyDisplay');
const lastResult = document.getElementById('lastResult');
const leaderboardForm = document.getElementById('leaderboardForm');
const initialsInput = document.getElementById('initialsInput');
const qualifyingScore = document.getElementById('qualifyingScore');
const leaderboardMessage = document.getElementById('leaderboardMessage');
const qualifyingBoards = document.getElementById('qualifyingBoards');
const saveScoreButton = document.getElementById('saveScoreButton');
const introModal = document.getElementById('introModal');
const introDismissButton = document.getElementById('introDismissButton');
const reopenIntroButton = document.getElementById('reopenIntroButton');

const boardElements = {
  daily: {
    list: document.getElementById('dailyLeaderboardList'),
    empty: document.getElementById('dailyLeaderboardEmpty')
  },
  weekly: {
    list: document.getElementById('weeklyLeaderboardList'),
    empty: document.getElementById('weeklyLeaderboardEmpty')
  },
  allTime: {
    list: document.getElementById('allTimeLeaderboardList'),
    empty: document.getElementById('allTimeLeaderboardEmpty')
  }
};

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
  penaltyTotal: 0,
  bestAverage: loadBestAverage(),
  rememberedName: loadRememberedName(),
  leaderboards: emptyLeaderboardPayload(),
  pendingEntry: null,
  leaderboardLoaded: false,
  isSavingScore: false,
  runCounter: 0
};

updateBestDisplay();
updatePenaltyDisplay();
renderLeaderboards();
refreshLeaderboard();
setArenaState('idle', 'Start game');

arenaButton.addEventListener('click', handleArenaClick);
restartButton.addEventListener('click', resetGame);
leaderboardForm.addEventListener('submit', handleLeaderboardSubmit);
initialsInput.addEventListener('input', () => {
  initialsInput.value = sanitizeInitials(initialsInput.value);
});
introDismissButton.addEventListener('click', () => dismissIntro(true));
reopenIntroButton.addEventListener('click', () => showIntro());
introModal.addEventListener('click', (event) => {
  if (event.target === introModal) {
    dismissIntro(true);
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !introModal.classList.contains('hidden')) {
    dismissIntro(true);
  }
});

if (!localStorage.getItem(INTRO_SEEN_KEY)) {
  showIntro();
}

function handleArenaClick() {
  if (!introModal.classList.contains('hidden')) {
    dismissIntro(true);
  }

  ensureAudio();

  if (state.phase === 'finished') {
    resetGame();
    beginRound();
    return;
  }

  if (state.phase === 'idle') {
    beginRound();
    return;
  }

  if (state.phase === 'waiting') {
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
    state.penaltyTotal += EARLY_CLICK_PENALTY_MS;
    updatePenaltyDisplay();
    playTone('early');
    setArenaState('too-soon', 'Too soon');
    statusMessage.textContent = `Too early. +${EARLY_CLICK_PENALTY_MS} ms penalty.`;
    lastResult.textContent = `Early click penalty applied. Total penalties: +${state.penaltyTotal} ms.`;
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
  averageDisplay.textContent = `${Math.round(getScoreAverage())} ms`;
  statusMessage.textContent = state.scores.length === TOTAL_ROUNDS
    ? 'Run complete.'
    : 'Nice. Tap to start the next round.';
  setArenaState('idle', state.scores.length === TOTAL_ROUNDS ? 'See results' : 'Tap to start next round');

  if (state.scores.length === TOTAL_ROUNDS) {
    finishGame();
  }
}

async function finishGame() {
  const average = Math.round(getScoreAverage());
  state.phase = 'finished';
  state.runCounter += 1;
  state.pendingEntry = null;
  statusMessage.textContent = average < 260
    ? 'Ridiculously fast.'
    : average < 340
      ? 'Sharp reflexes.'
      : 'Solid run.';

  averageDisplay.textContent = `${average} ms`;
  lastResult.textContent = state.penaltyTotal > 0
    ? `Final average: ${average} ms across ${TOTAL_ROUNDS} rounds, including +${state.penaltyTotal} ms in penalties.`
    : `Final average: ${average} ms across ${TOTAL_ROUNDS} rounds.`;
  setArenaState('idle', 'Play again');
  restartButton.classList.remove('hidden');

  if (state.bestAverage === null || average < state.bestAverage) {
    state.bestAverage = average;
    localStorage.setItem(STORAGE_KEY, String(average));
    bestDisplay.textContent = `${average} ms`;
  }

  await maybeQualifyForLeaderboard(average);
}

function resetGame() {
  clearTimeout(state.timeoutId);
  state.phase = 'idle';
  state.round = 0;
  state.timeoutId = null;
  state.reactionStart = 0;
  state.scores = [];
  state.penaltyTotal = 0;
  state.pendingEntry = null;
  roundDisplay.textContent = `0 / ${TOTAL_ROUNDS}`;
  averageDisplay.textContent = '—';
  updatePenaltyDisplay();
  statusMessage.textContent = 'Press start when you\'re ready.';
  lastResult.textContent = 'No rounds played yet.';
  restartButton.classList.add('hidden');
  leaderboardForm.classList.add('hidden');
  leaderboardMessage.textContent = '';
  qualifyingBoards.textContent = '';
  initialsInput.value = state.rememberedName || '';
  setSaveState(false);
  setArenaState('idle', 'Start game');
  renderLeaderboards();
}

function setArenaState(phase, label) {
  arenaButton.className = `arena ${phase}`;
  arenaButton.textContent = label;
}

function showIntro() {
  introModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function dismissIntro(markSeen = false) {
  introModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  if (markSeen) {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
  }
}

function getAverage(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getScoreAverage() {
  if (!state.scores.length) return 0;
  return getAverage(state.scores) + state.penaltyTotal;
}

function loadBestAverage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function loadRememberedName() {
  const raw = sessionStorage.getItem(PLAYER_NAME_KEY);
  const name = sanitizeInitials(raw || '');
  return name.length === 3 ? name : null;
}

function rememberName(name) {
  const sanitized = sanitizeInitials(name);
  if (sanitized.length !== 3) return;
  state.rememberedName = sanitized;
  sessionStorage.setItem(PLAYER_NAME_KEY, sanitized);
}

function updateBestDisplay() {
  bestDisplay.textContent = state.bestAverage === null ? '—' : `${state.bestAverage} ms`;
}

function updatePenaltyDisplay() {
  penaltyDisplay.textContent = `+${state.penaltyTotal} ms`;
}

function setSaveState(isSaving) {
  state.isSavingScore = isSaving;
  saveScoreButton.disabled = isSaving;
  saveScoreButton.textContent = isSaving ? 'Saving…' : 'Save score';
}

function emptyLeaderboardPayload() {
  return {
    generatedAt: null,
    leaderboards: Object.fromEntries(
      Object.entries(BOARD_DEFINITIONS).map(([key, definition]) => [key, {
        key,
        label: definition.label,
        detail: definition.detail,
        entries: []
      }])
    )
  };
}

function normalizeLeaderboardPayload(payload) {
  if (payload && payload.leaderboards && payload.leaderboards.daily && payload.leaderboards.weekly && payload.leaderboards.allTime) {
    return {
      generatedAt: payload.generatedAt || null,
      leaderboards: payload.leaderboards
    };
  }

  if (payload && Array.isArray(payload.entries)) {
    const fallback = emptyLeaderboardPayload();
    fallback.leaderboards.daily.entries = payload.entries;
    return fallback;
  }

  return emptyLeaderboardPayload();
}

async function refreshLeaderboard() {
  try {
    const response = await fetch('/api/leaderboard', {
      headers: { 'cache-control': 'no-cache' }
    });
    if (!response.ok) throw new Error('Could not load leaderboard');
    state.leaderboards = normalizeLeaderboardPayload(await response.json());
    state.leaderboardLoaded = true;
    renderLeaderboards();
  } catch {
    leaderboardMessage.textContent = 'Leaderboards unavailable right now.';
  }
}

function renderLeaderboards() {
  Object.entries(BOARD_DEFINITIONS).forEach(([key, definition]) => {
    const board = state.leaderboards.leaderboards[key] || { entries: [] };
    const elements = boardElements[key];
    elements.list.innerHTML = '';

    if (!board.entries.length) {
      elements.empty.textContent = definition.emptyText;
      elements.empty.classList.remove('hidden');
      elements.list.classList.add('hidden');
      return;
    }

    elements.empty.classList.add('hidden');
    elements.list.classList.remove('hidden');

    board.entries.forEach((entry, index) => {
      const item = document.createElement('li');
      item.className = 'leaderboard-item';
      item.innerHTML = `
        <span class="leaderboard-rank">#${index + 1}</span>
        <span class="leaderboard-name">${entry.name}</span>
        <strong class="leaderboard-score">${entry.score} ms</strong>
      `;
      elements.list.appendChild(item);
    });
  });

  if (!state.pendingEntry) {
    leaderboardForm.classList.add('hidden');
  }
}

function scoreQualifies(score, entries) {
  if (entries.length < LEADERBOARD_LIMIT) return true;
  return score < entries[entries.length - 1].score;
}

async function maybeQualifyForLeaderboard(score) {
  await refreshLeaderboard();
  const qualifyingKeys = Object.keys(BOARD_DEFINITIONS)
    .filter((key) => scoreQualifies(score, state.leaderboards.leaderboards[key]?.entries || []));

  if (qualifyingKeys.length) {
    state.pendingEntry = {
      score,
      qualifyingKeys,
      runId: state.runCounter,
      submitted: false
    };

    if (state.rememberedName) {
      leaderboardMessage.textContent = `Using remembered name ${state.rememberedName} for this score.`;
      await submitLeaderboardEntry(state.rememberedName);
      return;
    }

    qualifyingScore.textContent = `${score} ms`;
    qualifyingBoards.textContent = humanizeBoardNames(qualifyingKeys);
    leaderboardMessage.textContent = qualifyingKeys.length === 1
      ? `You cracked the ${humanizeBoardNames(qualifyingKeys)} board. Add your 3-letter name.`
      : `You landed on the ${humanizeBoardNames(qualifyingKeys)} boards. Add your 3-letter name.`;
    leaderboardForm.classList.remove('hidden');
    initialsInput.value = state.rememberedName || '';
    initialsInput.focus();
    return;
  }

  leaderboardForm.classList.add('hidden');
  qualifyingBoards.textContent = '';
  leaderboardMessage.textContent = `Score ${score} ms did not reach the live leaderboards.`;
}

async function handleLeaderboardSubmit(event) {
  event.preventDefault();
  if (!state.pendingEntry) return;

  const name = sanitizeInitials(initialsInput.value);
  if (name.length !== 3) {
    leaderboardMessage.textContent = 'Enter exactly 3 letters.';
    initialsInput.focus();
    return;
  }

  await submitLeaderboardEntry(name);
}

async function submitLeaderboardEntry(name) {
  if (!state.pendingEntry || state.isSavingScore || state.pendingEntry.submitted) return;

  const pending = state.pendingEntry;
  pending.submitted = true;
  setSaveState(true);

  try {
    const response = await fetch('/api/leaderboard', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        score: pending.score
      })
    });

    const payload = await response.json();
    state.leaderboards = normalizeLeaderboardPayload(payload);
    renderLeaderboards();

    if (!response.ok) {
      leaderboardMessage.textContent = payload.error || 'Could not save score.';
      state.pendingEntry = null;
      qualifyingBoards.textContent = '';
      leaderboardForm.classList.add('hidden');
      return;
    }

    rememberName(name);

    const acceptedBoards = Array.isArray(payload.acceptedBoards) && payload.acceptedBoards.length
      ? payload.acceptedBoards
      : pending.qualifyingKeys;

    leaderboardMessage.textContent = acceptedBoards.length === 1
      ? `${state.rememberedName} added with ${pending.score} ms to the ${humanizeBoardNames(acceptedBoards)} board.`
      : `${state.rememberedName} added with ${pending.score} ms to the ${humanizeBoardNames(acceptedBoards)} boards.`;
    leaderboardForm.classList.add('hidden');
    state.pendingEntry = null;
    qualifyingBoards.textContent = '';
    initialsInput.value = state.rememberedName || '';
    renderLeaderboards();
  } catch {
    if (state.pendingEntry === pending) {
      pending.submitted = false;
    }
    leaderboardMessage.textContent = 'Could not save score right now.';
  } finally {
    setSaveState(false);
  }
}

function humanizeBoardNames(keys) {
  const labels = keys.map((key) => BOARD_DEFINITIONS[key]?.label || key);
  if (labels.length <= 1) return labels[0] || 'leaderboard';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
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
