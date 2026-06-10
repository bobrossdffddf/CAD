// Piper TTS -> plays dispatch acknowledgements into the voice channel.
// Serialized with its own FIFO queue so replies never talk over each other.
// Disabled automatically if PIPER_BIN / PIPER_MODEL are not configured.

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior } from '@discordjs/voice';
import { config } from '../config.js';
import { JobQueue } from './queue.js';

const enabled = Boolean(config.piperBin && config.piperModel);
const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
let subscribed = false;

function synthesize(text, outPath) {
  return new Promise((resolve, reject) => {
    const p = spawn(config.piperBin, ['--model', config.piperModel, '--output_file', outPath]);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`piper exited ${code}: ${err.slice(-300)}`))));
    p.on('error', reject);
    p.stdin.write(text);
    p.stdin.end();
  });
}

function playFile(path) {
  return new Promise((resolve, reject) => {
    const resource = createAudioResource(path);
    const onIdle = () => { cleanup(); resolve(); };
    const onError = (e) => { cleanup(); reject(e); };
    const cleanup = () => {
      player.off(AudioPlayerStatus.Idle, onIdle);
      player.off('error', onError);
    };
    player.on(AudioPlayerStatus.Idle, onIdle);
    player.on('error', onError);
    player.play(resource);
  });
}

const ttsQueue = new JobQueue(async ({ text }) => {
  const out = join(tmpdir(), `cad-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  try {
    await synthesize(text, out);
    await playFile(out);
  } finally {
    unlink(out).catch(() => {});
  }
}, 'tts');

export function attachTts(connection) {
  if (!enabled) return;
  if (!subscribed) { connection.subscribe(player); subscribed = true; }
}

export function speak(text) {
  if (!enabled || !text) return;
  ttsQueue.push({ text });
}

export const ttsEnabled = enabled;
