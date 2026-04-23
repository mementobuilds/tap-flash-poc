const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const port = process.env.PORT || 4173;
const publicDir = path.join(__dirname, 'public');
const localStateDir = path.join(__dirname, '.state');
const storageDir = resolveStorageDir();
const leaderboardPath = path.join(storageDir, 'leaderboard-store.json');
const legacyLeaderboardPath = path.join(localStateDir, 'leaderboard.json');
const LEADERBOARD_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const GAME_MODES = {
  tap: {
    key: 'tap',
    label: 'Tap Flash'
  },
  slice: {
    key: 'slice',
    label: 'Split Fifty'
  }
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://itbroke.dev https://jam.pieter.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://www.googletagmanager.com https://www.google-analytics.com https://region1.google-analytics.com",
  "frame-src https://www.googletagmanager.com",
  "media-src 'self'",
  "worker-src 'self'",
  'upgrade-insecure-requests'
].join('; ');

const boardDefinitions = {
  daily: {
    key: 'daily',
    label: 'Daily',
    detail: 'Last 24 hours',
    includes: (createdAtMs, nowMs) => nowMs - createdAtMs <= DAY_MS
  },
  weekly: {
    key: 'weekly',
    label: 'Weekly',
    detail: 'Last 7 days',
    includes: (createdAtMs, nowMs) => nowMs - createdAtMs <= WEEK_MS
  },
  allTime: {
    key: 'allTime',
    label: 'All-time',
    detail: 'Best ever',
    includes: () => true
  }
};

function resolveStorageDir() {
  const explicitDir = process.env.LEADERBOARD_STORAGE_DIR || process.env.LEADERBOARD_DATA_DIR;
  if (explicitDir) return explicitDir;

  const railwayVolumeDir = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (railwayVolumeDir) return path.join(railwayVolumeDir, 'tap-flash');

  if (fs.existsSync('/data')) {
    try {
      const stats = fs.statSync('/data');
      if (stats.isDirectory()) {
        return '/data/tap-flash';
      }
    } catch {}
  }

  return localStateDir;
}

function ensureStorageDir() {
  fs.mkdirSync(storageDir, { recursive: true });
}

function toIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sanitizeMode(value) {
  const normalized = String(value || 'tap').toLowerCase();
  return GAME_MODES[normalized] ? normalized : 'tap';
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry.name !== 'string') return null;
  const score = Number(entry.score);
  const createdAt = toIsoDate(entry.createdAt || new Date().toISOString());
  if (!createdAt || !Number.isFinite(score) || score < 0) return null;

  const name = String(entry.name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  if (name.length !== 3) return null;

  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : crypto.randomUUID(),
    mode: sanitizeMode(entry.mode),
    name,
    score: Math.round(score),
    createdAt
  };
}

function migrateLegacyStore() {
  if (storageDir !== localStateDir) return null;
  if (!fs.existsSync(legacyLeaderboardPath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(legacyLeaderboardPath, 'utf8'));
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const migratedScores = entries
      .map((entry) => sanitizeEntry({
        id: entry.id,
        name: entry.name,
        score: entry.score,
        createdAt: entry.createdAt || (parsed?.date ? `${parsed.date}T00:00:00.000Z` : new Date().toISOString())
      }))
      .filter(Boolean);

    return {
      version: 2,
      scores: migratedScores
    };
  } catch {
    return null;
  }
}

function readLeaderboardStore() {
  ensureStorageDir();

  if (!fs.existsSync(leaderboardPath)) {
    const migrated = migrateLegacyStore();
    if (migrated) {
      writeLeaderboardStore(migrated);
      return migrated;
    }
    return { version: 2, scores: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(leaderboardPath, 'utf8'));
    const scores = Array.isArray(parsed?.scores)
      ? parsed.scores.map(sanitizeEntry).filter(Boolean)
      : [];

    return {
      version: 2,
      scores
    };
  } catch {
    return { version: 2, scores: [] };
  }
}

function writeLeaderboardStore(store) {
  ensureStorageDir();
  fs.writeFileSync(leaderboardPath, JSON.stringify({
    version: 2,
    scores: Array.isArray(store?.scores) ? store.scores : []
  }, null, 2));
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => a.score - b.score || a.createdAt.localeCompare(b.createdAt));
}

