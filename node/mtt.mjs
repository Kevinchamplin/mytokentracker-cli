// mtt.mjs - MyTokenTracker auto-capture for the OpenAI, Anthropic, Google Gemini,
// and Mistral Node SDKs.
// Set MTT_TOKEN in your environment, then wrap your SDK responses. Fire-and-forget
// and fail-safe: it never throws into your code, and returns the original response.
//
//   import { trackOpenAI, trackAnthropic, trackGoogle, trackMistral } from "./mtt.mjs";
//   const r = trackOpenAI(await client.chat.completions.create(...), { use_case: "agent" });
//   const r = trackAnthropic(await client.messages.create(...), { use_case: "agent" });
//   const r = trackGoogle(await client.models.generateContent(...), { use_case: "chat" });
//   const r = trackMistral(await client.chat.complete(...), { use_case: "chat" });
//
// Get your token at https://mytokentracker.io/settings
const URL = process.env.MTT_URL ?? "https://mytokentracker.io/api/v1/events";
const TOKEN = process.env.MTT_TOKEN ?? "";

function send(event) {
  if (!TOKEN) return;
  fetch(URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {}); // swallow every error so we never break the caller
}

const n = (v) => (typeof v === "number" ? v : 0);

export function trackOpenAI(resp, extra = {}) {
  const u = resp?.usage ?? {};
  const ptd = u.prompt_tokens_details ?? u.input_tokens_details ?? {};
  const ctd = u.completion_tokens_details ?? u.output_tokens_details ?? {};
  send({
    provider: "openai",
    platform: extra.platform ?? "node-sdk",
    model: extra.model ?? resp?.model,
    input_tokens: n(u.prompt_tokens ?? u.input_tokens),
    output_tokens: n(u.completion_tokens ?? u.output_tokens),
    cache_read_tokens: n(ptd.cached_tokens),
    reasoning_tokens: n(ctd.reasoning_tokens),
    ...extra,
  });
  return resp;
}

export function trackAnthropic(resp, extra = {}) {
  const u = resp?.usage ?? {};
  send({
    provider: "anthropic",
    platform: extra.platform ?? "node-sdk",
    model: extra.model ?? resp?.model,
    input_tokens: n(u.input_tokens),
    output_tokens: n(u.output_tokens),
    cache_read_tokens: n(u.cache_read_input_tokens),
    cache_write_tokens: n(u.cache_creation_input_tokens),
    ...extra,
  });
  return resp;
}

export function trackGoogle(resp, extra = {}) {
  const u = resp?.usageMetadata ?? {};
  send({
    provider: "google",
    platform: extra.platform ?? "node-sdk",
    model: extra.model ?? resp?.modelVersion,
    input_tokens: n(u.promptTokenCount),
    // Gemini bills "thoughts" at the output rate and excludes them from the
    // candidates count, so fold them into output for accurate cost.
    output_tokens: n(u.candidatesTokenCount) + n(u.thoughtsTokenCount),
    cache_read_tokens: n(u.cachedContentTokenCount),
    ...extra,
  });
  return resp;
}

export function trackMistral(resp, extra = {}) {
  const u = resp?.usage ?? {};
  send({
    provider: "mistral",
    platform: extra.platform ?? "node-sdk",
    model: extra.model ?? resp?.model,
    input_tokens: n(u.prompt_tokens),
    output_tokens: n(u.completion_tokens),
    ...extra,
  });
  return resp;
}
