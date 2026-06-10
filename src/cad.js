// Executes parsed commands against the CAD database.
// Returns { ok, summary, ack } — summary for the dispatch embed, ack for TTS readback.

import * as db from './db.js';
import { TEN_CODES } from './config.js';

function sayCallsign(cs) { return cs.replaceAll('-', ' '); }
function sayCode(code) { return code.replace('-', ' '); }

export function execute(cmd, speakerDiscordId) {
  switch (cmd.type) {
    case 'status': {
      let callsign = cmd.callsign;
      if (!callsign) {
        const unit = db.getUnitByDiscord(speakerDiscordId);
        if (!unit) return { ok: false, summary: 'Status with no callsign and speaker has no linked unit. Use `/cad link`.', ack: 'Unit, identify yourself.' };
        callsign = unit.callsign;
      }
      db.upsertUnit(callsign, { status: cmd.code, ...(cmd.callsign ? {} : {}) });
      if (!db.getUnit(callsign).discord_id && speakerDiscordId) db.upsertUnit(callsign, { discord_id: speakerDiscordId });
      const label = TEN_CODES[cmd.code] ?? cmd.code;
      db.logEvent('status', `${callsign} -> ${cmd.code}`);
      return { ok: true, summary: `**${callsign}** is now **${cmd.code}** (${label})`, ack: `${sayCallsign(callsign)}, acknowledged, ${sayCode(cmd.code)}.` };
    }

    case 'new_call': {
      const id = db.createCall(cmd.description, cmd.location, cmd.priority);
      db.logEvent('call_open', `#${id} ${cmd.description}`);
      const loc = cmd.location ? ` at **${cmd.location}**` : '';
      return { ok: true, summary: `Call **#${id}** opened (P${cmd.priority}): ${cmd.description}${loc}`, ack: `Call ${id} created, priority ${cmd.priority}.` };
    }

    case 'attach': {
      if (!db.getCall(cmd.callId)) return { ok: false, summary: `Call #${cmd.callId} not found.`, ack: `Negative, no call ${cmd.callId}.` };
      db.upsertUnit(cmd.callsign, {});
      db.attachUnit(cmd.callId, cmd.callsign);
      db.upsertUnit(cmd.callsign, { status: '10-97' });
      db.logEvent('attach', `${cmd.callsign} -> #${cmd.callId}`);
      return { ok: true, summary: `**${cmd.callsign}** attached to call **#${cmd.callId}**`, ack: `${sayCallsign(cmd.callsign)}, attached to call ${cmd.callId}.` };
    }

    case 'close_call': {
      if (!db.closeCall(cmd.callId)) return { ok: false, summary: `Call #${cmd.callId} not found or already closed.`, ack: `Negative, call ${cmd.callId} is not open.` };
      db.logEvent('call_close', `#${cmd.callId}`);
      return { ok: true, summary: `Call **#${cmd.callId}** closed.`, ack: `Call ${cmd.callId} closed.` };
    }

    case 'bolo': {
      const id = db.addBolo(cmd.description);
      db.logEvent('bolo', cmd.description);
      return { ok: true, summary: `BOLO **#${id}** issued: ${cmd.description}`, ack: `BOLO ${id} issued.` };
    }

    case 'link': {
      db.upsertUnit(cmd.callsign, { discord_id: speakerDiscordId });
      db.logEvent('link', `${cmd.callsign} <- ${speakerDiscordId}`);
      return { ok: true, summary: `Speaker linked to **${cmd.callsign}**`, ack: `${sayCallsign(cmd.callsign)}, you are linked.` };
    }

    case 'unknown':
    default:
      return { ok: false, summary: `Heard but not understood: \`${cmd.text ?? ''}\``, ack: null };
  }
}