function buildLeaderboardPayload(store, mode = 'tap', now = new Date()) {
  const nowMs = now.getTime();
  const normalizedMode = sanitizeMode(mode);
  const scores = sortEntries(
    (store?.scores || [])
      .map(sanitizeEntry)
      .filter(Boolean)
      .filter((entry) => entry.mode === normalizedMode)
  );

  const leaderboards = Object.fromEntries(
    Object.entries(boardDefinitions).map(([key, definition]) => {
      const entries = scores
        .filter((entry) => definition.includes(new Date(entry.createdAt).getTime(), nowMs))
        .slice(0, LEADERBOARD_LIMIT);

      return [key, {
        key,
        label: definition.label,
        detail: definition.detail,
        entries
      }];
    })
  );

  return {
    generatedAt: now.toISOString(),
    mode: normalizedMode,
    modeLabel: GAME_MODES[normalizedMode].label,
    leaderboards
  };
}

function scoreQualifies(score, entries) {
  if (entries.length < LEADERBOARD_LIMIT) return true;
  return score < entries[entries.length - 1].score;
}

function qualifyingBoards(score, leaderboardPayload) {
  return Object.entries(leaderboardPayload.leaderboards)
    .filter(([, board]) => scoreQualifies(score, board.entries))
    .map(([key]) => key);
}

function addLeaderboardEntry(name, score, mode = 'tap') {
  const normalizedMode = sanitizeMode(mode);
  const store = readLeaderboardStore();
  const currentBoards = buildLeaderboardPayload(store, normalizedMode);
  const qualifiesFor = qualifyingBoards(score, currentBoards);

  if (!qualifiesFor.length) {
    return {
      accepted: false,
      leaderboards: currentBoards,
      qualifiesFor: []
    };
  }

  const entry = sanitizeEntry({
    id: crypto.randomUUID(),
    mode: normalizedMode,
    name,
    score,
    createdAt: new Date().toISOString()
  });

  store.scores.push(entry);
  writeLeaderboardStore(store);

  const leaderboards = buildLeaderboardPayload(store, normalizedMode);
  const acceptedBoards = Object.entries(leaderboards.leaderboards)
    .filter(([, board]) => board.entries.some((boardEntry) => boardEntry.id === entry.id))
    .map(([key]) => key);

  return {
    accepted: acceptedBoards.length > 0,
    entry,
    leaderboards,
    acceptedBoards,
    qualifiesFor
  };
}

function buildSecurityHeaders() {
  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': contentSecurityPolicy
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    ...buildSecurityHeaders()
  });
  res.end(JSON.stringify(payload));
}

function collectJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        ...buildSecurityHeaders()
      });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store, max-age=0' : 'public, max-age=3600',
      ...buildSecurityHeaders()
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/leaderboard' && method === 'GET') {
    const mode = sanitizeMode(url.searchParams.get('mode') || 'tap');
    return sendJson(res, 200, buildLeaderboardPayload(readLeaderboardStore(), mode));
  }

  if (url.pathname === '/api/leaderboard' && method === 'POST') {
    try {
      const payload = await collectJson(req);
      const name = String(payload.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      const score = Number(payload.score);
      const mode = sanitizeMode(payload.mode || 'tap');

      if (name.length !== 3) {
        return sendJson(res, 400, { error: 'Name must be exactly 3 characters.' });
      }
      if (!Number.isFinite(score) || score < 0) {
        return sendJson(res, 400, { error: 'Score must be zero or a positive number.' });
      }

      const result = addLeaderboardEntry(name, Math.round(score), mode);
      if (!result.accepted) {
        return sendJson(res, 409, {
          error: 'Score no longer qualifies for the live top 10 boards.',
          leaderboards: result.leaderboards.leaderboards,
          qualifiesFor: result.qualifiesFor
        });
      }

      return sendJson(res, 201, {
        generatedAt: result.leaderboards.generatedAt,
        leaderboards: result.leaderboards.leaderboards,
        acceptedBoards: result.acceptedBoards,
        entry: result.entry
      });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || 'Bad request' });
    }
  }

  const urlPath = decodeURIComponent(url.pathname);
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(publicDir, safePath === '/' ? 'index.html' : safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, {
      'Content-Type': 'text/plain; charset=utf-8',
      ...buildSecurityHeaders()
    });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (path.extname(filePath)) {
      sendFile(res, filePath);
    } else {
      sendFile(res, path.join(publicDir, 'index.html'));
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Tap Flash listening on http://0.0.0.0:${port}`);
  console.log(`Leaderboard storage: ${leaderboardPath}`);
});
