#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');

const repoRoot = path.resolve(__dirname, '..');
const stateDir = path.join(repoRoot, '.state');
const statePath = path.join(stateDir, 'agent-insights-state.json');
const configPath = process.env.VCL_CONFIG_PATH || path.join(process.env.HOME || '', '.openclaw', 'workspace', '.openclaw', 'tap-flash-vcl.json');

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function normalizeFinding(item) {
  const key = [item.sourceType || 'unknown', item.sourceId || 'na', item.createdAt || 'na'].join(':');
  return {
    key,
    sourceType: item.sourceType || 'unknown',
    sourceId: item.sourceId ?? null,
    createdAt: item.createdAt || null,
    category: item.category || 'general',
    sourcePath: item.sourcePath || null,
    text: String(item.text || '').trim(),
    media: item.media || null
  };
}

function httpsJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 500)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Invalid JSON: ${error.message}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function toMessage(result) {
  if (!result.newCount) return 'NO_NEW_FEEDBACK';

  const lines = [
    'New VCL feedback for Tap Flash.',
    '',
    ...result.newFindings.flatMap((item, index) => {
      const block = [
        `${index + 1}. [${item.sourceType}] id=${item.sourceId} · ${item.createdAt || 'unknown time'}`,
        item.text || '(no text)'
      ];
      if (item.sourcePath) block.push(`Path: ${item.sourcePath}`);
      if (item.media && Array.isArray(item.media.imageUrls) && item.media.imageUrls.length) {
        block.push(`Media: ${item.media.imageUrls.join(', ')}`);
      }
      return [...block, ''];
    }),
    'Reply with: OK or HOLD'
  ];

  return lines.join('\n').trim();
}

(async () => {
  const config = readJson(configPath);
  if (!config || !config.url || !config.apiKey) {
    console.error(`Missing config. Expected JSON with url and apiKey at ${configPath}`);
    process.exit(1);
  }

  const state = readJson(statePath, { seenKeys: [], history: [] });
  const payload = await httpsJson(config.url, {
    'Accept': 'application/json',
    'x-project-api-key': config.apiKey,
    'User-Agent': 'goji-tap-flash-poller'
  });

  const findings = (payload.findings || []).map(normalizeFinding);
  const seen = new Set(state.seenKeys || []);
  const newFindings = findings.filter((item) => !seen.has(item.key));

  const nextState = {
    seenKeys: Array.from(new Set([...seen, ...findings.map((item) => item.key)])).slice(-500),
    history: [
      ...(state.history || []),
      {
        checkedAt: new Date().toISOString(),
        totalFindings: findings.length,
        newFindingKeys: newFindings.map((item) => item.key)
      }
    ].slice(-200)
  };

  writeJson(statePath, nextState);

  const result = {
    checkedAt: new Date().toISOString(),
    projectId: payload.projectId || null,
    totalFindings: findings.length,
    newCount: newFindings.length,
    newFindings,
    statePath,
    sourceBreakdown: payload.sourceBreakdown || null
  };

  if (process.argv.includes('--message')) {
    process.stdout.write(toMessage(result));
    return;
  }

  process.stdout.write(JSON.stringify(result, null, 2));
})();
