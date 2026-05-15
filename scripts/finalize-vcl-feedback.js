#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const statePath = path.join(repoRoot, '.state', 'agent-insights-state.json');

function parseArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function requireArg(flag, value) {
  if (!value) {
    console.error(`Missing required ${flag}`);
    process.exit(1);
  }
  return value;
}

function readTextMaybe(filePath) {
  if (!filePath) return null;
  return fs.readFileSync(path.resolve(repoRoot, filePath), 'utf8').trim();
}

function normalizeBullets(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.startsWith('- ') ? line : `- ${line.replace(/^[-*]\s*/, '')}`)
    .join('\n');
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function inferFeedbackSource(feedbackId) {
  const state = readJson(statePath, {});
  const targetId = String(feedbackId);
  const candidates = [
    ...(state.pendingFindings || []),
    ...(state.pendingReplies || []),
    ...(state.history || [])
  ];

  for (const item of candidates) {
    if (String(item?.sourceId) === targetId && item?.sourceType) {
      return {
        sourceType: item.sourceType,
        sourcePath: item.sourcePath || null
      };
    }
  }

  if (state.lastFeedFingerprint) {
    try {
      const items = JSON.parse(state.lastFeedFingerprint);
      for (const item of items) {
        if (String(item?.sourceId) === targetId && item?.sourceType) {
          return {
            sourceType: item.sourceType,
            sourcePath: item.sourcePath || null
          };
        }
      }
    } catch {
      return null;
    }
  }

  return null;
}

function defaultReply(summary) {
  return `Thanks for the suggestion — this is now live in the latest Tap Flash build. ${summary}`.trim();
}

function defaultChangelog(summary) {
  return normalizeBullets(summary);
}

function runDeploy(env) {
  const result = spawnSync('node', ['scripts/deploy-and-verify.js'], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function main() {
  const feedbackId = requireArg('--id', parseArgValue('--id'));
  const inferredSource = inferFeedbackSource(feedbackId);
  const sourceType = parseArgValue('--source-type') || inferredSource?.sourceType || '';
  const sourcePath = parseArgValue('--source-path') || inferredSource?.sourcePath || '';
  const summary = requireArg(
    '--summary or --summary-file',
    parseArgValue('--summary') || readTextMaybe(parseArgValue('--summary-file'))
  );
  const feedbackRequest = parseArgValue('--feedback-request') || readTextMaybe(parseArgValue('--feedback-request-file')) || '';
  const reply = hasFlag('--no-reply')
    ? ''
    : (parseArgValue('--reply') || readTextMaybe(parseArgValue('--reply-file')) || defaultReply(summary));
  const changelog = hasFlag('--no-changelog')
    ? ''
    : (parseArgValue('--changelog') || readTextMaybe(parseArgValue('--changelog-file')) || defaultChangelog(summary));

  const env = {};
  if (sourceType) env.VCL_SOURCE_TYPE = sourceType;
  if (sourcePath) env.VCL_SOURCE_PATH = sourcePath;
  if (reply) {
    env.VCL_REPLY_PARENT_ID = String(feedbackId);
    env.VCL_REPLY_CONTENT = reply;
  }
  if (changelog) {
    env.VCL_CHANGELOG_CONTENT = changelog;
  }
  if (feedbackRequest) {
    env.VCL_FEEDBACK_REQUEST = feedbackRequest;
  }

  console.log(`Finalizing VCL feedback ${feedbackId}...`);
  if (sourceType) console.log(`Detected source type: ${sourceType}`);
  if (reply) {
    if (sourceType === 'mission_submission') {
      console.log('Reply content prepared, but mission submissions are not replyable and will skip the reply step.');
    } else {
      console.log('Will post reply after verified deploy.');
    }
  }
  if (changelog) console.log('Will post changelog after verified deploy.');
  if (feedbackRequest) console.log('Will include feedback request in changelog.');

  runDeploy(env);
}

main();
