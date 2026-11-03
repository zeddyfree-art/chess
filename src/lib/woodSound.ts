// The "Wood" sound set: every sound made in the browser with the Web Audio API, no audio files. A piece meeting the
// board is a short strike ringing through the resonances of a block of wood; checks and the end of a game add a soft
// bell. Taken from Rookahead (https://github.com/rookahead/rookahead, src/lib/sound.ts, GPL-3.0-or-later, like this
// app), with only the sounds this app uses.
import type { SoundName } from './sound';

/** What a move sounds like, read off its notation (a check outranks everything else it might also be). */
export type WoodMove = 'move' | 'capture' | 'castle' | 'check' | 'promote';
export function woodMoveKind(san: string): WoodMove {
  if (/[+#]/.test(san)) return 'check';
  if (san.includes('=')) return 'promote';
  if (san.startsWith('O-O')) return 'castle';
  if (san.includes('x')) return 'capture';
  return 'move';
}

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
/** Strikes by length in milliseconds: a shorter contact is a harder, brighter hit. */
const pulses = new Map<number, AudioBuffer>()
/** The last move's sound, faded out when the next one starts. */
let voice: GainNode | null = null

/** How long a cut-off sound takes to fade: quick enough not to smear into the next move, slow enough not to click. */
const CUT_S = 0.012

function audio() {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.connect(ctx.destination)
    // Half a second of white noise, for the grain of each strike.
    noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  // Browsers start the context suspended until a user gesture; moves always follow one.
  if (ctx.state === 'suspended') void ctx.resume()
  return { ctx, master: master!, noise: noise! }
}

/** The strike itself: a bump `ms` long, the same every time, so taps sound alike. */
function pulse(ctx: AudioContext, ms: number) {
  let buffer = pulses.get(ms)
  if (!buffer) {
    const width = Math.max(2, Math.round((ctx.sampleRate * ms) / 1000))
    buffer = ctx.createBuffer(1, width, ctx.sampleRate)
    const bump = buffer.getChannelData(0)
    for (let i = 0; i < width; i++) bump[i] = Math.sin((Math.PI * i) / width)
    pulses.set(ms, buffer)
  }
  return buffer
}

/** A gain envelope: near-silent, a fast attack to `peak`, then an exponential decay. */
function envelope(ctx: AudioContext, t: number, peak: number, attack: number, decay: number) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  return g
}

interface TapOptions {
  /** Loudness. */
  gain?: number
  /** Pitch of the wood: above 1 is a smaller, harder piece. */
  pitch?: number
  /** Weight of the upper resonance and the contact click: above 1 is a sharper hit. */
  bright?: number
  /** How long the wood rings: above 1 is longer. */
  ring?: number
  /** Length of the contact in ms: shorter is harder, and reaches higher resonances. */
  contact?: number
}

/**
 * The resonances of a piece meeting the board, as [frequency Hz, Q, level]. A wooden "tok" lives
 * between 400 Hz and 2 kHz, which is also where ears and small speakers are most sensitive. Q sets
 * how long each rings: about Q / (π·f) seconds, a few milliseconds here.
 */
const WOOD: [number, number, number][] = [
  [510, 9, 1],
  [1030, 12, 1.5],
]
/** The contact itself: a broad click above the wood. */
const CLICK: [number, number, number] = [2600, 1.2, 0.05]
/** A little weight underneath, so it doesn't sound like plastic. */
const THUD: [number, number, number] = [230, 4, 0.9]
/** Brings a move's peak to about -3 dB at full volume, a little louder on small speakers than Chess.com's move sound. */
const LOUDNESS = 0.36

/** A piece landing: a short strike ringing through the resonances of a block of wood. */
function tap(out: AudioNode, t: number, { gain = 1, pitch = 1, bright = 1, ring = 1, contact = 1 }: TapOptions = {}) {
  const { ctx, noise } = audio()
  // A touch of variety: no two pieces land exactly alike.
  const tune = pitch * (1 + (Math.random() - 0.5) * 0.04)
  const strike = ctx.createGain()
  const bump = ctx.createBufferSource()
  bump.buffer = pulse(ctx, contact)
  // A shorter strike carries less energy: make up for it.
  strike.gain.value = 1 / contact
  bump.connect(strike)
  bump.start(t)
  const grain = ctx.createBufferSource()
  grain.buffer = noise
  grain.connect(envelope(ctx, t, 0.15, 0.0005, 0.003)).connect(strike)
  grain.start(t, Math.random() * 0.4)
  grain.stop(t + 0.01)
  const modes: [number, number, number][] = [
    [WOOD[0][0] * tune, WOOD[0][1] * ring, WOOD[0][2]],
    [WOOD[1][0] * tune, WOOD[1][1] * ring, WOOD[1][2] * bright],
    [CLICK[0], CLICK[1], CLICK[2] * bright],
    [THUD[0] * tune, THUD[1], THUD[2]],
  ]
  for (const [freq, q, level] of modes) {
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = freq
    band.Q.value = q
    const g = ctx.createGain()
    // A narrower band passes less of the strike: scale by Q to keep each mode at its level.
    g.gain.value = level * gain * q * LOUDNESS
    strike.connect(band).connect(g).connect(out)
  }
}

/** A soft bell: a sine with a quieter octave above it. */
function chime(out: AudioNode, t: number, freq: number, gain = 0.14, decay = 0.45) {
  const { ctx } = audio()
  for (const [mult, level] of [
    [1, 1],
    [2, 0.25],
  ]) {
    const osc = ctx.createOscillator()
    osc.frequency.value = freq * mult
    osc.connect(envelope(ctx, t, gain * level, 0.006, decay)).connect(out)
    osc.start(t)
    osc.stop(t + decay + 0.05)
  }
}


/** Plays one of the app's sounds, or a move's, at `volume` (0–1). Safe where Web Audio is missing. */
export function playWood(kind: SoundName | WoodMove, volume = 0.8) {
  if (volume <= 0 || typeof AudioContext === 'undefined') return;
  try {
    const { ctx, master } = audio();
    master.gain.value = volume;
    const t = ctx.currentTime + 0.005;
    const out = ctx.createGain();
    out.connect(master);
    const isMove = ['move', 'capture', 'castle', 'check', 'promote', 'Move', 'Capture', 'Check'].includes(kind);
    if (isMove) {
      // A new move cuts the last one short, so fast stepping never piles them up.
      if (voice) {
        voice.gain.setValueAtTime(1, t);
        voice.gain.linearRampToValueAtTime(0, t + CUT_S);
      }
      voice = out;
    }
    switch (kind) {
      case 'move':
      case 'Move':
        tap(out, t);
        break;
      case 'capture':
      case 'Capture':
        // Two pieces meeting: a harder, brighter, higher crack.
        tap(out, t, { gain: 0.16, pitch: 1.35, bright: 2.2, ring: 3, contact: 0.35 });
        break;
      case 'castle':
        // The king, then the rook a beat later.
        tap(out, t, { gain: 0.35, pitch: 0.95 });
        tap(out, t + 0.09, { gain: 1, pitch: 1.05 });
        break;
      case 'check':
      case 'Check':
        tap(out, t, { gain: 0.85, bright: 1.4 });
        chime(out, t + 0.01, 1318.5, 0.08, 0.28);
        break;
      case 'promote':
        tap(out, t);
        chime(out, t + 0.04, 784, 0.18, 0.25);
        chime(out, t + 0.12, 1174.7, 0.18, 0.4);
        break;
      case 'GenericNotify':
        // A game begins: one soft bell.
        chime(out, t, 784, 0.16, 0.6);
        break;
      case 'LowTime':
        // Two short low notes.
        chime(out, t, 440, 0.2, 0.18);
        chime(out, t + 0.2, 440, 0.2, 0.18);
        break;
      case 'Victory':
        // A bright rising pair.
        chime(out, t, 880, 0.22, 0.35);
        chime(out, t + 0.09, 1318.5, 0.22, 0.6);
        break;
      case 'Defeat':
        // One low, short note.
        chime(out, t, 220, 0.32, 0.5);
        break;
      case 'Draw':
        // A gentle open fifth plus octave, slightly rolled.
        chime(out, t, 523.25, 0.24, 1.2);
        chime(out, t + 0.05, 784, 0.2, 1.1);
        chime(out, t + 0.1, 1046.5, 0.14, 1);
        break;
    }
  } catch {
    /* no sound then */
  }
}
