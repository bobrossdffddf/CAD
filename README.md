# ERLC Voice CAD

Fully self-hosted, free, automated CAD system for ERLC as a Discord bot with voice recognition.

How it works: the bot sits in your dispatch voice channel, captures each utterance per-user, and pushes it into a **strict FIFO queue** — if 3 people talk at once, segments are transcribed and executed one at a time in the order each person finished speaking. Transcription runs on a local faster-whisper sidecar (no cloud, no cost). Recognized commands update the CAD database, post an embed to your dispatch channel, and (optionally) get a spoken acknowledgement via Piper TTS. The ERLC private-server API is polled to log joins/leaves and auto-10-7 units whose player left the game.

```
Voice channel → listener (per-user capture) → FIFO queue → faster-whisper (local)
             → parser (10-codes / callsigns) → CAD (SQLite) → dispatch embeds + Piper TTS
ERLC API poller → join/leave events → auto unit status
```

## Requirements

- Linux server, Node.js 20+, Python 3.10+
- ~3 GB RAM headroom for the `small.en` Whisper model (int8)
- A Discord bot with **Server Members Intent** off is fine; it needs `Guilds` + `GuildVoiceStates`. Invite with `bot` + `applications.commands` scopes and permission to view/connect/speak in your channels.
- ERLC private server with API access (Server Settings → API) — optional but recommended.

## Setup

### 1. STT sidecar

```bash
cd erlc-cad/stt-server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn server:app --host 127.0.0.1 --port 8077
```

First start downloads the model (~460 MB). Test: `curl http://127.0.0.1:8077/health`

### 2. Piper TTS (optional, for spoken dispatch replies)

Download a release binary and a voice from https://github.com/rhasspy/piper (e.g. `en_US-lessac-medium.onnx` + its `.json`). Set `PIPER_BIN` and `PIPER_MODEL` in `.env`. Leave blank to disable TTS.

### 3. Bot

```bash
cd erlc-cad
cp .env.example .env   # fill in token, IDs, ERLC key
npm install
npm run register       # registers /cad slash commands (once)
npm start
```

Then in Discord: `/cad join` — the bot joins the voice channel and starts listening.

### 4. Run forever (systemd)

```bash
sudo cp -r erlc-cad /opt/erlc-cad
sudo cp /opt/erlc-cad/deploy/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now erlc-cad-stt erlc-cad-bot
```

Both services auto-restart on crash; the bot auto-rejoins voice on disconnects and the ERLC poller backs off on rate limits.

## Voice commands

All commands start with the wake word (default `dispatch`). Spoken numbers and LAPD/NATO phonetics are normalized automatically ("seven adam twelve ten eight" → `7-ADAM-12` / `10-8`).

| Say | Effect |
|---|---|
| "Dispatch, 7-Adam-12, show me 10-8" | Unit status → 10-8 |
| "Dispatch, 10-7" | Status for the speaker's linked unit |
| "Dispatch, 7-Adam-12 on scene" / "en route" / "code 4" | Mapped status phrases |
| "Dispatch, new call priority 2 robbery at the bank" | Opens call #N |
| "Dispatch, attach 7-Adam-12 to call 3" | Assigns unit, sets 10-97 |
| "Dispatch, clear call 3" | Closes the call |
| "Dispatch, BOLO white sedan heading north" | Issues a BOLO |

Slash commands: `/cad join`, `/cad leave`, `/cad units`, `/cad calls`, `/cad bolos`, `/cad link callsign:<X> roblox:<name>`.

Linking your Roblox name lets the ERLC sync auto-10-7 you when you leave the game. Saying a status with no callsign uses your linked unit.

## Tuning & customization

- **10-codes**: edit `TEN_CODES` in `src/config.js` to match your community.
- **Recognition accuracy**: the sidecar's `INITIAL_PROMPT` in `stt-server/server.py` biases Whisper toward your vocabulary — add your street names, callsign patterns, and codes there.
- **Latency vs accuracy**: `WHISPER_MODEL=base.en` is ~2x faster, `small.en` (default) is more accurate. On 8 GB RAM stick with `small.en` int8.
- **Silence detection**: `SILENCE_MS` (default 900) — lower means snappier but may cut off slow talkers.
- **Reliability notes**: Discord voice receive is not an officially documented feature; the pinned discord.js/@discordjs/voice versions are known-good. Test after any dependency upgrade.

## Expected latency

On a modern 4-core CPU with `small.en` int8: roughly 1–3 s from end of speech to CAD update for a short radio call. Queue depth is shown in each dispatch embed so you can see backlog under load.
# CAD
