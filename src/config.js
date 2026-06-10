import 'dotenv/config';

function req(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing required env var: ${name}`); process.exit(1); }
  return v;
}

export const config = {
  token: req('DISCORD_TOKEN'),
  guildId: req('GUILD_ID'),
  dispatchChannelId: req('DISPATCH_CHANNEL_ID'),   // text channel for CAD embeds/transcripts
  voiceChannelId: req('VOICE_CHANNEL_ID'),         // dispatch radio voice channel

  // STT sidecar (faster-whisper FastAPI server)
  sttUrl: process.env.STT_URL || 'http://127.0.0.1:8077',

  // Piper TTS (leave PIPER_BIN empty to disable TTS)
  piperBin: process.env.PIPER_BIN || '',
  piperModel: process.env.PIPER_MODEL || '',

  // ERLC private server API (leave empty to disable sync)
  erlcServerKey: process.env.ERLC_SERVER_KEY || '',
  erlcPollSeconds: Number(process.env.ERLC_POLL_SECONDS || 20),

  // Voice tuning
  wakeWord: (process.env.WAKE_WORD || 'dispatch').toLowerCase(),
  silenceMs: Number(process.env.SILENCE_MS || 900),   // end-of-speech detection
  minSegmentMs: Number(process.env.MIN_SEGMENT_MS || 400),
  maxSegmentMs: Number(process.env.MAX_SEGMENT_MS || 30000),

  dbPath: process.env.DB_PATH || './cad.sqlite',
};

// 10-codes -> human status. Edit to match your community's codes.
export const TEN_CODES = {
  '10-4': 'Acknowledged',
  '10-6': 'Busy',
  '10-7': 'Out of Service',
  '10-8': 'Available',
  '10-11': 'Traffic Stop',
  '10-15': 'Suspect in Custody',
  '10-19': 'Returning to Station',
  '10-23': 'On Scene',
  '10-97': 'En Route',
};
