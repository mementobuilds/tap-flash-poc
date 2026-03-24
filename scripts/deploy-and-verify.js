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
const timeoutMs = Number(process.env.DEPLOY_TIMEOUT_MS || process.argv.find(arg => arg.startsWith('--timeout-ms='))?.split('=')[1] || 600000);
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
      pragma: 'no-cache'
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

function currentHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8'
  }).trim();
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
  console.log('Triggering Railway deploy from latest GitHub commit...');
  const data = await railwayGraphQL(
    `mutation serviceInstanceDeploy($serviceId: String!, $environmentId: String!, $latestCommit: Boolean) {
      serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId, latestCommit: $latestCommit)
    }`,
    {
      serviceId: railwayConfig.serviceId,
      environmentId: railwayConfig.environmentId,
      latestCommit: true
    }
  );

  if (!data.serviceInstanceDeploy) {
    throw new Error('Railway did not accept the deploy trigger request');
  }
}

async function latestDeployment() {
  const data = await railwayGraphQL(
    `query project($id: String!) {
      project(id: $id) {
        services {
          edges {
            node {
              id
              name
              serviceInstances {
                edges {
                  node {
                    id
                    environmentId
                    latestDeployment {
                      id
                      status
                      createdAt
                      meta
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`,
    { id: railwayConfig.projectId }
  );

  const service = data.project.services.edges
    .map(edge => edge.node)
    .find(node => node.id === railwayConfig.serviceId);
  const instance = service?.serviceInstances?.edges
    ?.map(edge => edge.node)
    .find(node => node.environmentId === railwayConfig.environmentId);

  if (!instance?.latestDeployment) {
    throw new Error('Could not find the latest Railway deployment for the configured service/environment');
  }

  return instance.latestDeployment;
}

async function waitForRailwayDeployment(expectedCommit, previousDeploymentId) {
  const started = Date.now();
  let lastLabel = null;

  while (Date.now() - started < timeoutMs) {
    const deployment = await latestDeployment();
    const commitHash = deployment.meta?.commitHash || 'unknown';
    const label = `${deployment.id}:${deployment.status}:${commitHash}`;

    if (label !== lastLabel) {
      console.log(`[railway] id=${deployment.id} status=${deployment.status} commit=${commitHash}`);
      lastLabel = label;
    }

    if (deployment.id === previousDeploymentId) {
      await sleep(intervalMs);
      continue;
    }

    if (deployment.status === 'SUCCESS') {
      if (commitHash !== expectedCommit) {
        throw new Error(`Railway deployed ${commitHash} instead of expected ${expectedCommit}`);
      }
      return deployment;
    }

    if (['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED'].includes(deployment.status)) {
      throw new Error(`Railway deployment ${deployment.id} ended with status ${deployment.status}`);
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for Railway deployment of ${expectedCommit}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

  const expectedCommit = currentHead();
  console.log(`Expected commit: ${expectedCommit}`);

  if (triggerEnabled && hasRailwayConfig()) {
    const before = await latestDeployment();
    await triggerRailwayDeploy();
    await waitForRailwayDeployment(expectedCommit, before.id);
  } else if (triggerEnabled) {
    console.log('Railway direct-trigger config not found; skipping trigger and only verifying the live site.');
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

    await sleep(intervalMs);
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
