const TOTAL_ROUNDS = 5;
const STORAGE_KEY_PREFIX = 'tap-flash-best-score';
const PLAYER_NAME_KEY = 'tap-flash-player-name-v1';
const SLICE_HINT_SEEN_KEY = 'tap-flash-slice-hint-seen-v1';
const INTRO_SEEN_KEY = 'tap-flash-intro-seen-v1';
const LEADERBOARD_LIMIT = 10;
const EARLY_CLICK_PENALTY_MS = 100;
const CELEBRATION_GOOD_SCORE_MS = 320;
const SLICE_PERFECT_THRESHOLD_BPS = 50;
const DEFAULT_CHALLENGER_NAME = 'TAP';

const BOARD_DEFINITIONS = {
  daily: {
    key: 'daily',
    label: 'Daily',
    detail: 'Last 24 hours',
    emptyText: 'No scores in this window yet. Be the first.'
  },
  weekly: {
    key: 'weekly',
    label: 'Weekly',
    detail: 'Last 7 days',
    emptyText: 'No scores in this window yet. Set the pace.'
  },
  allTime: {
    key: 'allTime',
    label: 'All-time',
    detail: 'Best ever',
    emptyText: 'No all-time scores yet. Make history.'
  }
};

const GAME_MODES = {
  tap: {
    key: 'tap',
    label: 'Tap Flash',
    heroLabel: 'Reaction mode',
    statusIdle: 'Hold steady, then release when TAP appears.',
    startLabel: 'Hold to start',
    nextLabel: 'Hold for next round',
    resultsLabel: 'Play again',
    roundLabel: 'Round',
    averageLabel: 'Average',
    bestLabel: 'Best ever',
    supportLabel: 'Penalties',
    supportDisplay: (state) => `+${state.penaltyTotal} ms`,
    formatScore: (score) => `${Math.round(score)} ms`,
    shareText: (_name, score, url) => `I got ${Math.round(score)} ms in Tap Flash. Beat me! ${url}`,
    challengeText: (challenger, score) => `${challenger} challenged you to beat ${Math.round(score)} ms. Think you can top it?`,
    qualifyingMessage: (keys) => keys.length === 1
      ? `You cracked the ${humanizeBoardNames(keys)} board. Add your 3-letter name.`
      : `You landed on the ${humanizeBoardNames(keys)} boards. Add your 3-letter name.`
  },
  slice: {
    key: 'slice',
    label: 'Split Fifty',
    heroLabel: 'Split mode',
    statusIdle: 'Drag the dotted line, then lock your cut.',
    startLabel: 'Start Split Fifty',
    nextLabel: 'Next shape',
    resultsLabel: 'Play again',
    roundLabel: 'Round',
    averageLabel: 'Avg off',
    bestLabel: 'Best ever',
    supportLabel: 'Perfect cuts',
    supportDisplay: (state) => String(state.perfectCuts),
    formatScore: (score) => `${(Number(score) / 100).toFixed(2)}% off`,
    shareText: (_name, score, url) => `I got ${(Number(score) / 100).toFixed(2)}% off in Split Fifty. Beat me! ${url}`,
    challengeText: (challenger, score) => `${challenger} challenged you to get closer than ${(Number(score) / 100).toFixed(2)}% off.`,
    qualifyingMessage: (keys) => keys.length === 1
      ? `Nice cut. You cracked the ${humanizeBoardNames(keys)} board. Add your 3-letter name.`
      : `Nice cut. You landed on the ${humanizeBoardNames(keys)} boards. Add your 3-letter name.`
  }
};

