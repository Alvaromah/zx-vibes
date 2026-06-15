import { TSTATES_PER_FRAME } from './run-loop.js';
import type { AudioEdge, AudioToneSegment } from './machine.js';

const CPU_HZ = TSTATES_PER_FRAME * 50;

export interface AudioAnalysis {
  edgeTimeline: AudioEdge[];
  toneSegments: AudioToneSegment[];
  dominantHz?: number;
}

export function analyzeBeeperTimeline(edges: AudioEdge[]): AudioAnalysis {
  const toneSegments = estimateToneSegments(edges);
  const dominantHz = dominantFrequency(toneSegments);
  return {
    edgeTimeline: edges,
    toneSegments,
    ...(dominantHz !== undefined ? { dominantHz } : {}),
  };
}

export function encodeBeeperWav(edges: AudioEdge[], durationTstates: number, sampleRate = 44100): Buffer {
  const sampleCount = Math.max(1, Math.ceil((durationTstates / CPU_HZ) * sampleRate));
  const pcm = Buffer.alloc(sampleCount * 2);
  let edgeIndex = 0;
  let level = edges[0]?.level === 0 ? 1 : 0;
  for (let i = 0; i < sampleCount; i++) {
    const tstate = Math.floor((i / sampleRate) * CPU_HZ);
    while (edgeIndex < edges.length && edges[edgeIndex]!.tstate <= tstate) {
      level = edges[edgeIndex]!.level;
      edgeIndex++;
    }
    const sample = level ? 12000 : -12000;
    pcm.writeInt16LE(sample, i * 2);
  }

  const out = Buffer.alloc(44 + pcm.length);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + pcm.length, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(pcm.length, 40);
  pcm.copy(out, 44);
  return out;
}

function estimateToneSegments(edges: AudioEdge[]): AudioToneSegment[] {
  if (edges.length < 4) return [];
  const segments: AudioToneSegment[] = [];
  let startIndex = 0;
  let lastHalfPeriod = 0;
  for (let i = 1; i < edges.length; i++) {
    const halfPeriod = edges[i]!.tstate - edges[i - 1]!.tstate;
    if (halfPeriod <= 0) continue;
    if (lastHalfPeriod > 0 && Math.abs(halfPeriod - lastHalfPeriod) / lastHalfPeriod > 0.25) {
      pushSegment(segments, edges, startIndex, i - 1);
      startIndex = i - 1;
    }
    lastHalfPeriod = halfPeriod;
  }
  pushSegment(segments, edges, startIndex, edges.length - 1);
  return segments.filter((s) => s.edges >= 3);
}

function pushSegment(segments: AudioToneSegment[], edges: AudioEdge[], startIndex: number, endIndex: number): void {
  if (endIndex <= startIndex) return;
  const startTstate = edges[startIndex]!.tstate;
  const endTstate = edges[endIndex]!.tstate;
  const edgesCount = endIndex - startIndex + 1;
  const halfPeriods = Math.max(1, edgesCount - 1);
  const avgHalfPeriod = (endTstate - startTstate) / halfPeriods;
  if (avgHalfPeriod <= 0) return;
  segments.push({
    startTstate,
    endTstate,
    edges: edgesCount,
    hz: Math.round(CPU_HZ / (avgHalfPeriod * 2)),
  });
}

function dominantFrequency(segments: AudioToneSegment[]): number | undefined {
  if (segments.length === 0) return undefined;
  const sorted = [...segments].sort(
    (a, b) => (b.endTstate - b.startTstate) - (a.endTstate - a.startTstate)
  );
  return sorted[0]!.hz;
}
