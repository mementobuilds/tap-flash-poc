#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');

const repoRoot = path.resolve(__dirname, '..');
const statePath = path.join(repoRoot, '.state', 'agent-insights-state.json');
const homeDir = process.env.HOME || '';
const defaultConfigPath = path.join(homeDir, '.openclaw', 'workspace', '.openclaw', 'tap-flash-vcl.json');
const configPath = process.env.VCL_CONFIG_PATH || defaultConfigPath;
const deployEnvPath = path.join(repoRoot, '.env.deploy');

loadEnvFile(deployEnvPath);

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

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

function parseArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function requireArg(flag, value) {
  if (!value) {
    console.error(`Missing required ${flag}`);
    process.exit(1);
  }
  return value;
}

function inferProjectId(config) {
  if (process.env.VCL_PROJECT_ID) return String(process.env.VCL_PROJECT_ID);
  if (config?.projectId) return String(config.projectId);
  if (!config?.url) return null;
  const match = config.url.match(/\/projects\/(\d+)\//);
  return match ? match[1] : null;
}

function loadVclConfig() {
  const fileConfig = readJson(configPath, {});
  const projectId = inferProjectId(fileConfig);
  const apiKey = process.env.VCL_API_KEY || fileConfig.apiKey || null;
  const baseUrl = process.env.VCL_BASE_URL || fileConfig.baseUrl || 'https://vibecodinglist.com';

  if (!projectId || !apiKey) {
    console.error(`Missing VCL config. Need projectId and apiKey via ${configPath}, env, or .env.deploy.`);
    process.exit(1);
  }

  return { projectId, apiKey, baseUrl: baseUrl.replace(/\/$/, '') };
}

function httpsJson(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 1000)}`));
          return;
        }
        if (!data.trim()) {
          resolve({ ok: true });
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`Invalid JSON response: ${error.message}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function normalizeText(text) {
  return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function extractFeedbackId(result) {
  if (!result || typeof result !== 'object') return null;
  return result.feedbackId || result.id || result.sourceId || result?.feedback?.id || null;
}

function recordAuthoredReply(result, content) {
  const state = readJson(statePath, {
    ackedKeys: [],
    pendingFindings: [],
    pendingReplies: [],
    notifiedKeys: [],
    authoredSourceIds: [],
    authoredTexts: [],
    history: [],
    lastFeedFingerprint: null,
    feedKind: null
  });

  const authoredSourceIds = new Set((state.authoredSourceIds || []).map((value) => String(value)));
  const authoredTexts = new Set((state.authoredTexts || []).map(normalizeText).filter(Boolean));
  const extractedId = extractFeedbackId(result);
  if (extractedId !== null && extractedId !== undefined) authoredSourceIds.add(String(extractedId));
  if (content) authoredTexts.add(normalizeText(content));

  writeJson(statePath, {
    ...state,
    authoredSourceIds: Array.from(authoredSourceIds).slice(-200),
    authoredTexts: Array.from(authoredTexts).slice(-200)
  });
}

async function postFeedback(config, { content, parentId = null, type = 'comment' }) {
  const payload = { content, type };
  if (parentId !== null && parentId !== undefined && parentId !== '') {
    payload.parentId = Number(parentId);
  }

  const url = `${config.baseUrl}/api/project-intelligence/v1/projects/${config.projectId}/feedback`;
  return httpsJson('POST', url, {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-project-api-key': config.apiKey,
    'User-Agent': 'goji-tap-flash-vcl-api'
  }, JSON.stringify(payload));
}

function parseLinkedFeedbackIds(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 5);
}

async function postUpdate(config, { content, feedbackRequest = null, linkedFeedbackIds = [] }) {
  const payload = { content };
  if (feedbackRequest) payload.feedbackRequest = feedbackRequest;
  if (linkedFeedbackIds.length) payload.linkedFeedbackIds = linkedFeedbackIds;

  const url = `${config.baseUrl}/api/project-intelligence/v1/projects/${config.projectId}/updates`;
  return httpsJson('POST', url, {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-project-api-key': config.apiKey,
    'User-Agent': 'goji-tap-flash-vcl-api'
  }, JSON.stringify(payload));
}

async function main() {
  const command = process.argv[2];
  const config = loadVclConfig();

  if (command === 'reply') {
    const parentId = requireArg('--parent-id', parseArgValue('--parent-id'));
    const content = requireArg('--content', parseArgValue('--content'));
    const result = await postFeedback(config, { parentId, content, type: 'comment' });
    recordAuthoredReply(result, content);
    process.stdout.write(JSON.stringify({ ok: true, action: 'reply', parentId: Number(parentId), result }, null, 2));
    return;
  }

  if (command === 'ask') {
    const content = requireArg('--content', parseArgValue('--content'));
    const result = await postFeedback(config, { content, type: 'comment' });
    recordAuthoredReply(result, content);
    process.stdout.write(JSON.stringify({ ok: true, action: 'ask', result }, null, 2));
    return;
  }

  if (command === 'changelog') {
    const content = requireArg('--content', parseArgValue('--content'));
    const feedbackRequest = parseArgValue('--feedback-request');
    const linkedFeedbackIds = parseLinkedFeedbackIds(parseArgValue('--linked-feedback-ids'));
    const result = await postUpdate(config, { content, feedbackRequest, linkedFeedbackIds });
    process.stdout.write(JSON.stringify({ ok: true, action: 'changelog', linkedFeedbackIds, result }, null, 2));
    return;
  }

  console.error([
    'Usage:',
    '  node scripts/vcl-api.js reply --parent-id <id> --content "..."',
    '  node scripts/vcl-api.js ask --content "..."',
    '  node scripts/vcl-api.js changelog --content "- Fixed ..." [--feedback-request "..."] [--linked-feedback-ids "456,789"]'
  ].join('\n'));
  process.exit(1);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
