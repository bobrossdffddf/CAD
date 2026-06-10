// Polls the official ER:LC private-server API (v2) and syncs in-game presence with CAD.
// Docs: https://apidocs.erlc.gg — requires the ERLC API server pack; key from in-game
// Settings -> API key (or https://erlc.link/sk). Sent as the lowercase `server-key` header.

import { config } from './config.js';
import * as db from './db.js';

const BASE = 'https://api.erlc.gg/v2';
let prevPlayers = null; // Set of player names from the previous poll

async function api(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'server-key': config.erlcServerKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after') || 30);
    throw Object.assign(new Error('rate limited'), { retryAfter: retry });
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = ` (code ${body.code ?? '?'}: ${body.message ?? body.error ?? 'see https://apidocs.erlc.gg/error-codes'})`;
    } catch { /* no JSON body */ }
    throw new Error(`ERLC API ${path} -> ${res.status}${detail}`);
  }
  return res.json();
}

export function startErlcSync(onEvent) {
  if (!config.erlcServerKey) {
    console.log('[erlc] no ERLC_SERVER_KEY set, sync disabled');
    return;
  }
  let delay = config.erlcPollSeconds * 1000;

  const tick = async () => {
    try {
      const data = await api('/server?Players=true');
      const players = data.Players ?? [];
      const current = new Set(players.map(p => String(p.Player).split(':')[0]));

      if (prevPlayers) {
        for (const name of current) {
          if (!prevPlayers.has(name)) onEvent({ type: 'join', name });
        }
        for (const name of prevPlayers) {
          if (!current.has(name)) {
            onEvent({ type: 'leave', name });
            // Auto 10-7 any linked unit whose player left the game
            const unit = db.getUnitByRoblox(name);
            if (unit && unit.status !== '10-7') {
              db.upsertUnit(unit.callsign, { status: '10-7' });
              onEvent({ type: 'auto_offduty', name, callsign: unit.callsign });
            }
          }
        }
      }
      prevPlayers = current;
      delay = config.erlcPollSeconds * 1000; // reset backoff on success
    } catch (err) {
      if (err.retryAfter) delay = Math.max(delay, err.retryAfter * 1000);
      else delay = Math.min(delay * 2, 5 * 60_000); // exponential backoff, cap 5 min
      console.error('[erlc] poll failed:', err.message);
    }
    setTimeout(tick, delay);
  };
  tick();
}
