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

This now does two things:
1. pushes the selected branch to GitHub
2. waits until the live Railway site matches the local `public/index.html`, `public/app.js`, and `public/styles.css`

If Railway is stale, slow, or serving the wrong build, the script exits non-zero instead of pretending deploy succeeded.

### Verify the live site without pushing

```bash
node scripts/deploy-and-verify.js --no-push
```

Railway autodeploys from the GitHub repo after the push lands on `main`.

The old local Node server + tunnel path is now just a fallback/debug path, not the primary public home.

## Notes

- Plain HTML/CSS/JS frontend
- Tiny Node static server for simple deployment
- Designed to be easy to iterate based on community feedback
- Poller state is stored under `.state/` and ignored by git
