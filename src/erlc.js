// Polls the official ERLC private-server API and syncs in-game presence with CAD.
// Docs: https://apidocs.policeroleplay.community  (key from your private server settings)

import { config } from './config.js';
import * as db from './db.js';

const BASE = 'https://api.policeroleplay.community/v1';
let prevPlayers = null; // Set of player names from the previous poll

async function api(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Server-Key': config.erlcServerKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after') || 30);
    throw Object.assign(new Error('rate limited'), { retryAfter: retry });
  }
  if (!res.ok) throw new Error(`ERLC API ${path} -> ${res.status}`);
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
      const players = await api('/server/players'); // [{ Player: "Name:id", Team, Callsign?, Permission }]
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
