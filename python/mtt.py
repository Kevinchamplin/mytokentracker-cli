# mtt.py - MyTokenTracker auto-capture for the OpenAI + Anthropic Python SDKs.
# Drop this file next to your code, set MTT_TOKEN in your environment, and wrap
# your SDK responses. It is non-blocking (background thread) and fail-safe (every
# error is swallowed, your app never breaks), and it returns the original
# response untouched so it is a drop-in.
#
#   from mtt import track_openai, track_anthropic
#   r = track_openai(client.chat.completions.create(...), use_case="chat")
#
# Get your token at https://mytokentracker.io/settings
import os
import json
import threading
import urllib.request

_URL = os.environ.get("MTT_URL", "https://mytokentracker.io/api/v1/events")
_TOKEN = os.environ.get("MTT_TOKEN", "")


def _send(event: dict):
    if not _TOKEN:
        return

    def _post():
        try:
            req = urllib.request.Request(
                _URL,
                data=json.dumps(event).encode(),
                headers={"Authorization": "Bearer " + _TOKEN, "Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=3).read()
        except Exception:
            pass  # never break the caller

    threading.Thread(target=_post, daemon=True).start()


def _g(o, *names):
    for n in names:
        v = o.get(n) if isinstance(o, dict) else getattr(o, n, None)
        if v is not None:
            return v
    return None


def track_openai(resp, *, model=None, platform="python-sdk", **extra):
    u = _g(resp, "usage") or {}
    ptd = _g(u, "prompt_tokens_details") or {}
    ctd = _g(u, "completion_tokens_details") or {}
    itd = _g(u, "input_tokens_details") or {}    # Responses API
    otd = _g(u, "output_tokens_details") or {}
    _send({
        "provider": "openai", "platform": platform,
        "model": model or _g(resp, "model"),
        "input_tokens": _g(u, "prompt_tokens", "input_tokens") or 0,
        "output_tokens": _g(u, "completion_tokens", "output_tokens") or 0,
        "cache_read_tokens": _g(ptd, "cached_tokens") or _g(itd, "cached_tokens") or 0,
        "reasoning_tokens": _g(ctd, "reasoning_tokens") or _g(otd, "reasoning_tokens") or 0,
        **extra,
    })
    return resp


def track_anthropic(resp, *, model=None, platform="python-sdk", **extra):
    u = _g(resp, "usage") or {}
    _send({
        "provider": "anthropic", "platform": platform,
        "model": model or _g(resp, "model"),
        "input_tokens": _g(u, "input_tokens") or 0,
        "output_tokens": _g(u, "output_tokens") or 0,
        "cache_read_tokens": _g(u, "cache_read_input_tokens") or 0,
        "cache_write_tokens": _g(u, "cache_creation_input_tokens") or 0,
        **extra,
    })
    return resp
