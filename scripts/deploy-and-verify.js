#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const publicDir = path.join(repoRoot, 'public');
const deployEnvPath = path.join(repoRoot, '.env.deploy');

loadEnvFile(deployEnvPath);

const liveUrl = process.env.LIVE_URL || 'https://tap-flash-web-production.up.railway.app';
const branch = process.env.BRANCH || process.argv.find(arg => arg.startsWith('--branch='))?.split('=')[1] || 'main';
const timeoutMs = Number(process.env.DEPLOY_TIMEOUT_MS || process.argv.find(arg => arg.startsWith('--timeout-ms='))?.split('=')[1] || 300000);
const intervalMs = Number(process.env.DEPLOY_POLL_MS || process.argv.find(arg => arg.startsWith('--poll-ms='))?.split('=')[1] || 10000);
const pushEnabled = !process.argv.includes('--no-push');
const triggerEnabled = !process.argv.includes('--no-trigger');
const railwayConfig = {
  token: process.env.RAILWAY_TOKEN,
  projectId: process.env.RAILWAY_PROJECT_ID,
  environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
  serviceId: process.env.RAILWAY_SERVICE_ID
};

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

async function railwayGraphQL(query, variables = {}) {
  const res = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${railwayConfig.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });

  if (!res.ok) {
    throw new Error(`Railway API request failed: ${res.status} ${res.statusText}`);
  }

  const payload = await res.json();
  if (payload.errors?.length) {
    throw new Error(`Railway API error: ${payload.errors.map(error => error.message).join('; ')}`);
  }

  return payload.data;
}

function hasRailwayConfig() {
  return Boolean(
    railwayConfig.token &&
    railwayConfig.projectId &&
    railwayConfig.environmentId &&
    railwayConfig.serviceId
  );
}

async function triggerRailwayDeploy() {
  console.log('Triggering Railway deploy directly...');
  const data = await railwayGraphQL(
    `mutation serviceInstanceDeployV2($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    {
      serviceId: railwayConfig.serviceId,
      environmentId: railwayConfig.environmentId
    }
  );

  const deploymentId = data.serviceInstanceDeployV2;
  console.log(`Railway deployment id: ${deploymentId}`);
  return deploymentId;
}

async function waitForRailwayDeployment(deploymentId) {
  const started = Date.now();
  let lastStatus = null;

  while (Date.now() - started < timeoutMs) {
    const data = await railwayGraphQL(
      `query deployment($id: String!) {
        deployment(id: $id) {
          id
          status
          createdAt
          meta
        }
      }`,
      { id: deploymentId }
    );

    const deployment = data.deployment;
    const commitHash = deployment.meta?.commitHash || 'unknown';
    if (deployment.status !== lastStatus) {
      console.log(`[railway] status=${deployment.status} commit=${commitHash}`);
      lastStatus = deployment.status;
    }

    if (deployment.status === 'SUCCESS') return deployment;
    if (['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED'].includes(deployment.status)) {
      throw new Error(`Railway deployment ${deploymentId} ended with status ${deployment.status}`);
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for Railway deployment ${deploymentId}`);
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

  if (triggerEnabled && hasRailwayConfig()) {
    const deploymentId = await triggerRailwayDeploy();
    await waitForRailwayDeployment(deploymentId);
  } else if (triggerEnabled) {
    console.log('Railway direct-trigger config not found; falling back to GitHub autodeploy detection.');
  }

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
