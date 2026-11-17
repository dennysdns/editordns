import { AudioClip } from '../types/studio';

let sharedAudioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedAudioCtx) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}

export async function decodeAudioBlob(
  blob: Blob
): Promise<{ buffer: AudioBuffer; duration: number; peaks: number[] }> {
  const ctx = getAudioContext();
  const arrayBuf = await blob.arrayBuffer();
  const buffer = await ctx.decodeAudioData(arrayBuf.slice(0));
  const peaks = extractWaveformPeaks(buffer, 96);
  return { buffer, duration: buffer.duration, peaks };
}

export function extractWaveformPeaks(buffer: AudioBuffer, bars = 96): number[] {
  const channel = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(channel.length / bars));
  const peaks: number[] = [];
  for (let i = 0; i < bars; i++) {
    const start = i * blockSize;
    let max = 0;
    for (let j = 0; j < blockSize && start + j < channel.length; j++) {
      const val = Math.abs(channel[start + j]);
      if (val > max) max = val;
    }
    peaks.push(Math.min(1, max));
  }
  return peaks;
}

export function encodeAudioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numChannels * 2;
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export async function mixAudioClipsOffline(
  clips: AudioClip[],
  mediaBlobs: Map<string, Blob>,
  sampleRate = 44100
): Promise<Blob> {
  if (clips.length === 0) {
    throw new Error('Nenhum clipe de áudio para exportar.');
  }

  const hasSolo = clips.some((c) => c.solo);
  const activeClips = clips.filter((c) => !c.muted && (!hasSolo || c.solo));
  if (activeClips.length === 0) {
    throw new Error('Todas as faixas estão silenciadas.');
  }

  const totalDuration = Math.max(
    1,
    ...activeClips.map((c) => c.startTime + c.duration / Math.max(0.25, c.speed))
  );

  const offline = new OfflineAudioContext(2, Math.ceil(totalDuration * sampleRate), sampleRate);

  for (const clip of activeClips) {
    const blob = mediaBlobs.get(clip.mediaId);
    if (!blob) continue;
    const arr = await blob.arrayBuffer();
    const decoded = await offline.decodeAudioData(arr.slice(0));

    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.playbackRate.value = clip.speed;

    const bass = offline.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 120;
    bass.gain.value = clip.eqBass;

    const mid = offline.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1000;
    mid.gain.value = clip.eqMid;

    const treble = offline.createBiquadFilter();
    treble.type = 'highshelf';
    treble.frequency.value = 6000;
    treble.gain.value = clip.eqTreble;

    const gainNode = offline.createGain();
    const startAt = clip.startTime;
    const playDur = clip.duration / Math.max(0.25, clip.speed);
    const fadeIn = Math.min(clip.fadeIn, playDur * 0.45);
    const fadeOut = Math.min(clip.fadeOut, playDur * 0.45);

    if (fadeIn > 0.01) {
      gainNode.gain.setValueAtTime(0.001, startAt);
      gainNode.gain.linearRampToValueAtTime(clip.gain, startAt + fadeIn);
    } else {
      gainNode.gain.setValueAtTime(clip.gain, startAt);
    }

    if (fadeOut > 0.01) {
      gainNode.gain.setValueAtTime(clip.gain, startAt + playDur - fadeOut);
      gainNode.gain.linearRampToValueAtTime(0.001, startAt + playDur);
    }

    source.connect(bass);
    bass.connect(mid);
    mid.connect(treble);
    treble.connect(gainNode);
    gainNode.connect(offline.destination);

    source.start(startAt, clip.trimStart, clip.duration);
  }

  const rendered = await offline.startRendering();
  return encodeAudioBufferToWav(rendered);
}

/**
 * Pure deterministic offline synth loop generator (no AI, pure Web Audio math)
 * so users can generate a local beat/melody WAV directly on device anytime.
 */
export async function generateLocalSynthLoopWav(
  style: 'batida-eletronica' | 'trilha-ambiente' | 'efeito-arcade',
  bpm = 110,
  bars = 2
): Promise<Blob> {
  const sampleRate = 44100;
  const beatSec = 60 / bpm;
  const duration = beatSec * 4 * bars;
  const offline = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);

  const totalBeats = 4 * bars;
  for (let b = 0; b < totalBeats * 2; b++) {
    const t = b * (beatSec / 2);
    if (style === 'batida-eletronica') {
      if (b % 2 === 0) {
        // Kick
        const osc = offline.createOscillator();
        const g = offline.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(42, t + 0.14);
        g.gain.setValueAtTime(0.8, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.connect(g);
        g.connect(offline.destination);
        osc.start(t);
        osc.stop(t + 0.19);
      }
      if (b % 4 === 2) {
        // Snare synth snap
        const osc = offline.createOscillator();
        const g = offline.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(240, t);
        osc.frequency.exponentialRampToValueAtTime(90, t + 0.08);
        g.gain.setValueAtTime(0.45, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.connect(g);
        g.connect(offline.destination);
        osc.start(t);
        osc.stop(t + 0.11);
      }
      // Bassline
      const notes = [110, 110, 130.81, 146.83, 110, 164.81, 146.83, 130.81];
      const osc = offline.createOscillator();
      const g = offline.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(notes[b % notes.length], t);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(g);
      g.connect(offline.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    } else if (style === 'trilha-ambiente') {
      if (b % 4 === 0) {
        const freqs = [220, 277.18, 329.63, 440];
        freqs.forEach((f) => {
          const osc = offline.createOscillator();
          const g = offline.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(f, t);
          g.gain.setValueAtTime(0.001, t);
          g.gain.linearRampToValueAtTime(0.12, t + 0.3);
          g.gain.exponentialRampToValueAtTime(0.001, t + beatSec * 1.9);
          osc.connect(g);
          g.connect(offline.destination);
          osc.start(t);
          osc.stop(t + beatSec * 2);
        });
      }
    } else {
      // Efeito arcade arpeggio
      const arp = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63];
      const osc = offline.createOscillator();
      const g = offline.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(arp[b % arp.length], t);
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(g);
      g.connect(offline.destination);
      osc.start(t);
      osc.stop(t + 0.17);
    }
  }

  const buf = await offline.startRendering();
  return encodeAudioBufferToWav(buf);
}