const arenaButton = document.getElementById('arenaButton');
const restartButton = document.getElementById('restartButton');
const statusMessage = document.getElementById('statusMessage');
const actionCue = document.getElementById('actionCue');
const roundDisplay = document.getElementById('roundDisplay');
const averageDisplay = document.getElementById('averageDisplay');
const bestDisplay = document.getElementById('bestDisplay');
const penaltyDisplay = document.getElementById('penaltyDisplay');
const roundLabel = document.getElementById('roundLabel');
const averageLabel = document.getElementById('averageLabel');
const bestLabel = document.getElementById('bestLabel');
const penaltyLabel = document.getElementById('penaltyLabel');
const lastResult = document.getElementById('lastResult');
const challengeBanner = document.getElementById('challengeBanner');
const shareChallengeButton = document.getElementById('shareChallengeButton');
const leaderboardForm = document.getElementById('leaderboardForm');
const initialsInput = document.getElementById('initialsInput');
const qualifyingScore = document.getElementById('qualifyingScore');
const leaderboardMessage = document.getElementById('leaderboardMessage');
const qualifyingBoards = document.getElementById('qualifyingBoards');
const saveScoreButton = document.getElementById('saveScoreButton');
const celebrationLayer = document.getElementById('celebrationLayer');
const introModal = document.getElementById('introModal');
const introDismissButton = document.getElementById('introDismissButton');
const reopenIntroButton = document.getElementById('reopenIntroButton');
const postRunReveal = document.getElementById('postRunReveal');
const modeTapButton = document.getElementById('modeTapButton');
const modeSliceButton = document.getElementById('modeSliceButton');
const podiumEyebrow = document.getElementById('podiumEyebrow');
const podiumTitle = document.getElementById('podiumTitle');
const podiumSubtitle = document.getElementById('podiumSubtitle');
const leaderboardEyebrow = document.getElementById('leaderboardEyebrow');
const leaderboardTitle = document.getElementById('leaderboardTitle');
const leaderboardSubtitle = document.getElementById('leaderboardSubtitle');
const sliceArena = document.getElementById('sliceArena');
const sliceBoard = document.getElementById('sliceBoard');
const sliceMoveHint = document.getElementById('sliceMoveHint');
const sliceSvg = document.getElementById('sliceSvg');
const sliceShape = document.getElementById('sliceShape');
const sliceCutLine = document.getElementById('sliceCutLine');
const sliceSubmitButton = document.getElementById('sliceSubmitButton');

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

const podiumElements = [
  { name: document.getElementById('podiumName1'), score: document.getElementById('podiumScore1') },
  { name: document.getElementById('podiumName2'), score: document.getElementById('podiumScore2') },
  { name: document.getElementById('podiumName3'), score: document.getElementById('podiumScore3') }
];

const audioState = {
  context: null,
  enabled: false
};

const initialChallenge = readChallengeContext();

const state = {
  currentMode: initialChallenge?.mode || 'tap',
  phase: 'idle',
  round: 0,
  roundScores: [],
  penaltyTotal: 0,
  perfectCuts: 0,
  bestScores: {
    tap: loadBestScore('tap'),
    slice: loadBestScore('slice')
  },
  rememberedName: loadRememberedName(),
  leaderboards: emptyLeaderboardPayload(),
  pendingEntry: null,
  leaderboardLoaded: false,
  isSavingScore: false,
  runCounter: 0,
  lastCompletedScore: null,
  challengeContext: initialChallenge,
  tap: {
    reactionStart: 0,
    timeoutId: null,
    activePointerId: null,
    suppressNextClick: false
  },
  slice: {
    isDragging: false,
    currentShape: null,
    cutX: 50,
    submittedThisRound: false
  }
};

init();

function init() {
  updateModeUI();
  updateBestDisplay();
  updateAverageDisplay();
  updateSupportDisplay();
  updateShareChallengeButton();
  renderChallengeBanner();
  renderLeaderboards();
  refreshLeaderboard();

  arenaButton.addEventListener('pointerdown', handleArenaPointerDown);
  arenaButton.addEventListener('pointerup', handleArenaPointerUp);
  arenaButton.addEventListener('pointercancel', handleArenaPointerCancel);
  arenaButton.addEventListener('click', handleArenaClick);
  arenaButton.addEventListener('contextmenu', preventDefault);
  arenaButton.addEventListener('selectstart', preventDefault);

  sliceBoard.addEventListener('pointerdown', handleSlicePointerDown);
  sliceBoard.addEventListener('pointermove', handleSlicePointerMove);
  sliceBoard.addEventListener('pointerup', handleSlicePointerUp);
  sliceBoard.addEventListener('pointercancel', handleSlicePointerCancel);
  sliceBoard.addEventListener('contextmenu', preventDefault);
  sliceBoard.addEventListener('selectstart', preventDefault);

  sliceSubmitButton.addEventListener('click', handleSliceSubmit);
  restartButton.addEventListener('click', handleRestart);
  leaderboardForm.addEventListener('submit', handleLeaderboardSubmit);
  initialsInput.addEventListener('input', () => {
    initialsInput.value = sanitizeInitials(initialsInput.value);
  });
  introDismissButton.addEventListener('click', () => dismissIntro(true));
  reopenIntroButton.addEventListener('click', () => showIntro());
  shareChallengeButton.addEventListener('click', handleShareChallenge);
  modeTapButton.addEventListener('click', () => switchMode('tap'));
  modeSliceButton.addEventListener('click', () => switchMode('slice'));

  introModal.addEventListener('click', (event) => {
    if (event.target === introModal) dismissIntro(true);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !introModal.classList.contains('hidden')) dismissIntro(true);
  });

}

