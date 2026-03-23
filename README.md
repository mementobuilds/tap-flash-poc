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

## Notes

- Plain HTML/CSS/JS frontend
- Tiny Node static server for simple deployment
- Designed to be easy to iterate based on community feedback
- Poller state is stored under `.state/` and ignored by git
