<p align="center">
  <img src="assets/mascot.png" alt="MyTokenTracker mascot" width="116" height="116">
</p>

<h1 align="center">mytokentracker</h1>

<p align="center">
  <strong>See what your AI coding agents really cost.</strong> One command, no signup, free forever.<br>
  The open source client for <a href="https://mytokentracker.io">mytokentracker.io</a>.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/mytokentracker"><img alt="npm" src="https://img.shields.io/npm/v/mytokentracker?color=0D9488"></a>
  <img alt="License" src="https://img.shields.io/badge/license-MIT-0D9488">
  <a href="https://mytokentracker.io"><img alt="Site" src="https://img.shields.io/badge/mytokentracker.io-1A1A17"></a>
</p>

See what your AI coding agents actually cost. One command, no signup:

```bash
npx mytokentracker
```

```
  Agent         API value   Tokens   Days
  -----------   ---------   ------   ----
  Claude Code   $2,402.06    6.12B      7
  Codex            $10.67     6.9M      1
```

It reads the usage logs your agents already keep on your machine (Claude Code, Codex, Copilot CLI, Antigravity, OpenCode, Amp and more, via [ccusage](https://github.com/ccusage/ccusage)). It prices them at API rates. Nothing leaves your machine unless you run `init`.

## Is your plan worth it?

```bash
npx mytokentracker --plan 200 --days 30
```

This compares your usage at API prices with what a flat-rate plan costs over the same days.

## Track it over time

```bash
npx mytokentracker init
```

1. Paste the API token from your [mytokentracker.io](https://mytokentracker.io/settings) settings. It is saved to `~/.config/mytokentracker/config.json`, which only you can read.
2. A background sync is set up to run every 30 minutes (launchd on macOS, cron on Linux).
3. The history your agents still keep on this machine is uploaded, so your dashboard fills in straight away. That is only as far back as each agent keeps its logs: Claude Code deletes them after about 30 days unless you raise `cleanupPeriodDays` in `~/.claude/settings.json`.

**What gets uploaded:** daily totals per agent and model: token counts and cost. It never uploads your prompts, your code or file names.

If you used the old `curl | bash` installer, `init` replaces it. It removes the old hooks and heartbeat and keeps backups, so nothing is counted twice.

## Commands

| Command | What it does |
|---|---|
| `npx mytokentracker` | Local report (default: last 30 days) |
| `npx mytokentracker init` | Connect this machine and start background sync |
| `npx mytokentracker sync` | Upload now (`--dry-run` to preview, `--since YYYY-MM-DD`) |
| `npx mytokentracker status` | Connection, last sync, schedule |
| `npx mytokentracker uninstall` | Remove the schedule and the saved token |

On Windows, `init` saves the token but cannot install the schedule. Add a Task Scheduler job that runs `npx -y mytokentracker sync --quiet` every 30 minutes.

Requires Node 20 or newer. MIT licensed.

## Credits

The log parsing is done by [ccusage](https://github.com/ccusage/ccusage), which this package depends on. MyTokenTracker adds the plan comparison, background sync and the hosted dashboard at [mytokentracker.io](https://mytokentracker.io).

## Your own apps: SDK wrappers and the events API

The CLI covers coding agents. For apps that call model APIs directly, these tiny, dependency-free
wrappers send usage to the same dashboard. They run in the background, never throw into your code,
and return the original SDK response untouched. Copy your token from
[Settings](https://mytokentracker.io/settings) and set it as `MTT_TOKEN`.

### Python (`python/mtt.py`)

Drop the file next to your code, set `MTT_TOKEN`, and wrap your SDK calls:

```python
from mtt import track_openai, track_anthropic, track_google, track_mistral

r = track_openai(client.chat.completions.create(...), use_case="chat")
r = track_anthropic(client.messages.create(...), use_case="agent")
```

### Node (`node/mtt.mjs`)

```js
import { trackOpenAI, trackAnthropic, trackGoogle, trackMistral } from "./mtt.mjs";

const r = trackOpenAI(await client.chat.completions.create(...), { use_case: "chat" });
```

Both read `MTT_TOKEN` from the environment and POST to the events API in a background
thread. If the token is unset or the network hiccups, your app is unaffected.

### Any language / any provider

It is a plain HTTP endpoint, so you can report usage from anything:

```bash
curl -X POST https://mytokentracker.io/api/v1/events \
  -H "Authorization: Bearer $MTT_TOKEN" -H "Content-Type: application/json" \
  -d '{"provider":"openai","model":"gpt-4o","input_tokens":1200,"output_tokens":350,"use_case":"chat"}'
```

Optional fields (`latency_ms`, `success`, `quality_score`, `cache_read_tokens`,
`reasoning_tokens`, `total_cost`, `session_id`, `project`, …) unlock richer views like
cost-per-successful-result. Full reference: [docs](https://mytokentracker.io/docs),
[OpenAPI](https://mytokentracker.io/openapi.json) and [llms.txt](https://mytokentracker.io/llms.txt).

## What gets sent

Usage metrics only: provider, model, agent or platform, token counts, cost, and the optional fields
above. **Never** your prompts, completions, code, file names or file contents. You can delete your
synced data anytime in [Settings](https://mytokentracker.io/settings).

## License

MIT, see [LICENSE](LICENSE). The hosted service is free; the public datasets are
[CC BY 4.0](https://mytokentracker.io/data).
