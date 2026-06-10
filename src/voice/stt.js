// Client for the local faster-whisper sidecar (stt-server/server.py).

import { config } from '../config.js';

export async function transcribe(wavBuffer) {
  const res = await fetch(`${config.sttUrl}/transcribe`, {
    method: 'POST',
    headers: { 'content-type': 'audio/wav' },
    body: wavBuffer,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`STT server returned ${res.status}`);
  const data = await res.json();
  return (data.text || '').trim();
}

export async function sttHealthy() {
  try {
    const res = await fetch(`${config.sttUrl}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}
