// Turns `ccusage daily --json --by-agent --breakdown` output into flat
// per-(date, agent, model) buckets, the unit the /api/v1/buckets endpoint stores.

const int = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

export function flattenDaily(report) {
  const rows = Array.isArray(report?.daily) ? report.daily : [];
  const out = [];

  for (const row of rows) {
    const date = row.period ?? row.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) continue;

    // With --by-agent each row carries an `agents` list; a single-agent report
    // may instead put the agent fields on the row itself.
    const agents = Array.isArray(row.agents) && row.agents.length ? row.agents : [row];

    for (const a of agents) {
      const agent = String(a.agent ?? 'unknown').toLowerCase();
      if (agent === 'all') continue;
      for (const m of a.modelBreakdowns ?? []) {
        const b = {
          date,
          agent,
          model: String(m.modelName ?? 'unknown').slice(0, 100),
          input_tokens: int(m.inputTokens),
          output_tokens: int(m.outputTokens),
          cache_read_tokens: int(m.cacheReadTokens),
          cache_write_tokens: int(m.cacheCreationTokens),
          cost_usd: Number.isFinite(Number(m.cost)) ? Number(m.cost) : null,
        };
        if (b.input_tokens + b.output_tokens + b.cache_read_tokens + b.cache_write_tokens > 0) out.push(b);
      }
    }
  }
  return out;
}

// Machines that ran the legacy Claude Code hook already sent Claude usage up to
// the cutover, so Claude buckets before `claudeSince` are dropped to avoid
// counting the same transcripts twice. Other agents always backfill in full.
export function applyCutover(buckets, claudeSince) {
  if (!claudeSince) return buckets;
  return buckets.filter((b) => b.agent !== 'claude' || b.date >= claudeSince);
}

export function summarize(buckets) {
  const byAgent = new Map();
  let total = { cost: 0, tokens: 0 };
  for (const b of buckets) {
    const tokens = b.input_tokens + b.output_tokens + b.cache_read_tokens + b.cache_write_tokens;
    const cost = b.cost_usd ?? 0;
    const cur = byAgent.get(b.agent) ?? { agent: b.agent, cost: 0, tokens: 0, days: new Set(), models: new Set() };
    cur.cost += cost;
    cur.tokens += tokens;
    cur.days.add(b.date);
    cur.models.add(b.model);
    byAgent.set(b.agent, cur);
    total.cost += cost;
    total.tokens += tokens;
  }
  const agents = [...byAgent.values()]
    .map((a) => ({ ...a, days: a.days.size, models: [...a.models] }))
    .sort((x, y) => y.cost - x.cost);
  return { agents, total };
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