function getModeConfig(mode = state.currentMode) {
  return GAME_MODES[mode] || GAME_MODES.tap;
}

function switchMode(mode) {
  if (!GAME_MODES[mode] || state.currentMode === mode) return;
  state.currentMode = mode;
  state.challengeContext = state.challengeContext && state.challengeContext.mode === mode ? state.challengeContext : null;
  resetGame();
  updateModeUI();
  renderChallengeBanner();
  refreshLeaderboard();

  if (mode === 'slice') {
    beginSliceRound();
  }
}

function updateModeUI() {
  const mode = state.currentMode;
  const config = getModeConfig();
  modeTapButton.classList.toggle('active', mode === 'tap');
  modeTapButton.setAttribute('aria-selected', String(mode === 'tap'));
  modeSliceButton.classList.toggle('active', mode === 'slice');
  modeSliceButton.setAttribute('aria-selected', String(mode === 'slice'));

  roundLabel.textContent = config.roundLabel;
  averageLabel.textContent = config.averageLabel;
  bestLabel.textContent = config.bestLabel;
  penaltyLabel.textContent = config.supportLabel;

  arenaButton.classList.toggle('hidden', mode !== 'tap');
  sliceArena.classList.toggle('hidden', mode !== 'slice');

  if (mode === 'tap') {
    setArenaState(state.phase === 'finished' ? 'idle' : state.phase, state.phase === 'finished' ? config.resultsLabel : (state.phase === 'idle' ? config.startLabel : arenaButton.textContent));
  } else {
    sliceSubmitButton.textContent = state.phase === 'idle' ? config.startLabel : (state.phase === 'finished' ? config.resultsLabel : 'Lock cut');
  }

  updateSectionTitles();
  updateBestDisplay();
  updateAverageDisplay();
  updateSupportDisplay();
  updateShareChallengeButton();
  updateSliceMoveHint();
  updateActionCue();
}

function updateActionCue() {
  if (state.currentMode === 'tap') {
    if (state.phase === 'waiting') {
      actionCue.textContent = 'HOLD';
      return;
    }
    if (state.phase === 'ready') {
      actionCue.textContent = 'RELEASE!';
      return;
    }
    if (state.phase === 'finished') {
      actionCue.textContent = 'NICE RUN';
      return;
    }
    actionCue.textContent = 'HOLD TO START';
    return;
  }

  if (state.phase === 'playing') {
    actionCue.textContent = 'DRAG + LOCK CUT';
    return;
  }
  if (state.phase === 'finished') {
    actionCue.textContent = 'NICE CUT';
    return;
  }
  actionCue.textContent = 'DRAG THE LINE';
}

function dismissIntroIfOpen() {
  if (!introModal.classList.contains('hidden')) dismissIntro(true);
}

function preventDefault(event) {
  event.preventDefault();
}

function handleArenaPointerDown(event) {
  if (state.currentMode !== 'tap') return;
  dismissIntroIfOpen();
  ensureAudio();
  state.tap.activePointerId = event.pointerId;
  state.tap.suppressNextClick = true;

  if (typeof arenaButton.setPointerCapture === 'function') {
    try { arenaButton.setPointerCapture(event.pointerId); } catch {}
  }

  if (state.phase === 'finished') {
    resetGame();
    beginTapRound();
    return;
  }

  if (state.phase === 'idle') beginTapRound();
}

function handleArenaPointerUp(event) {
  if (state.currentMode !== 'tap') return;
  if (state.tap.activePointerId !== null && event.pointerId !== state.tap.activePointerId) return;
  releaseArenaHold(event.pointerId);

  if (state.phase === 'waiting') {
    applyEarlyReleasePenalty();
    return;
  }

  if (state.phase === 'ready') {
    playTone('tap');
    const reaction = performance.now() - state.tap.reactionStart;
    recordTapReaction(reaction);
  }
}

function handleArenaPointerCancel(event) {
  if (state.currentMode !== 'tap') return;
  if (state.tap.activePointerId !== null && event.pointerId !== state.tap.activePointerId) return;
  releaseArenaHold(event.pointerId);
}

function handleArenaClick(event) {
  if (state.currentMode !== 'tap') return;
  dismissIntroIfOpen();
  ensureAudio();

  if (state.tap.suppressNextClick) {
    state.tap.suppressNextClick = false;
    return;
  }

  if (event.detail !== 0) return;

  if (state.phase === 'finished') {
    resetGame();
    beginTapRound();
    return;
  }

  if (state.phase === 'idle') {
    beginTapRound();
    return;
  }

  if (state.phase === 'waiting') {
    applyEarlyReleasePenalty();
    return;
  }

  if (state.phase === 'ready') {
    playTone('tap');
    const reaction = performance.now() - state.tap.reactionStart;
    recordTapReaction(reaction);
  }
}

