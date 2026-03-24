#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const publicDir = path.join(repoRoot, 'public');
const liveUrl = process.env.LIVE_URL || 'https://tap-flash-web-production.up.railway.app';
const branch = process.env.BRANCH || process.argv.find(arg => arg.startsWith('--branch='))?.split('=')[1] || 'main';
const timeoutMs = Number(process.env.DEPLOY_TIMEOUT_MS || process.argv.find(arg => arg.startsWith('--timeout-ms='))?.split('=')[1] || 300000);
const intervalMs = Number(process.env.DEPLOY_POLL_MS || process.argv.find(arg => arg.startsWith('--poll-ms='))?.split('=')[1] || 10000);
const pushEnabled = !process.argv.includes('--no-push');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function readLocal(file) {
  return fs.readFileSync(path.join(publicDir, file));
}

function parseAssetVersion(html) {
  const text = html.toString('utf8');
  const appMatch = text.match(/\/app\.js\?v=([^"']+)/);
  const cssMatch = text.match(/\/styles\.css\?v=([^"']+)/);
  return {
    appVersion: appMatch ? appMatch[1] : null,
    cssVersion: cssMatch ? cssMatch[1] : null
  };
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'cache-control': 'no-cache',
      'pragma': 'no-cache'
    }
  });
  if (!res.ok) {
    throw new Error(`Fetch failed for ${url}: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function pushBranch() {
  console.log(`Pushing ${branch} to origin...`);
  execFileSync('git', ['push', 'origin', branch], {
    cwd: repoRoot,
    stdio: 'inherit'
  });
}

async function checkOnce() {
  const localIndex = readLocal('index.html');
  const localApp = readLocal('app.js');
  const localCss = readLocal('styles.css');
  const versions = parseAssetVersion(localIndex);

  const appUrl = `${liveUrl.replace(/\/$/, '')}/app.js${versions.appVersion ? `?v=${versions.appVersion}` : ''}`;
  const cssUrl = `${liveUrl.replace(/\/$/, '')}/styles.css${versions.cssVersion ? `?v=${versions.cssVersion}` : ''}`;
  const indexUrl = `${liveUrl.replace(/\/$/, '')}/`;

  const [remoteIndex, remoteApp, remoteCss] = await Promise.all([
    fetchText(indexUrl),
    fetchText(appUrl),
    fetchText(cssUrl)
  ]);

  return {
    urls: { indexUrl, appUrl, cssUrl },
    matches: {
      index: sha256(localIndex) === sha256(remoteIndex),
      app: sha256(localApp) === sha256(remoteApp),
      css: sha256(localCss) === sha256(remoteCss)
    },
    hashes: {
      local: {
        index: sha256(localIndex),
        app: sha256(localApp),
        css: sha256(localCss)
      },
      remote: {
        index: sha256(remoteIndex),
        app: sha256(remoteApp),
        css: sha256(remoteCss)
      }
    }
  };
}

async function main() {
  if (pushEnabled) pushBranch();

  console.log('Waiting for live site to match local files...');
  console.log(`Live URL: ${liveUrl}`);
  console.log(`Timeout: ${Math.round(timeoutMs / 1000)}s | Poll: ${Math.round(intervalMs / 1000)}s`);

  const started = Date.now();
  let lastResult = null;
  let lastError = null;

  while (Date.now() - started < timeoutMs) {
    try {
      lastResult = await checkOnce();
      lastError = null;
      const { matches } = lastResult;
      console.log(`[check] index=${matches.index} app=${matches.app} css=${matches.css}`);
      if (matches.index && matches.app && matches.css) {
        console.log('Live deployment verified. Railway is serving the current local version.');
        return;
      }
    } catch (error) {
      lastError = error;
      console.log(`[check] ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  console.error('Deployment verification timed out.');
  if (lastError) {
    console.error(`Last error: ${lastError.message}`);
  }
  if (lastResult) {
    console.error('Last hash comparison:');
    console.error(JSON.stringify(lastResult, null, 2));
  }
  process.exit(1);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
