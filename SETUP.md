# Super Simple Setup Guide (Ubuntu/Debian)

Copy-paste each block in order. Assumes the `erlc-cad` folder is on your server at `~/erlc-cad`.

---

## Step 1 — Install Node.js 20 and Python

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs python3 python3-venv python3-pip build-essential curl wget
node -v   # should say v20.x
```

---

## Step 2 — Create the Discord bot

1. Go to https://discord.com/developers/applications → **New Application** → name it (e.g. "Dispatch CAD").
2. Left menu → **Bot** → **Reset Token** → copy the token. **Save it, you'll need it in Step 6.**
3. Left menu → **OAuth2 → URL Generator**:
   - Scopes: check `bot` and `applications.commands`
   - Bot permissions: check `View Channels`, `Send Messages`, `Connect`, `Speak`
4. Copy the generated URL at the bottom, open it in your browser, and invite the bot to your server.

## Step 3 — Get your Discord IDs

1. In Discord: **User Settings → Advanced → turn ON Developer Mode**.
2. Right-click your **server name** → Copy Server ID → that's `GUILD_ID`.
3. Right-click the **text channel** where CAD updates should post → Copy Channel ID → `DISPATCH_CHANNEL_ID`.
4. Right-click your **dispatch voice channel** → Copy Channel ID → `VOICE_CHANNEL_ID`.

---

## Step 4 — Install the speech-to-text server (Whisper)

```bash
cd ~/erlc-cad/stt-server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Test it (first start downloads the model, ~460 MB — wait for "Application startup complete"):

```bash
.venv/bin/uvicorn server:app --host 127.0.0.1 --port 8077
```

In a **second terminal**: `curl http://127.0.0.1:8077/health` → should print `{"ok":true,...}`.
Leave this running for now (we make it permanent in Step 8).

---

## Step 5 — Install Piper (the dispatch voice)

```bash
sudo mkdir -p /opt/piper && cd /opt/piper
sudo wget https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
sudo tar -xzf piper_linux_x86_64.tar.gz
sudo wget https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx
sudo wget https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json
```

Test it — this should create `/tmp/test.wav` with a spoken sentence:

```bash
echo "Dispatch online." | /opt/piper/piper/piper --model /opt/piper/en_US-lessac-medium.onnx --output_file /tmp/test.wav
```

(On a Raspberry Pi / ARM server, use `piper_linux_aarch64.tar.gz` instead.)

---

## Step 6 — Configure the bot

```bash
cd ~/erlc-cad
cp .env.example .env
nano .env
```

Fill in:

```
DISCORD_TOKEN=   <- token from Step 2
GUILD_ID=        <- from Step 3
DISPATCH_CHANNEL_ID=
VOICE_CHANNEL_ID=
PIPER_BIN=/opt/piper/piper/piper
PIPER_MODEL=/opt/piper/en_US-lessac-medium.onnx
ERLC_SERVER_KEY= <- ERLC: Private Server Settings -> API (leave blank to skip)
```

Save with Ctrl+O, Enter, Ctrl+X.

---

## Step 7 — Install and start the bot

```bash
cd ~/erlc-cad
npm install
npm run register    # registers the /cad commands (run once)
npm start
```

In Discord, join your dispatch voice channel and type `/cad join`.
Say: **"Dispatch, seven adam twelve, show me ten eight."**
You should see an embed in your dispatch channel and hear the bot reply. 🎉

---

## Step 8 — Make it run forever (survives reboots and crashes)

Stop the bot (Ctrl+C) and the test STT server from Step 4, then:

```bash
sudo cp -r ~/erlc-cad /opt/erlc-cad
sudo cp /opt/erlc-cad/deploy/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now erlc-cad-stt erlc-cad-bot
```

Check everything is green:

```bash
systemctl status erlc-cad-stt erlc-cad-bot
```

View live logs anytime: `journalctl -u erlc-cad-bot -f`

> Note: after this step the live copy is `/opt/erlc-cad` — edit `.env` there and `sudo systemctl restart erlc-cad-bot` to apply changes.

---

## Quick fixes

| Problem | Fix |
|---|---|
| `/cad join` says STT not responding | `sudo systemctl restart erlc-cad-stt`, wait 30s (model loading) |
| Bot hears nothing | Make sure it joined with `/cad join` and you're not server-muted |
| No spoken replies | Re-run the Step 5 test; check `PIPER_BIN`/`PIPER_MODEL` paths in `.env` |
| Wrong words recognized | Add your street/callsign vocab to `INITIAL_PROMPT` in `stt-server/server.py` |
| `npm install` fails on `@discordjs/opus` | `sudo apt install -y build-essential python3` then retry |