function releaseArenaHold(pointerId = null) {
  if (pointerId !== null && typeof arenaButton.releasePointerCapture === 'function') {
    try {
      if (arenaButton.hasPointerCapture?.(pointerId)) arenaButton.releasePointerCapture(pointerId);
    } catch {}
  }
  state.tap.activePointerId = null;
}

function applyEarlyReleasePenalty() {
  clearTimeout(state.tap.timeoutId);
  state.tap.timeoutId = null;
  state.penaltyTotal += EARLY_CLICK_PENALTY_MS;
  updateSupportDisplay();
  playTone('early');
  setArenaState('too-soon', 'Too soon');
  statusMessage.textContent = `Too early. +${EARLY_CLICK_PENALTY_MS} ms penalty.`;
  lastResult.textContent = `Released too early. Total penalties: +${state.penaltyTotal} ms.`;
  window.setTimeout(beginTapRound, 850);
}

function beginTapRound() {
  if (state.round === 0 && state.roundScores.length === 0) restartButton.classList.add('hidden');
  if (state.roundScores.length >= TOTAL_ROUNDS) {
    finishGame();
    return;
  }

  state.phase = 'waiting';
  state.round = state.roundScores.length + 1;
  roundDisplay.textContent = `${state.round} / ${TOTAL_ROUNDS}`;
  statusMessage.textContent = `Round ${state.round}: press and hold, then release on TAP.`;
  lastResult.textContent = 'Hold steady. Releasing early adds a penalty.';
  setArenaState('waiting', 'Hold…');

  const delay = 1100 + Math.random() * 2600;
  state.tap.timeoutId = window.setTimeout(() => {
    state.phase = 'ready';
    state.tap.reactionStart = performance.now();
    playTone('ready');
    statusMessage.textContent = 'Release now.';
    setArenaState('ready', 'TAP');
  }, delay);
}

function recordTapReaction(reaction) {
  state.roundScores.push(reaction);
  state.phase = 'idle';
  state.tap.timeoutId = null;

  const rounded = Math.round(reaction);
  lastResult.textContent = `Round ${state.round}: ${rounded} ms`;
  updateAverageDisplay();
  statusMessage.textContent = state.roundScores.length === TOTAL_ROUNDS
    ? 'Run complete.'
    : 'Nice. Press and hold to start the next round.';
  setArenaState('idle', state.roundScores.length === TOTAL_ROUNDS ? getModeConfig().resultsLabel : getModeConfig().nextLabel);

  if (state.roundScores.length === TOTAL_ROUNDS) finishGame();
}

function handleSliceSubmit() {
  if (state.currentMode !== 'slice') return;
  dismissIntroIfOpen();

  if (state.phase === 'finished') {
    resetGame();
    beginSliceRound();
    return;
  }

  if (state.phase === 'idle') {
    beginSliceRound();
    return;
  }

  if (state.phase === 'playing') {
    submitSliceCut();
  }
}

function handleSlicePointerDown(event) {
  if (state.currentMode !== 'slice' || state.phase !== 'playing') return;
  dismissIntroIfOpen();
  state.slice.isDragging = true;
  markSliceHintSeen();
  if (typeof sliceBoard.setPointerCapture === 'function') {
    try { sliceBoard.setPointerCapture(event.pointerId); } catch {}
  }
  updateSliceCutFromEvent(event);
}

function handleSlicePointerMove(event) {
  if (state.currentMode !== 'slice' || !state.slice.isDragging || state.phase !== 'playing') return;
  updateSliceCutFromEvent(event);
}

function handleSlicePointerUp(event) {
  if (state.currentMode !== 'slice') return;
  if (state.slice.isDragging) updateSliceCutFromEvent(event);
  state.slice.isDragging = false;
  if (typeof sliceBoard.releasePointerCapture === 'function') {
    try { if (sliceBoard.hasPointerCapture?.(event.pointerId)) sliceBoard.releasePointerCapture(event.pointerId); } catch {}
  }
}

function handleSlicePointerCancel(event) {
  handleSlicePointerUp(event);
}

function updateSliceCutFromEvent(event) {
  const rect = sliceBoard.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  state.slice.cutX = clamp(x, 12, 88);
  renderSliceBoard();
}

