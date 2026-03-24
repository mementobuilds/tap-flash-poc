const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 4173;
const publicDir = path.join(__dirname, 'public');
const stateDir = path.join(__dirname, '.state');
const leaderboardPath = path.join(stateDir, 'leaderboard.json');
const LEADERBOARD_LIMIT = 10;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function ensureStateDir() {
  fs.mkdirSync(stateDir, { recursive: true });
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readLeaderboardStore() {
  ensureStateDir();

  if (!fs.existsSync(leaderboardPath)) {
    return { date: todayKey(), entries: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(leaderboardPath, 'utf8'));
    if (parsed && parsed.date === todayKey() && Array.isArray(parsed.entries)) {
      return {
        date: parsed.date,
        entries: parsed.entries
          .filter((entry) => entry && typeof entry.name === 'string' && Number.isFinite(entry.score))
          .slice(0, LEADERBOARD_LIMIT)
      };
    }
  } catch {}

  return { date: todayKey(), entries: [] };
}

function writeLeaderboardStore(store) {
  ensureStateDir();
  fs.writeFileSync(leaderboardPath, JSON.stringify(store, null, 2));
}

function getLeaderboard() {
  const store = readLeaderboardStore();
  if (store.date !== todayKey()) {
    const fresh = { date: todayKey(), entries: [] };
    writeLeaderboardStore(fresh);
    return fresh;
  }
  return store;
}

function qualifies(score, entries) {
  if (entries.length < LEADERBOARD_LIMIT) return true;
  return score < entries[entries.length - 1].score;
}

function addLeaderboardEntry(name, score) {
  const store = getLeaderboard();
  if (!qualifies(score, store.entries)) {
    return { accepted: false, leaderboard: store };
  }

  store.entries.push({
    name,
    score,
    createdAt: new Date().toISOString()
  });
  store.entries.sort((a, b) => a.score - b.score);
  store.entries = store.entries.slice(0, LEADERBOARD_LIMIT);
  writeLeaderboardStore(store);
  return { accepted: true, leaderboard: store };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache'
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
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/leaderboard' && method === 'GET') {
    return sendJson(res, 200, getLeaderboard());
  }

  if (url.pathname === '/api/leaderboard' && method === 'POST') {
    try {
      const payload = await collectJson(req);
      const name = String(payload.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      const score = Number(payload.score);

      if (name.length !== 3) {
        return sendJson(res, 400, { error: 'Name must be exactly 3 characters.' });
      }
      if (!Number.isFinite(score) || score <= 0) {
        return sendJson(res, 400, { error: 'Score must be a positive number.' });
      }

      const result = addLeaderboardEntry(name, Math.round(score));
      if (!result.accepted) {
        return sendJson(res, 409, {
          error: 'Score no longer qualifies for the top 10.',
          leaderboard: result.leaderboard
        });
      }

      return sendJson(res, 201, result.leaderboard);
    } catch (error) {
      return sendJson(res, 400, { error: error.message || 'Bad request' });
    }
  }

  const urlPath = decodeURIComponent(url.pathname);
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(publicDir, safePath === '/' ? 'index.html' : safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
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
});
