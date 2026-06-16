<h1 align="center">MyTokenTracker — tracking client</h1>

<p align="center">
  <strong>See what AI is really costing you.</strong> One line to install, automatic capture, free forever.<br>
  The open-source client for <a href="https://mytokentracker.io">mytokentracker.io</a> — a free, multi-provider LLM cost tracker.
</p>

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-0D9488">
  <img alt="Price" src="https://img.shields.io/badge/service-free%20forever-0D9488">
  <a href="https://mytokentracker.io"><img alt="Site" src="https://img.shields.io/badge/mytokentracker.io-1A1A17"></a>
</p>

---

These are the drop-in clients that send your LLM usage to MyTokenTracker, where it
becomes a real-time dashboard plus a public [AI Cost Index](https://mytokentracker.io/cost-index),
[value-for-money](https://mytokentracker.io/value) view, and [open data](https://mytokentracker.io/data).
They're tiny, dependency-free, non-blocking, and fail-safe: they run in the background
and never throw into your code, and they return the original SDK response untouched.

> Tracking is free, forever. Create an account and copy your token from
> [Settings](https://mytokentracker.io/settings) (format `mtt_…`).

## Claude Code (no code)

```bash
# macOS / Linux
curl -fsSL "https://mytokentracker.io/install.sh?token=YOUR_TOKEN" | bash

# Windows (PowerShell)
irm "https://mytokentracker.io/install.ps1?token=YOUR_TOKEN" | iex
```

Adds a Claude Code hook that captures every session automatically. That's it.

## Python (`python/mtt.py`)

Drop the file next to your code, set `MTT_TOKEN`, and wrap your SDK calls:

```python
from mtt import track_openai, track_anthropic

r = track_openai(client.chat.completions.create(...), use_case="chat")
r = track_anthropic(client.messages.create(...), use_case="agent")
```

## Node (`node/mtt.mjs`)

```js
import { trackOpenAI, trackAnthropic } from "./mtt.mjs";

const r = trackOpenAI(await client.chat.completions.create(...), { useCase: "chat" });
```

Both read `MTT_TOKEN` from the environment and POST to the events API in a background
thread. If the token is unset or the network hiccups, your app is unaffected.

## Any language / any provider

It's a plain HTTP endpoint — report usage from anything:

```bash
curl -X POST https://mytokentracker.io/api/v1/events \
  -H "Authorization: Bearer $MTT_TOKEN" -H "Content-Type: application/json" \
  -d '{"provider":"openai","model":"gpt-4o","input_tokens":1200,"output_tokens":350,"use_case":"chat"}'
```

Optional fields (`latency_ms`, `success`, `quality_score`, `cache_read_tokens`,
`reasoning_tokens`, `total_cost`, `session_id`, `project`, …) unlock richer views like
cost-per-successful-result. Full reference: [docs](https://mytokentracker.io/docs) ·
[OpenAPI](https://mytokentracker.io/openapi.json) · [llms.txt](https://mytokentracker.io/llms.txt).

## What gets sent

Usage metrics only — provider, model, platform, token counts, and the optional fields
above. **Never** your prompts, completions, file contents, or any of your data. See the
[privacy/security policy](https://mytokentracker.io). You can leave anytime from Settings.

## License

MIT — see [LICENSE](LICENSE). The hosted service is free; the public datasets are
[CC BY 4.0](https://mytokentracker.io/data).