function beginSliceRound() {
  if (state.round === 0 && state.roundScores.length === 0) restartButton.classList.add('hidden');
  if (state.roundScores.length >= TOTAL_ROUNDS) {
    finishGame();
    return;
  }

  state.phase = 'playing';
  state.round = state.roundScores.length + 1;
  state.slice.currentShape = generateSliceShape();
  state.slice.cutX = 50;
  roundDisplay.textContent = `${state.round} / ${TOTAL_ROUNDS}`;
  statusMessage.textContent = `Round ${state.round}: drag the line and try to split the shape 50:50.`;
  lastResult.textContent = state.round === 1 && state.roundScores.length === 0
    ? 'Drag the dotted line, then tap Lock cut.'
    : 'Closer to 50:50 is better.';
  sliceSubmitButton.textContent = 'Lock cut';
  updateActionCue();
  renderSliceBoard();
}

function submitSliceCut() {
  if (!state.slice.currentShape) return;

  const totalArea = Math.abs(polygonArea(state.slice.currentShape));
  const leftPoly = clipPolygonAgainstVerticalLine(state.slice.currentShape, state.slice.cutX, 'left');
  const leftArea = Math.abs(polygonArea(leftPoly));
  const leftRatio = totalArea > 0 ? leftArea / totalArea : 0.5;
  const deviationPercent = Math.abs(leftRatio - 0.5) * 200;
  const score = Math.round(deviationPercent * 100);

  state.roundScores.push(score);
  state.phase = 'idle';
  if (score <= SLICE_PERFECT_THRESHOLD_BPS) state.perfectCuts += 1;

  const leftPct = (leftRatio * 100).toFixed(1);
  const rightPct = ((1 - leftRatio) * 100).toFixed(1);
  lastResult.textContent = `Round ${state.round}: ${leftPct}% / ${rightPct}% split, ${formatScore(score)}.`;
  updateAverageDisplay();
  updateSupportDisplay();
  statusMessage.textContent = state.roundScores.length === TOTAL_ROUNDS
    ? 'Run complete.'
    : 'Nice cut. Tap Next shape when you want another one.';
  sliceSubmitButton.textContent = state.roundScores.length === TOTAL_ROUNDS ? getModeConfig().resultsLabel : getModeConfig().nextLabel;
  updateActionCue();

  if (score <= 250) {
    celebrate({ intensity: score <= 100 ? 'big' : 'medium' });
  }

  if (state.roundScores.length === TOTAL_ROUNDS) {
    finishGame();
  }
}

async function finishGame() {
  const average = Math.round(getScoreAverage());
  state.phase = 'finished';
  state.runCounter += 1;
  state.pendingEntry = null;

  if (state.currentMode === 'tap') {
    statusMessage.textContent = average < 260 ? 'Ridiculously fast.' : average < 340 ? 'Sharp reflexes.' : 'Solid run.';
    lastResult.textContent = state.penaltyTotal > 0
      ? `Final average: ${formatScore(average)} across ${TOTAL_ROUNDS} rounds, including +${state.penaltyTotal} ms total in penalties.`
      : `Final average: ${formatScore(average)} across ${TOTAL_ROUNDS} rounds.`;
    setArenaState('idle', getModeConfig().resultsLabel);
  } else {
    statusMessage.textContent = average <= 150 ? 'That was surgical.' : average <= 300 ? 'Clean slicing.' : 'Not bad. You can get even closer.';
    lastResult.textContent = `Final average: ${formatScore(average)} across ${TOTAL_ROUNDS} cuts. Perfect cuts: ${state.perfectCuts}.`;
    sliceSubmitButton.textContent = getModeConfig().resultsLabel;
    updateActionCue();
  }

  state.lastCompletedScore = average;
  updateAverageDisplay(average);
  updateShareChallengeButton();
  showPostRunReveal();
  restartButton.classList.remove('hidden');

  if (state.currentMode === 'tap' && average <= CELEBRATION_GOOD_SCORE_MS) {
    celebrate({ intensity: average < 260 ? 'big' : 'medium' });
  }

  if (state.bestScores[state.currentMode] === null || average < state.bestScores[state.currentMode]) {
    state.bestScores[state.currentMode] = average;
    saveBestScore(state.currentMode, average);
    updateBestDisplay();
  }

  await maybeQualifyForLeaderboard(average);
}

function handleRestart() {
  resetGame();
}

