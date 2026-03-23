const TOTAL_ROUNDS = 5;
const STORAGE_KEY = 'tap-flash-best-average';

const arenaButton = document.getElementById('arenaButton');
const restartButton = document.getElementById('restartButton');
const themeButton = document.getElementById('themeButton');
const statusMessage = document.getElementById('statusMessage');
const roundDisplay = document.getElementById('roundDisplay');
const averageDisplay = document.getElementById('averageDisplay');
const bestDisplay = document.getElementById('bestDisplay');
const lastResult = document.getElementById('lastResult');

const state = {
  phase: 'idle',
  round: 0,
  reactionStart: 0,
  timeoutId: null,
  scores: [],
  bestAverage: loadBestAverage()
};

updateBestDisplay();
setArenaState('idle', 'Start game');

arenaButton.addEventListener('click', handleArenaClick);
restartButton.addEventListener('click', resetGame);
themeButton.addEventListener('click', () => {
  document.body.classList.toggle('theme-amber');
});

function handleArenaClick() {
  if (state.phase === 'idle' || state.phase === 'finished') {
    beginRound();
    return;
  }

  if (state.phase === 'waiting') {
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
    setArenaState('too-soon', 'Too soon');
    statusMessage.textContent = 'Too early. That round restarts.';
    lastResult.textContent = 'Jumped the flash. Stay cooler next round.';
    window.setTimeout(beginRound, 850);
    return;
  }

  if (state.phase === 'ready') {
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
}

function resetGame() {
  clearTimeout(state.timeoutId);
  state.phase = 'idle';
  state.round = 0;
  state.timeoutId = null;
  state.reactionStart = 0;
  state.scores = [];
  roundDisplay.textContent = `0 / ${TOTAL_ROUNDS}`;
  averageDisplay.textContent = '—';
  statusMessage.textContent = 'Press start when you\'re ready.';
  lastResult.textContent = 'No rounds played yet.';
  restartButton.classList.add('hidden');
  setArenaState('idle', 'Start game');
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
