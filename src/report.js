// Local terminal report: spend per agent over a window, plus what a flat-rate
// plan was worth against pay-as-you-go API prices.
import { summarize } from './buckets.js';

const AGENT_NAMES = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  copilot: 'Copilot CLI',
  opencode: 'OpenCode',
  amp: 'Amp',
  qwen: 'Qwen Code',
  antigravity: 'Antigravity',
  grok: 'Grok Build CLI',
};

const usd = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function compactTokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export function renderReport(buckets, { since, until, plan } = {}) {
  const { agents, total } = summarize(buckets);
  const lines = [];
  lines.push('');
  lines.push(`  MyTokenTracker  ${since} to ${until}`);
  lines.push('');
  if (!agents.length) {
    lines.push('  No AI coding usage found on this machine for that window.');
    lines.push('');
    return lines.join('\n');
  }

  const rows = agents.map((a) => [AGENT_NAMES[a.agent] ?? a.agent, usd(a.cost), compactTokens(a.tokens), String(a.days)]);
  const head = ['Agent', 'API value', 'Tokens', 'Days'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r) => '  ' + r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('   ');

  lines.push(fmt(head));
  lines.push('  ' + widths.map((w) => '-'.repeat(w)).join('   '));
  rows.forEach((r) => lines.push(fmt(r)));
  lines.push('  ' + widths.map((w) => '-'.repeat(w)).join('   '));
  lines.push(fmt(['Total', usd(total.cost), compactTokens(total.tokens), '']));
  lines.push('');

  if (plan > 0) {
    const days = Math.max(1, Math.round((Date.parse(until) - Date.parse(since)) / 86400000) + 1);
    const planCost = (plan * days) / 30;
    const multiple = total.cost / planCost;
    lines.push(`  At API prices this usage is worth ${usd(total.cost)}.`);
    lines.push(`  A $${plan}/month plan costs about ${usd(planCost)} for these ${days} days: ${multiple.toFixed(1)}x value.`);
    lines.push('');
  }
  return lines.join('\n');
}