function resetGame() {
  clearTimeout(state.tap.timeoutId);
  state.phase = 'idle';
  state.round = 0;
  state.tap.timeoutId = null;
  state.tap.reactionStart = 0;
  state.tap.activePointerId = null;
  state.roundScores = [];
  state.penaltyTotal = 0;
  state.perfectCuts = 0;
  state.pendingEntry = null;
  state.lastCompletedScore = null;
  state.slice.currentShape = null;
  state.slice.cutX = 50;
  state.slice.isDragging = false;
  roundDisplay.textContent = `0 / ${TOTAL_ROUNDS}`;
  updateAverageDisplay(0);
  updateSupportDisplay();
  statusMessage.textContent = getModeConfig().statusIdle;
  lastResult.textContent = 'No rounds played yet.';
  restartButton.classList.add('hidden');
  leaderboardForm.classList.add('hidden');
  leaderboardMessage.textContent = '';
  qualifyingBoards.textContent = '';
  initialsInput.value = state.rememberedName || '';
  setSaveState(false);
  hidePostRunReveal();
  updateShareChallengeButton();
  updateModeUI();
  if (state.currentMode === 'tap') {
    setArenaState('idle', getModeConfig().startLabel);
  } else {
    sliceSubmitButton.textContent = getModeConfig().startLabel;
    renderSliceBoard();
  }
  renderLeaderboards();
}

function setArenaState(phase, label) {
  arenaButton.className = `arena ${phase}`;
  arenaButton.textContent = label;
  updateActionCue();
}

