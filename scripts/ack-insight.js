#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const statePath = path.join(repoRoot, '.state', 'agent-insights-state.json');

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

const id = process.argv[2];
if (!id) {
  console.error('Usage: node scripts/ack-insight.js <feedbackId>');
  process.exit(1);
}

const state = readJson(statePath, {
  ackedKeys: [],
  pendingFindings: [],
  history: []
});

const pending = state.pendingFindings || [];
const matched = pending.filter((item) => String(item.sourceId) === String(id));
if (!matched.length) {
  console.error(`No pending finding found for id=${id}`);
  process.exit(1);
}

const acked = new Set(state.ackedKeys || state.seenKeys || []);
for (const item of matched) {
  acked.add(item.key);
}

const nextState = {
  ackedKeys: Array.from(acked).slice(-500),
  pendingFindings: pending.filter((item) => String(item.sourceId) !== String(id)).slice(-100),
  history: [
    ...(state.history || []),
    {
      checkedAt: new Date().toISOString(),
      ackedSourceId: String(id),
      ackedKeys: matched.map((item) => item.key)
    }
  ].slice(-200)
};

writeJson(statePath, nextState);
console.log(`ACKED ${id}`);
