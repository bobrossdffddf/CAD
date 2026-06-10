import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import { config, TEN_CODES } from './config.js';
import * as db from './db.js';
import * as cad from './cad.js';
import { parse } from './parser.js';
import { JobQueue } from './voice/queue.js';
import { startListening } from './voice/listener.js';
import { transcribe, sttHealthy } from './voice/stt.js';
import { pcmToWav } from './voice/wav.js';
import { attachTts, speak, ttsEnabled } from './voice/tts.js';
import { startErlcSync } from './erlc.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
let dispatchChannel = null;

function post(embed) {
  dispatchChannel?.send({ embeds: [embed] }).catch(e => console.error('[post]', e.message));
}
const embed = (title, desc, color = 0x2b6cb0) =>
  new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color).setTimestamp();

// ---- The voice -> CAD pipeline (strict FIFO: one segment at a time, in order) ----
const sttQueue = new JobQueue(async (seg) => {
  const t0 = Date.now();
  const text = await transcribe(pcmToWav(seg.pcm));
  if (!text) { console.log(`[stt] heard nothing usable from ${seg.userId} (${seg.durationMs}ms)`); return; }

  const member = await client.guilds.cache.get(config.guildId)?.members.fetch(seg.userId).catch(() => null);
  const who = member?.displayName ?? seg.userId;
  console.log(`[stt] ${who}: "${text}"`);

  const cmd = parse(text);
  if (!cmd) { console.log(`[stt] ignored (no wake word "${config.wakeWord}")`); return; }
  console.log(`[cad] parsed:`, JSON.stringify(cmd));

  const result = cad.execute(cmd, seg.userId);
  const latency = ((Date.now() - t0) / 1000).toFixed(1);
  post(embed(
    result.ok ? 'CAD Update' : 'Not Understood',
    `${result.summary}\n\n> 🎙️ **${who}**: "${text}" *(queue: ${sttQueue.size}, ${latency}s)*`,
    result.ok ? 0x38a169 : 0xdd6b20,
  ));
  if (result.ack) speak(result.ack);
}, 'stt');

async function joinDispatch(guild) {
  const connection = joinVoiceChannel({
    channelId: config.voiceChannelId,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
  });
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

  // Auto-reconnect on drops instead of dying
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      connection.destroy();
      setTimeout(() => joinDispatch(guild).catch(console.error), 5_000);
    }
  });

  attachTts(connection);
  startListening(connection, (seg) => sttQueue.push(seg));
  return connection;
}

// ---- Slash commands ----
client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand() || i.commandName !== 'cad') return;
  const sub = i.options.getSubcommand();
  try {
    if (sub === 'join') {
      await i.deferReply({ ephemeral: true });
      if (!(await sttHealthy())) return i.editReply('⚠️ STT server is not responding — start the sidecar first.');
      await joinDispatch(i.guild);
      return i.editReply(`Listening in <#${config.voiceChannelId}>. Say "${config.wakeWord}, ..." ${ttsEnabled ? '(TTS on)' : '(TTS off)'}`);
    }
    if (sub === 'leave') {
      getVoiceConnection(i.guildId)?.destroy();
      return i.reply({ content: 'Left voice.', ephemeral: true });
    }
    if (sub === 'units') {
      const units = db.listUnits();
      const lines = units.length
        ? units.map(u => `**${u.callsign}** — ${u.status} (${TEN_CODES[u.status] ?? '?'})${u.roblox_name ? ` · ${u.roblox_name}` : ''}`).join('\n')
        : 'No units yet.';
      return i.reply({ embeds: [embed('Units', lines)] });
    }
    if (sub === 'calls') {
      const calls = db.openCalls();
      const lines = calls.length
        ? calls.map(c => `**#${c.id}** [P${c.priority}] ${c.description}${c.location ? ` @ ${c.location}` : ''} — ${db.callUnits(c.id).join(', ') || 'unassigned'}`).join('\n')
        : 'No open calls.';
      return i.reply({ embeds: [embed('Open Calls', lines)] });
    }
    if (sub === 'bolos') {
      const bolos = db.activeBolos();
      return i.reply({ embeds: [embed('Active BOLOs', bolos.length ? bolos.map(b => `**#${b.id}** ${b.description}`).join('\n') : 'None.')] });
    }
    if (sub === 'link') {
      const callsign = i.options.getString('callsign').toUpperCase();
      const roblox = i.options.getString('roblox');
      db.upsertUnit(callsign, { discord_id: i.user.id, ...(roblox ? { roblox_name: roblox } : {}) });
      return i.reply({ content: `Linked you to **${callsign}**${roblox ? ` (Roblox: ${roblox})` : ''}.`, ephemeral: true });
    }
  } catch (err) {
    console.error('[interaction]', err);
    const msg = { content: `Error: ${err.message}`, ephemeral: true };
    i.deferred ? i.editReply(msg).catch(() => {}) : i.reply(msg).catch(() => {});
  }
});

// Auto-join the dispatch voice channel on startup and never leave:
// retries until the STT server is up, and re-attempts after any failure.
async function autoJoin() {
  try {
    if (!(await sttHealthy())) throw new Error('STT server not ready yet');
    const guild = await client.guilds.fetch(config.guildId);
    await joinDispatch(guild);
    console.log(`Listening in voice channel ${config.voiceChannelId} (TTS ${ttsEnabled ? 'on' : 'off'})`);
  } catch (err) {
    console.error('[voice] join failed, retrying in 15s:', err.message);
    setTimeout(autoJoin, 15_000);
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  dispatchChannel = await client.channels.fetch(config.dispatchChannelId).catch(() => null);
  if (!dispatchChannel) console.error('Could not fetch dispatch channel — check DISPATCH_CHANNEL_ID');
  autoJoin();

  startErlcSync((ev) => {
    if (ev.type === 'join') post(embed('Player Joined', `**${ev.name}** joined the in-game server.`, 0x38a169));
    if (ev.type === 'leave') post(embed('Player Left', `**${ev.name}** left the in-game server.`, 0x718096));
    if (ev.type === 'auto_offduty') {
      post(embed('Auto Status', `**${ev.callsign}** set **10-7** (player ${ev.name} left game).`, 0xdd6b20));
      speak(`${ev.callsign.replaceAll('-', ' ')} shown 10 7, left the game.`);
    }
  });
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
client.login(config.token);
