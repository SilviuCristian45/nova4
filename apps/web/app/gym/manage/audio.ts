"use client";

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    audioCtx = new Ctor();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function scheduleTone(
  ctx: AudioContext,
  freq: number,
  startOffsetSec: number,
  durationSec: number,
  type: OscillatorType,
  gainPeak = 0.16,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffsetSec);

  gain.gain.setValueAtTime(0.001, ctx.currentTime + startOffsetSec);
  gain.gain.exponentialRampToValueAtTime(gainPeak, ctx.currentTime + startOffsetSec + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffsetSec + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(ctx.currentTime + startOffsetSec);
  osc.stop(ctx.currentTime + startOffsetSec + durationSec + 0.02);
}

/**
 * Differentiated reception audio cues:
 * - allowed: bright ascending chime
 * - warning (expiring soon): two warm mid tones
 * - denied: unmistakable low double-buzz
 */
export function playCheckinSound(kind: "allowed" | "warning" | "denied"): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (kind === "allowed") {
    scheduleTone(ctx, 523.25, 0, 0.14, "triangle", 0.15); // C5
    scheduleTone(ctx, 659.25, 0.1, 0.16, "triangle", 0.16); // E5
    scheduleTone(ctx, 783.99, 0.2, 0.22, "sine", 0.15); // G5
  } else if (kind === "warning") {
    scheduleTone(ctx, 587.33, 0, 0.16, "triangle", 0.16); // D5
    scheduleTone(ctx, 493.88, 0.18, 0.22, "triangle", 0.16); // B4
  } else {
    scheduleTone(ctx, 220, 0, 0.18, "sawtooth", 0.12);
    scheduleTone(ctx, 164.81, 0.22, 0.28, "sawtooth", 0.12);
  }
}