function showIntro() {
  introModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function showPostRunReveal() {
  postRunReveal.classList.remove('hidden');
}

function hidePostRunReveal() {
  postRunReveal.classList.add('hidden');
}

function dismissIntro(markSeen = false) {
  introModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  if (markSeen) localStorage.setItem(INTRO_SEEN_KEY, '1');
}

function getAverage(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getScoreAverage() {
  if (!state.roundScores.length) return 0;
  if (state.currentMode === 'tap') {
    const totalReaction = state.roundScores.reduce((sum, value) => sum + value, 0);
    return (totalReaction + state.penaltyTotal) / state.roundScores.length;
  }
  return getAverage(state.roundScores);
}

function getBestKey(mode) {
  return `${STORAGE_KEY_PREFIX}:${mode}`;
}

function loadBestScore(mode) {
  const raw = localStorage.getItem(getBestKey(mode));
  if (raw) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (mode === 'tap') {
    const legacy = localStorage.getItem('tap-flash-best-average');
    const parsedLegacy = Number(legacy);
    if (Number.isFinite(parsedLegacy)) {
      localStorage.setItem(getBestKey('tap'), String(parsedLegacy));
      return parsedLegacy;
    }
  }

  return null;
}

function saveBestScore(mode, score) {
  localStorage.setItem(getBestKey(mode), String(score));
}

function loadRememberedName() {
  const raw = sessionStorage.getItem(PLAYER_NAME_KEY);
  const name = sanitizeInitials(raw || '');
  return name.length === 3 ? name : null;
}

function readChallengeContext() {
  const params = new URLSearchParams(window.location.search);
  const score = Number(params.get('challenge'));
  const challenger = sanitizeInitials(params.get('challenger') || '') || DEFAULT_CHALLENGER_NAME;
  const mode = params.get('mode') && GAME_MODES[params.get('mode')] ? params.get('mode') : 'tap';
  if (!Number.isFinite(score) || score < 0) return null;
  return { score: Math.round(score), challenger, mode };
}

function rememberName(name) {
  const sanitized = sanitizeInitials(name);
  if (sanitized.length !== 3) return;
  state.rememberedName = sanitized;
  sessionStorage.setItem(PLAYER_NAME_KEY, sanitized);
}

function updateSectionTitles() {
  if (state.currentMode === 'tap') {
    podiumEyebrow.textContent = 'Global podium';
    podiumTitle.textContent = 'Top 3 all-time - Tap Flash';
    podiumSubtitle.textContent = 'These are the current Tap Flash leaders.';
    leaderboardEyebrow.textContent = 'Tap Flash leaderboards';
    leaderboardTitle.textContent = 'Daily, weekly, and all-time';
    leaderboardSubtitle.textContent = 'Tap Flash scores stay live across redeploys. 3-letter names. Only qualifying runs get in.';
    return;
  }

  podiumEyebrow.textContent = 'Global podium';
  podiumTitle.textContent = 'Top 3 all-time - Split Fifty';
  podiumSubtitle.textContent = 'These are the current Split Fifty leaders.';
  leaderboardEyebrow.textContent = 'Split Fifty leaderboards';
  leaderboardTitle.textContent = 'Daily, weekly, and all-time';
  leaderboardSubtitle.textContent = 'Split Fifty scores stay live separately from Tap Flash. 3-letter names. Only qualifying runs get in.';
}

function updateBestDisplay() {
  const best = state.bestScores[state.currentMode];
  bestDisplay.textContent = best === null ? '—' : formatScore(best);
}

function updateAverageDisplay(overrideValue = null) {
  const value = overrideValue ?? getScoreAverage();
  averageDisplay.textContent = formatScore(value);
}

function updateSupportDisplay() {
  penaltyDisplay.textContent = getModeConfig().supportDisplay(state);
}

function updateShareChallengeButton() {
  if (state.lastCompletedScore === null) {
    shareChallengeButton.classList.add('hidden');
    return;
  }
  shareChallengeButton.classList.remove('hidden');
}

function renderChallengeBanner() {
  const challenge = state.challengeContext;
  if (!challenge || challenge.mode !== state.currentMode) {
    challengeBanner.classList.add('hidden');
    challengeBanner.textContent = '';
    return;
  }
  challengeBanner.classList.remove('hidden');
  challengeBanner.textContent = getModeConfig().challengeText(challenge.challenger, challenge.score);
}

function setSaveState(isSaving) {
  state.isSavingScore = isSaving;
  saveScoreButton.disabled = isSaving;
  saveScoreButton.textContent = isSaving ? 'Saving…' : 'Save score';
}

function emptyLeaderboardPayload(mode = 'tap') {
  return {
    generatedAt: null,
    mode,
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
      mode: payload.mode || state.currentMode,
      leaderboards: payload.leaderboards
    };
  }
  return emptyLeaderboardPayload(state.currentMode);
}

async function refreshLeaderboard() {
  try {
    const response = await fetch(`/api/leaderboard?mode=${encodeURIComponent(state.currentMode)}`, {
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
  renderPodium();

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
        <strong class="leaderboard-score">${formatScore(entry.score)}</strong>
      `;
      elements.list.appendChild(item);
    });
  });

  if (!state.pendingEntry) leaderboardForm.classList.add('hidden');
}

function renderPodium() {
  updateSectionTitles();
  const entries = state.leaderboards.leaderboards.allTime?.entries || [];
  podiumElements.forEach((slot, index) => {
    const entry = entries[index] || null;
    slot.name.textContent = entry?.name || '---';
    slot.score.textContent = entry ? formatScore(entry.score) : 'Open spot';
  });
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
      submitted: false,
      mode: state.currentMode
    };

    if (state.rememberedName) {
      leaderboardMessage.textContent = `Using remembered name ${state.rememberedName} for this score.`;
      await submitLeaderboardEntry(state.rememberedName);
      return;
    }

    qualifyingScore.textContent = formatScore(score);
    qualifyingBoards.textContent = humanizeBoardNames(qualifyingKeys);
    leaderboardMessage.textContent = getModeConfig().qualifyingMessage(qualifyingKeys);
    leaderboardForm.classList.remove('hidden');
    initialsInput.value = state.rememberedName || '';
    initialsInput.focus();
    return;
  }

  leaderboardForm.classList.add('hidden');
  qualifyingBoards.textContent = '';
  leaderboardMessage.textContent = `${formatScore(score)} did not reach the live leaderboards.`;
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        score: pending.score,
        mode: pending.mode
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

    celebrate({ intensity: acceptedBoards.includes('allTime') ? 'big' : 'medium' });
    leaderboardMessage.textContent = acceptedBoards.length === 1
      ? `${state.rememberedName} added with ${formatScore(pending.score)} to the ${humanizeBoardNames(acceptedBoards)} board.`
      : `${state.rememberedName} added with ${formatScore(pending.score)} to the ${humanizeBoardNames(acceptedBoards)} boards.`;
    leaderboardForm.classList.add('hidden');
    state.pendingEntry = null;
    qualifyingBoards.textContent = '';
    initialsInput.value = state.rememberedName || '';
    renderLeaderboards();
  } catch {
    if (state.pendingEntry === pending) pending.submitted = false;
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
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
}

function buildChallengeSharePayload() {
  if (state.lastCompletedScore === null) return null;
  const challenger = state.rememberedName || DEFAULT_CHALLENGER_NAME;
  const url = new URL(window.location.href);
  url.searchParams.set('challenge', String(Math.round(state.lastCompletedScore)));
  url.searchParams.set('challenger', challenger);
  url.searchParams.set('mode', state.currentMode);

  const score = Math.round(state.lastCompletedScore);
  const text = getModeConfig().shareText(challenger, score, url.toString());
  return {
    title: `${getModeConfig().label} challenge`,
    text,
    url: url.toString()
  };
}

async function handleShareChallenge() {
  const payload = buildChallengeSharePayload();
  if (!payload) return;

  try {
    if (navigator.share) {
      await navigator.share(payload);
      lastResult.textContent = state.currentMode === 'tap'
        ? `Challenge ready. Now let’s see who can beat ${formatScore(state.lastCompletedScore)}.`
        : `Challenge ready. Now let’s see who can get closer than ${formatScore(state.lastCompletedScore)}.`;
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(payload.text);
      lastResult.textContent = 'Challenge link copied. Send it to a friend and make them sweat.';
      return;
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;
  }

  lastResult.textContent = payload.url;
}

function celebrate({ intensity = 'medium' } = {}) {
  const count = intensity === 'big' ? 42 : 26;
  const colors = ['#7c3aed', '#22c55e', '#f59e0b', '#38bdf8', '#fb7185', '#facc15'];
  for (let index = 0; index < count; index += 1) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 180}px`);
    piece.style.setProperty('--rotate', `${Math.random() * 720 - 360}deg`);
    piece.style.setProperty('--duration', `${2.2 + Math.random() * 1.4}s`);
    piece.style.setProperty('--delay', `${Math.random() * 0.18}s`);
    piece.style.setProperty('--size', `${8 + Math.random() * 10}px`);
    piece.style.background = colors[index % colors.length];
    if (Math.random() > 0.55) piece.style.borderRadius = '999px';
    celebrationLayer.appendChild(piece);
    window.setTimeout(() => piece.remove(), 4200);
  }
}

function ensureAudio() {
  if (!window.AudioContext && !window.webkitAudioContext) return null;
  if (!audioState.context) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioState.context = new AudioCtx();
  }
  if (audioState.context.state === 'suspended') audioState.context.resume().catch(() => {});
  audioState.enabled = true;
  return audioState.context;
}

function playTone(type) {
  const context = ensureAudio();
  if (!context) return;
  const presets = {
    ready: { frequency: 880, duration: 0.12, volume: 0.03, wave: 'sine' },
    tap: { frequency: 660, duration: 0.08, volume: 0.05, wave: 'triangle' },
    early: { frequency: 220, duration: 0.16, volume: 0.04, wave: 'sawtooth' },
    slice: { frequency: 520, duration: 0.12, volume: 0.04, wave: 'square' }
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

function formatScore(score, mode = state.currentMode) {
  return getModeConfig(mode).formatScore(score);
}

function updateSliceMoveHint() {
  const seen = sessionStorage.getItem(SLICE_HINT_SEEN_KEY) === '1';
  sliceMoveHint.classList.toggle('hidden', state.currentMode !== 'slice' || seen);
}

function markSliceHintSeen() {
  sessionStorage.setItem(SLICE_HINT_SEEN_KEY, '1');
  updateSliceMoveHint();
}

function renderSliceBoard() {
  const shape = state.slice.currentShape;
  updateSliceMoveHint();
  if (!shape) {
    sliceShape.setAttribute('points', '');
    sliceCutLine.setAttribute('x1', 50);
    sliceCutLine.setAttribute('x2', 50);
    return;
  }
  sliceShape.setAttribute('points', shape.map((point) => `${point.x},${point.y}`).join(' '));
  sliceCutLine.setAttribute('x1', state.slice.cutX);
  sliceCutLine.setAttribute('x2', state.slice.cutX);
}

function generateSliceShape() {
  const points = [];
  const centerX = 50;
  const centerY = 52;
  const vertexCount = 9 + Math.floor(Math.random() * 4);
  for (let index = 0; index < vertexCount; index += 1) {
    const angle = (-Math.PI / 2) + (Math.PI * 2 * index / vertexCount);
    const radius = 25 + Math.random() * 16;
    const x = clamp(centerX + Math.cos(angle) * radius, 10, 90);
    const y = clamp(centerY + Math.sin(angle) * radius, 10, 90);
    points.push({ x, y });
  }
  return points;
}

function polygonArea(points) {
  if (!points || points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function clipPolygonAgainstVerticalLine(points, xCut, side) {
  if (!points || points.length < 3) return [];
  const isInside = (point) => side === 'left' ? point.x <= xCut : point.x >= xCut;
  const output = [];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const currentInside = isInside(current);
    const nextInside = isInside(next);

    if (currentInside && nextInside) {
      output.push(next);
      continue;
    }

    if (currentInside && !nextInside) {
      output.push(intersectVertical(current, next, xCut));
      continue;
    }

    if (!currentInside && nextInside) {
      output.push(intersectVertical(current, next, xCut));
      output.push(next);
    }
  }
  return dedupePolygon(output);
}

function intersectVertical(a, b, xCut) {
  if (a.x === b.x) return { x: xCut, y: a.y };
  const t = (xCut - a.x) / (b.x - a.x);
  return { x: xCut, y: a.y + ((b.y - a.y) * t) };
}

function dedupePolygon(points) {
  return points.filter((point, index) => {
    const prev = points[index - 1];
    return !prev || Math.abs(prev.x - point.x) > 0.001 || Math.abs(prev.y - point.y) > 0.001;
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
