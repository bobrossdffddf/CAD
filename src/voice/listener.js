// Captures per-user speech from the voice channel. Each utterance is decoded
// to PCM, ended after `silenceMs` of silence, and handed to onSegment().
// Each user's capture is independent, so 3 people talking at once produce
// 3 separate segments — ordering is enforced downstream by the FIFO queue.

import { EndBehaviorType } from '@discordjs/voice';
import prism from 'prism-media';
import { config } from '../config.js';

const SAMPLE_RATE = 48000;
const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000; // 16-bit mono

export function startListening(connection, onSegment) {
  const receiver = connection.receiver;
  const active = new Set();

  receiver.speaking.on('start', (userId) => {
    if (active.has(userId)) return;
    active.add(userId);

    const opusStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: config.silenceMs },
    });
    const decoder = new prism.opus.Decoder({ rate: SAMPLE_RATE, channels: 1, frameSize: 960 });

    const chunks = [];
    let bytes = 0;
    const maxBytes = config.maxSegmentMs * BYTES_PER_MS;
    const startedAt = Date.now();

    decoder.on('data', (chunk) => {
      if (bytes < maxBytes) { chunks.push(chunk); bytes += chunk.length; }
    });

    const finish = () => {
      if (!active.has(userId)) return;
      active.delete(userId);
      const pcm = Buffer.concat(chunks);
      const durationMs = pcm.length / BYTES_PER_MS;
      if (durationMs >= config.minSegmentMs) {
        onSegment({ userId, pcm, durationMs: Math.round(durationMs), startedAt, endedAt: Date.now() });
      }
    };

    decoder.once('end', finish);
    decoder.once('close', finish);
    opusStream.once('error', (err) => { console.error('[voice] opus stream error:', err.message); finish(); });
    decoder.once('error', (err) => { console.error('[voice] decoder error:', err.message); finish(); });

    opusStream.pipe(decoder);
  });
}
