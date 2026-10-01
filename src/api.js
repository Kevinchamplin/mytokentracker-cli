// Thin client for the MyTokenTracker ingest API. Uses Node's built-in fetch.
import { chunk } from './buckets.js';

const BATCH = 500;

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'mytokentracker-cli',
  };
}

// Posts an empty batch: the server resolves the token before validating, so a
// good token gets 422 and a bad one 401. Nothing is stored either way.
export async function checkToken(api, token) {
  const res = await fetch(`${api}/api/v1/buckets`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ machine_id: 'probe00', buckets: [] }),
  });
  if (res.status === 401 || res.status === 403) return { ok: false, status: res.status };
  return { ok: res.status === 422 || res.ok, status: res.status };
}

export async function uploadBuckets({ api, token, machineId, client, buckets }) {
  let upserted = 0;
  for (const batch of chunk(buckets, BATCH)) {
    const res = await fetch(`${api}/api/v1/buckets`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ machine_id: machineId, client, buckets: batch }),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body.message || JSON.stringify(body.errors ?? body).slice(0, 300);
      } catch {
        /* not JSON */
      }
      if (res.status === 401) throw new Error('The API token was rejected. Run `mytokentracker init` with a fresh token.');
      if (res.status === 429) throw new Error('Rate limited by the server. The next scheduled sync will retry.');
      throw new Error(`Upload failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
    }
    const body = await res.json().catch(() => ({}));
    upserted += Number(body.upserted ?? batch.length);
  }
  return upserted;
}
