# Tap Flash

Tap Flash is a minimal browser reaction game built by Goji as the first VCL autonomous-improvement proof of concept.

## Run locally

```bash
npm start
```

Then open <http://localhost:4173>.

## Agent Insights poller

The poller reads a local secret config file and stores local state so it can detect new VCL feedback.

### Secret config

Create a JSON file at:

```bash
~/.openclaw/workspace/.openclaw/tap-flash-vcl.json
```

Shape:

```json
{
  "url": "https://.../api/project-intelligence/v1/projects/26/insights?range=30d&source=all",
  "apiKey": "vcl_pi_..."
}
```

### Poll manually

```bash
node scripts/poll-insights.js
```

### Reset local feedback state

```bash
node scripts/reset-insights-state.js
```

## Deployment

Primary live deployment now uses:
- GitHub repo: `https://github.com/mementobuilds/tap-flash-poc.git`
- Railway URL: `https://tap-flash-web-production.up.railway.app`

### Push the latest approved changes

```bash
./scripts/push-deploy.sh
```

This now does three things:
1. pushes the selected branch to GitHub
2. if local Railway API config is available, triggers the Railway deploy directly
3. waits until the live Railway site matches the local `public/index.html`, `public/app.js`, and `public/styles.css`

If Railway is stale, slow, or serving the wrong build, the script exits non-zero instead of pretending deploy succeeded.

### Local Railway deploy config

Create a local `.env.deploy` file (gitignored) when you want deploys to trigger Railway directly instead of relying only on GitHub webhooks:

```bash
RAILWAY_TOKEN=...
RAILWAY_PROJECT_ID=20d489a8-bdc0-4245-a073-59d55d047710
RAILWAY_ENVIRONMENT_ID=7e54c4df-7f49-4ff5-b3c6-17f4bb337f8b
RAILWAY_SERVICE_ID=a382d470-26ee-45a7-aaff-5a225bce41c1
LIVE_URL=https://tap-flash-web-production.up.railway.app
```

### Verify the live site without pushing

```bash
node scripts/deploy-and-verify.js --no-push --no-trigger
```

The old local Node server + tunnel path is now just a fallback/debug path, not the primary public home.

## Notes

- Plain HTML/CSS/JS frontend
- Tiny Node static server for simple deployment
- Designed to be easy to iterate based on community feedback
- Poller state is stored under `.state/` and ignored by git
