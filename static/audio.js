'use strict';

// ═══════════════════════════════════════════════════════════
// Audio — Procedural acid dub (TB-303 style bassline + drums)
// ═══════════════════════════════════════════════════════════
let audioCtx = null;
const SOUND_ALL   = 'all';
const SOUND_MUSIC = 'music';
const SOUND_OFF   = 'off';
let soundMode = SOUND_ALL;
let musicScheduler = null;
let noteIndex = 0;
let nextNoteTime = 0;
let masterGain = null, dubDelay = null, dubFeedback = null, reverbNode = null;

// ═══════════════════════════════════════════════════════════
// Music tempo — wave-synced
// ═══════════════════════════════════════════════════════════
let currentBPM = 110;
// Circle of fifths key offset — 0 = A minor, 7 = E minor, 2 = B minor, etc.
// Advances by one fifth (7 semitones) every 5 waves (wave 5→Em, 10→Bm, 15→F#m, …).
let currentKeyOffset = 0;
const KEY_NAMES = ['Am','Em','Bm','F#m','C#m','G#m','D#m','Bbm','Fm','Cm','Gm','Dm'];
function updateMusicTempo() {
  // BPM tracks actual enemy speed from server (0–8 px/tick → 110–200 BPM)
  const speed = gs.enemySpeed || 0;
  const SPEED_MAX = 8.0;
  const targetBPM = Math.round(110 + (speed / SPEED_MAX) * 90);
  // Smooth toward target at ~2 BPM per state update to avoid jarring jumps
  if (targetBPM > currentBPM) currentBPM = Math.min(targetBPM, currentBPM + 2);
  else if (targetBPM < currentBPM) currentBPM = Math.max(targetBPM, currentBPM - 1);
}

function resetMusicSequencer() {
  noteIndex = 0;
  arpStep = 0;
  padChordIdx = 0;
  currentBPM = 110;
  debugWaveOffset = 0;
  if (audioCtx) nextNoteTime = audioCtx.currentTime + 0.1;
  if (!musicScheduler && audioCtx) musicScheduler = setTimeout(schedulerTick, 100);
}

// Beat phase advances proportional to BPM each render frame (~60fps)
let beatPhase = 0;
function tickBeatPhase() {
  beatPhase += (currentBPM / 60) * (1 / 60) * Math.PI * 2;
}

function hz(n) { return 440 * Math.pow(2, (n-69)/12); }

// BPM is dynamic — starts at 110, ramps with waves
// STEP is recomputed each scheduler tick from currentBPM

// Acid bassline in A minor — MIDI notes, null = rest
// Wave 1-2: sparse root-only pattern
const ACID_SIMPLE  = [45,null,null,null, null,null,45,null, null,null,null,null, 45,null,null,null];
const ACID_ACC_S   = [1,  0,   0,   0,   0,   0,  0, 0,    0,   0,   0,   0,   1, 0,   0,   0  ];
// Wave 3+: full alternating patterns
const ACID_A = [45,null,45,null,45,null,48,null, 45,null,43,45,  null,45,40,null];
const ACID_B = [45,null,52,null,45,null,48,43,   45,null,40,null,43,  45,null,43];
const ACID_ACC_A=[1,0,0,0, 0,0,1,0, 1,0,0,1, 0,0,1,0];
const ACID_ACC_B=[1,0,1,0, 0,0,1,1, 1,0,1,0, 1,1,0,1];
// Kick pattern (1=kick on that 16th step)
const KICK_PAT = [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0];
// Hihat pattern
const HAT_PAT  = [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1];
// Open hat on these steps
const OPEN_HAT = new Set([4,12]);
// Extended patterns — waves 10+
const KICK_SYNCO  = [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0]; // syncopated kick on steps 6/14
const KICK_FOURFR = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0]; // four-on-the-floor extras (steps 4/12)
const HAT_PAT_B   = [1,1,0,1, 1,0,1,0, 1,1,0,1, 1,0,1,0]; // complex hat variant (odd bars)
// Acid C — higher register, A minor pentatonic
const ACID_C     = [57,null,60,null,57,null,55,null, 60,null,57,55, null,57,52,null];
const ACID_ACC_C = [1,0,1,0, 1,0,0,0, 1,0,0,1, 0,1,0,0];
// Acid D — dark chromatic
const ACID_D     = [45,null,44,45, null,43,null,45, 44,null,45,null, 43,40,null,43];
const ACID_ACC_D = [1,0,1,1, 0,1,0,1, 1,0,0,0, 1,1,0,1];

function initAudio() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.72;
    masterGain.connect(audioCtx.destination);
    // Synthetic reverb via convolver (exponentially decaying noise impulse)
    reverbNode = audioCtx.createConvolver();
    const revLen = audioCtx.sampleRate * 2.4;
    const revBuf = audioCtx.createBuffer(2, revLen, audioCtx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = revBuf.getChannelData(ch);
      for (let i = 0; i < revLen; i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/revLen, 1.8);
    }
    reverbNode.buffer = revBuf;
    const reverbGain = audioCtx.createGain();
    reverbGain.gain.value = 0.28;
    reverbNode.connect(reverbGain);
    reverbGain.connect(masterGain);
    // Dub echo bus: dotted-quarter delay with gentle feedback
    dubDelay    = audioCtx.createDelay(1.0);
    dubDelay.delayTime.value = (60 / (currentBPM * 4)) * 6; // 3 beats
    dubFeedback = audioCtx.createGain();
    dubFeedback.gain.value = 0.35;
    dubDelay.connect(dubFeedback);
    dubFeedback.connect(dubDelay);
    dubFeedback.connect(masterGain);
    noteIndex   = 0;
    nextNoteTime = audioCtx.currentTime + 0.1;
    schedulerTick();
  } catch(e) { audioCtx = null; }
}

function scheduleAcidNote(midi, start, accent, bar) {
  if (!audioCtx || soundMode === SOUND_OFF) return;
  const osc  = audioCtx.createOscillator();
  const filt = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.value = hz(midi);
  filt.type = 'lowpass';
  // Q and cutoff drift on an 8-bar cycle — closed/dark → open/bright
  const cycle = (bar || 0) % 8;
  const openness = 0.5 + 0.5 * Math.sin((cycle / 8) * Math.PI * 2); // 0..1
  filt.Q.value = 2.5 + openness * 2;                                 // 2.5..4.5
  const cutoffScale = 0.93 + openness * 0.14;                        // 0.93..1.07
  const co0 = (accent ? 420 : 220) * cutoffScale;
  const co1 = (accent ? 1600 : 800) * cutoffScale;
  filt.frequency.setValueAtTime(co0, start);
  filt.frequency.exponentialRampToValueAtTime(co1, start + 0.035);
  const step16 = 60 / (currentBPM * 4);
  filt.frequency.exponentialRampToValueAtTime(co0 * 0.55, start + step16 * 0.7);
  const vol = accent ? 0.17 : 0.10;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(vol, start + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + step16 * 0.72);
  osc.connect(filt); filt.connect(gain);
  gain.connect(masterGain);
  gain.connect(dubDelay);
  if (reverbNode) gain.connect(reverbNode);
  osc.start(start); osc.stop(start + step16 + 0.02);
}

function scheduleKick(start) {
  if (!audioCtx || soundMode === SOUND_OFF) return;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(masterGain);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(100, start);
  osc.frequency.exponentialRampToValueAtTime(28, start + 0.08);
  gain.gain.setValueAtTime(0.55, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
  osc.start(start); osc.stop(start + 0.28);
}

function scheduleHihat(start, open) {
  if (!audioCtx || soundMode === SOUND_OFF) return;
  const len = Math.ceil(audioCtx.sampleRate * 0.12);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src  = audioCtx.createBufferSource();
  const hpf  = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  src.buffer = buf;
  hpf.type = 'highpass'; hpf.frequency.value = 7800;
  src.connect(hpf); hpf.connect(gain); gain.connect(masterGain);
  const dur = open ? 0.055 : 0.012;
  gain.gain.setValueAtTime(open ? 0.065 : 0.038, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.start(start); src.stop(start + dur + 0.01);
}

function schedulerTick() {
  if (!audioCtx) return;
  const step16 = 60 / (currentBPM * 4);
  const LOOKAHEAD = 0.3;
  const wave = (gs.wave || 1) + debugWaveOffset;
  // Circle of fifths: key advances one fifth (+7 semitones) every 5 waves
  const keyStep = Math.floor(wave / 5) % 12;
  currentKeyOffset = (keyStep * 7) % 12;

  // Each wave unlocks one or more new musical elements (waves 1–30)
  // W1:  Sparse acid bassline          W16: Acid C (high register) in rotation
  // W2:  Kick + fuller bassline        W17: Stab chord on step 6 (even bars)
  // W3:  Sub-bass + gentle pad         W18: Snare also on beat 2 (step 4)
  // W4:  Closed hi-hats                W19: Extra open hat (steps 2/10/14)
  // W5:  Snare on beat 3               W20: Four-on-the-floor extra kick
  // W6:  Pulsing harmonic lead         W21: Acid D (dark chromatic) in rotation
  // W7:  Open hi-hats + off-beat perc  W22: Tom fill every 4 bars (step 15)
  // W8:  Octave-up triangle lead       W23: Ride cymbal on quarter notes
  // W9:  Chord pad + 16th hi-hats      W24: Bell high octave (even bars)
  // W10: Syncopated extra kick (6/14)  W25: Sub-bass on off-beat kick
  // W11: Clap on steps 2/10            W26: Polyrhythm perc (5-over-16)
  // W12: Tom on step 14                W27: Lead plays 2 octaves up
  // W13: Arpeggio synth (8th notes)    W28: Rave chord stab on bar start
  // W14: Bell on bar downbeat          W29: Snare on beats 2/3/4
  // W15: Complex hat pattern (odd bars)W30: Acid octave-up double on accents
  const addKick        = wave >= 2;
  const addSubBass     = wave >= 3;
  const addGentlePad   = wave >= 3;
  const addHat         = wave >= 4;
  const addSnare       = wave >= 5;
  const addPulsingLead = wave >= 6;
  const addOpenHat     = wave >= 7;
  const addPerc        = wave >= 7;
  const addLead        = wave >= 8;
  const addPad         = wave >= 9;
  const addFastHat     = wave >= 9;
  const addExtraKick   = wave >= 10;
  const addClap        = wave >= 11;
  const addTom         = wave >= 12;
  const addArp         = wave >= 13;
  const addBell        = wave >= 14;
  const addHatB        = wave >= 15;
  const useAcidC       = wave >= 16;
  const addStab        = wave >= 17;
  const addSnare2      = wave >= 18;
  const addExtraOpen   = wave >= 19;
  const addKickFour    = wave >= 20;
  const useAcidD       = wave >= 21;
  const addTomFill     = wave >= 22;
  const addRide        = wave >= 23;
  const addBellHigh    = wave >= 24;
  const addSubBassB    = wave >= 25;
  const addPolyPerc    = wave >= 26;
  const addLeadHigh    = wave >= 27;
  const addRaveChord   = wave >= 28;
  const addSnare3      = wave >= 29;
  const addAcidDouble  = wave >= 30;

  while (nextNoteTime < audioCtx.currentTime + LOOKAHEAD) {
    const bar  = Math.floor(noteIndex / 16);
    const step = noteIndex % 16;

    // Acid pattern — rotates through A/B/C/D as waves unlock them
    let seq, acc;
    if (wave <= 2) {
      seq = ACID_SIMPLE; acc = ACID_ACC_S;
    } else if (wave === 3) {
      seq = ACID_A; acc = ACID_ACC_A;
    } else if (useAcidD && bar % 8 >= 6) {
      seq = ACID_D; acc = ACID_ACC_D;
    } else if (useAcidC && bar % 4 >= 2) {
      seq = ACID_C; acc = ACID_ACC_C;
    } else {
      seq = (bar % 4 < 2) ? ACID_A : ACID_B;
      acc = (bar % 4 < 2) ? ACID_ACC_A : ACID_ACC_B;
    }
    const midi = seq[step];
    // Occasional octave transposition: last 2 bars of every 8-bar phrase (wave 5+),
    // only on A/B patterns — C and D already sit in a higher register
    const acidOctave = (wave >= 5 && seq !== ACID_C && seq !== ACID_D && bar % 8 >= 6) ? 12 : 0;
    const ko = currentKeyOffset; // local alias for readability
    if (midi !== null) scheduleAcidNote(midi + acidOctave + ko, nextNoteTime, acc[step] === 1, bar);
    if (addAcidDouble && midi !== null && acc[step] === 1) scheduleAcidNote(midi + 12 + acidOctave + ko, nextNoteTime, true, bar);

    // Harmonic / pad layers
    if (addGentlePad && step === 0 && bar % 2 === 0) scheduleGentlePad(nextNoteTime);
    if (addPad       && step === 0 && bar % 2 === 0) scheduleChordPad(nextNoteTime);
    if (addRaveChord && step === 0)                  scheduleRaveChord(nextNoteTime, bar);
    if (addBell      && step === 0)                  scheduleBell((midi || 45) + ko, nextNoteTime, false);
    if (addBellHigh  && step === 0 && bar % 2 === 0) scheduleBell((midi || 45) + ko, nextNoteTime, true);
    if (addStab      && step === 6 && bar % 2 === 0) scheduleStab(nextNoteTime, bar);
    if (addPulsingLead && step % 4 === 0)            schedulePulsingLead(nextNoteTime, bar);
    if (addArp         && step % 2 === 0)            scheduleArpNote(nextNoteTime);
    if (addLead && midi !== null && acc[step])       scheduleLeadNote((addLeadHigh ? midi + 12 : midi) + ko, nextNoteTime);

    // Kick
    if (addKick      && KICK_PAT[step])              scheduleKick(nextNoteTime);
    if (addExtraKick && KICK_SYNCO[step])            scheduleKick(nextNoteTime);
    if (addKickFour  && KICK_FOURFR[step])           scheduleKick(nextNoteTime);

    // Sub-bass
    if (addSubBass  && KICK_PAT[step])               scheduleSubBass(nextNoteTime);
    if (addSubBassB && KICK_SYNCO[step])             scheduleSubBass(nextNoteTime);

    // Hi-hat — regular, complex variant, or solid 16th-note wall
    let onHat;
    if (addFastHat) onHat = true;
    else if (addHatB && bar % 2 === 1) onHat = HAT_PAT_B[step];
    else onHat = HAT_PAT[step];
    const openHit = addOpenHat && (OPEN_HAT.has(step) || (addExtraOpen && (step === 2 || step === 10 || step === 14)));
    if (addHat && onHat) scheduleHihat(nextNoteTime, openHit);
    if (addPerc && step % 4 === 2) scheduleHihat(nextNoteTime, false);
    if (addRide && step % 4 === 0) scheduleRide(nextNoteTime);

    // Polyrhythm perc — 5 evenly-spaced hits across 16 steps
    if (addPolyPerc && (step === 0 || step === 3 || step === 6 || step === 10 || step === 13)) {
      scheduleHihat(nextNoteTime, false);
    }

    // Snare
    if (addSnare  && step === 8)  scheduleSnare(nextNoteTime);
    if (addSnare2 && step === 4)  scheduleSnare(nextNoteTime);
    if (addSnare3 && step === 12) scheduleSnare(nextNoteTime);

    // Clap on off-beats
    if (addClap && (step === 2 || step === 10)) scheduleClap(nextNoteTime);

    // Tom
    if (addTom     && step === 14)                  scheduleTom(nextNoteTime);
    if (addTomFill && step === 15 && bar % 4 === 3) scheduleTom(nextNoteTime);

    nextNoteTime += step16;
    noteIndex++;
  }
  musicScheduler = setTimeout(schedulerTick, 80);
}

function scheduleSnare(start) {
  if (!audioCtx || soundMode === SOUND_OFF) return;
  const len = Math.ceil(audioCtx.sampleRate * 0.1);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src  = audioCtx.createBufferSource();
  const bpf  = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  src.buffer = buf;
  bpf.type = 'bandpass'; bpf.frequency.value = 1800; bpf.Q.value = 0.5;
  src.connect(bpf); bpf.connect(gain); gain.connect(masterGain);
  gain.gain.setValueAtTime(0.10, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.08);
  src.start(start); src.stop(start + 0.1);
}

// Wave 7: sub-bass pulse on kick positions
function scheduleSubBass(start) {
  if (!audioCtx || soundMode === SOUND_OFF) return;
  const step16 = 60 / (currentBPM * 4);
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(hz(33 + currentKeyOffset), start);
  osc.frequency.exponentialRampToValueAtTime(hz(28 + currentKeyOffset), start + step16 * 2);
  gain.gain.setValueAtTime(0.28, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + step16 * 3.5);
  osc.connect(gain); gain.connect(masterGain);
  osc.start(start); osc.stop(start + step16 * 4);
}

// Wave 6: pulsing harmonic lead — quarter-note filtered square pulses on the 5th (E)
function schedulePulsingLead(start, bar) {
  if (!audioCtx || soundMode === SOUND_OFF) return;
  const step16 = 60 / (currentBPM * 4);
  const osc  = audioCtx.createOscillator();
  const filt = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = hz(52 + currentKeyOffset); // 5th above root
  filt.type = 'lowpass';
  // Cutoff and resonance sweep on a 4-bar cycle
  const sweep = 0.5 + 0.5 * Math.sin(((bar || 0) % 4) / 4 * Math.PI * 2);
  const co0 = 600 + sweep * 1200;  // 600..1800 Hz
  filt.frequency.setValueAtTime(co0, start);
  filt.frequency.exponentialRampToValueAtTime(Math.max(200, co0 * 0.28), start + step16 * 3);
  filt.Q.value = 3 + sweep * 5;    // 3..8 resonance
  // Soft attack, hold briefly, gentle release
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.010, start + step16 * 0.6);   // attack
  gain.gain.setValueAtTime(0.018, start + step16 * 2.0);            // hold
  gain.gain.exponentialRampToValueAtTime(0.001, start + step16 * 3.8); // release
  osc.connect(filt); filt.connect(gain);
  gain.connect(masterGain);
  if (reverbNode) gain.connect(reverbNode);
  osc.start(start); osc.stop(start + step16 * 4);
}

// Wave 3: gentle pad — slowly cycles through Am/G/F/Em voicings, 2-bar duration
const PAD_CHORDS = [
  [45, 52, 57],  // Am: A3 E4 A4
  [43, 50, 55],  // G:  G3 D4 G4
  [41, 48, 53],  // F:  F3 C4 F4
  [40, 47, 52],  // Em: E3 B3 E4
];
let padChordIdx = 0;

function scheduleGentlePad(start) {
  if (!audioCtx || soundMode === SOUND_OFF) return;
  const step16 = 60 / (currentBPM * 4);
  const dur = step16 * 30; // slightly longer than 2 bars — fades overlap
  const chord = PAD_CHORDS[padChordIdx % PAD_CHORDS.length].map(n => n + currentKeyOffset);
  padChordIdx++;
  for (const note of chord) {
    // Three detuned sine layers per note for chorus richness
    for (const det of [-6, 0, 6]) {
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz(note);
      osc.detune.value = det;
      // Very soft attack, gentle fade out before next chord
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.018, start + 0.7);
      gain.gain.setValueAtTime(0.018, start + dur - 0.9);
      gain.gain.linearRampToValueAtTime(0, start + dur + 0.3);
      osc.connect(gain);
      gain.connect(masterGain);
      // Heavy reverb send — the pad lives mostly in the reverb tail
      if (reverbNode) {
        const rv = audioCtx.createGain();
        rv.gain.value = 2.2;
        gain.connect(rv); rv.connect(reverbNode);
      }
      osc.start(start); osc.stop(start + dur + 0.5);
    }
  }
}

// Wave 8: octave-up lead on accented bass notes
function scheduleLeadNote(midi, start) {
  if (!audioCtx || soundMode === SOUND_OFF || midi === null) return;
  const step16 = 60 / (currentBPM * 4);
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = hz(midi + 12);
  gain.gain.setValueAtTime(0.09, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + step16 * 0.6);
  osc.connect(gain);
  gain.connect(masterGain);
  if (reverbNode) gain.connect(reverbNode);
  osc.start(start); osc.stop(start + step16 * 0.7);
}

// Wave 9: chord pad stab at start of every 2 bars
function scheduleChordPad(start) {
  if (!audioCtx || soundMode === SOUND_OFF) return;
  const step16 = 60 / (currentBPM * 4);
  const notes = [45, 48, 52].map(n => n + currentKeyOffset);
  for (const n of notes) {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz(n);
    gain.gain.setValueAtTime(0.055, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + step16 * 7);
    osc.connect(gain);
    gain.connect(masterGain);
    if (reverbNode) gain.connect(reverbNode);
    osc.start(start); osc.stop(start + step16 * 7.5);
  }
}

// Wave 11: clap — mid noise burst
function scheduleClap(start) {
  if (!audioCtx || soundMode === SOUND_OFF) return;
  const len = Math.ceil(audioCtx.sampleRate * 0.08);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src  = audioCtx.createBufferSource();
  const bpf  = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  src.buffer = buf;
  bpf.type = 'bandpass'; bpf.frequency.value = 1100; bpf.Q.value = 1.5;
  src.connect(bpf); bpf.connect(gain); gain.connect(masterGain);
  gain.gain.setValueAtTime(0.07, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.07);
  src.start(start); src.stop(start + 0.09);
}

// Wave 12: low tom
function scheduleTom(start) {
  if (!audioCtx || soundMode === SOUND_OFF) return;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, start);
  osc.frequency.exponentialRampToValueAtTime(80, start + 0.06);
  gain.gain.setValueAtTime(0.22, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
  osc.connect(gain); gain.connect(masterGain);
  osc.start(start); osc.stop(start + 0.18);
}

// Wave 13: arpeggio synth — triangle pentatonic runs on 8th notes
const ARP_NOTES = [45, 48, 52, 57, 60, 57, 52, 48];
let arpStep = 0;
function scheduleArpNote(start) {
  if (!audioCtx || soundMode === SOUND_OFF) return;
  const step16 = 60 / (currentBPM * 4);
  const midi = ARP_NOTES[arpStep % ARP_NOTES.length] + currentKeyOffset;
  arpStep++;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = hz(midi);
  gain.gain.setValueAtTime(0.05, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + step16 * 0.6);
  osc.connect(gain); gain.connect(masterGain);
  if (reverbNode) { const rv = audioCtx.createGain(); rv.gain.value = 0.4; gain.connect(rv); rv.connect(reverbNode); }
  osc.start(start); osc.stop(start + step16 * 0.7);
}

// Wave 14: bell with harmonic partials, long tail
function scheduleBell(midi, start, highOct) {
  if (!audioCtx || soundMode === SOUND_OFF) return;
  const freq = hz(midi + (highOct ? 12 : 0));
  const step16 = 60 / (currentBPM * 4);
  for (const [mult, vol] of [[1, 0.038], [2.756, 0.016], [5.4, 0.008]]) {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(vol, start + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + step16 * 6);
    osc.connect(gain); gain.connect(masterGain);
    if (reverbNode) { const rv = audioCtx.createGain(); rv.gain.value = 1.8; gain.connect(rv); rv.connect(reverbNode); }
    osc.start(start); osc.stop(start + step16 * 7);
  }
}

// Wave 17: stab chord — short sawtooth stab
function scheduleStab(start, bar) {
  if (!audioCtx || soundMode === SOUND_OFF) return;
  const step16 = 60 / (currentBPM * 4);
  const notes = (bar % 4 < 2 ? [45, 52, 57] : [43, 50, 55]).map(n => n + currentKeyOffset);
  for (const n of notes) {
    const osc  = audioCtx.createOscillator();
    const filt = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = hz(n);
    filt.type = 'lowpass'; filt.frequency.value = 2000; filt.Q.value = 2;
    gain.gain.setValueAtTime(0.03, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + step16 * 1.5);
    osc.connect(filt); filt.connect(gain); gain.connect(masterGain);
    osc.start(start); osc.stop(start + step16 * 2);
  }
}

// Wave 23: ride cymbal — softer metallic tone on quarter notes
function scheduleRide(start) {
  if (!audioCtx || soundMode === SOUND_OFF) return;
  const len = Math.ceil(audioCtx.sampleRate * 0.18);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src  = audioCtx.createBufferSource();
  const bpf  = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  src.buffer = buf;
  bpf.type = 'bandpass'; bpf.frequency.value = 5000; bpf.Q.value = 2.5;
  src.connect(bpf); bpf.connect(gain); gain.connect(masterGain);
  gain.gain.setValueAtTime(0.024, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
  src.start(start); src.stop(start + 0.18);
}

// Wave 28: rave chord — detuned saw cluster
function scheduleRaveChord(start, bar) {
  if (!audioCtx || soundMode === SOUND_OFF) return;
  const step16 = 60 / (currentBPM * 4);
  const rootMidi = (bar % 4 < 2 ? 57 : 55) + currentKeyOffset;
  for (const det of [-14, -7, 0, 7, 14]) {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = hz(rootMidi);
    osc.detune.value = det;
    gain.gain.setValueAtTime(0.015, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + step16 * 3.5);
    osc.connect(gain); gain.connect(masterGain);
    if (reverbNode) { const rv = audioCtx.createGain(); rv.gain.value = 0.5; gain.connect(rv); rv.connect(reverbNode); }
    osc.start(start); osc.stop(start + step16 * 4);
  }
}

// Fire / explosion SFX
let lastFireSnd = 0;
function playFireSound() {
  if (!audioCtx || soundMode !== SOUND_ALL) return;
  const now = audioCtx.currentTime;
  if (now - lastFireSnd < 0.08) return;
  lastFireSnd = now;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.type = 'square';
  o.frequency.setValueAtTime(520, now);
  o.frequency.exponentialRampToValueAtTime(80, now + 0.07);
  g.gain.setValueAtTime(0.025, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  o.start(now); o.stop(now + 0.1);
}

function playExplosionSound() {
  if (!audioCtx || soundMode !== SOUND_ALL) return;
  const now = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(200, now);
  o.frequency.exponentialRampToValueAtTime(40, now + 0.4);
  g.gain.setValueAtTime(0.12, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
  o.start(now); o.stop(now + 0.5);
}

// UFO particle explosion
const ufoParticles = [];

function spawnUFOExplosion(kill) {
  const col = ANIMAL_COLORS[(kill.animal || 0) % 6];
  const name = ANIMAL_NAMES[(kill.animal || 0) % 6];
  for (let i = 0; i < 70; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 7;
    const maxLife = 55 + Math.random() * 40;
    ufoParticles.push({
      x: kill.x, y: kill.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - Math.random() * 2,
      life: maxLife, maxLife,
      col,
      r: 1.2 + Math.random() * 2.8,
    });
  }
  addBigToast(`+${kill.points}`, col, name + ' DESTROYED!');
  playUFOBoomSound();
}

function tickParticleArray(ctx, arr, gravity, blur) {
  if (!arr.length) return;
  ctx.save();
  ctx.shadowBlur = blur;
  for (let i = arr.length - 1; i >= 0; i--) {
    const p = arr[i];
    p.x += p.vx; p.y += p.vy; p.vy += gravity; p.life--;
    if (p.life <= 0) { arr.splice(i, 1); continue; }
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.col;
    ctx.shadowColor = p.col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function tickUFOParticles(ctx) {
  tickParticleArray(ctx, ufoParticles, 0.12, 5);
}

function playUFOBoomSound() {
  if (!audioCtx || soundMode !== SOUND_ALL) return;
  const now = audioCtx.currentTime;
  // Massive layered boom: low thud + mid crack + high noise burst
  for (const [freq0, freq1, dur, vol] of [
    [180, 22, 0.6, 0.22],
    [320, 60, 0.35, 0.14],
    [800, 120, 0.18, 0.09],
  ]) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(masterGain || audioCtx.destination);
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq0, now);
    o.frequency.exponentialRampToValueAtTime(freq1, now + dur);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.start(now); o.stop(now + dur + 0.05);
  }
  // Noise crackle
  const len = Math.ceil(audioCtx.sampleRate * 0.25);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 0.5);
  const src = audioCtx.createBufferSource();
  const bpf = audioCtx.createBiquadFilter();
  const gn  = audioCtx.createGain();
  src.buffer = buf;
  bpf.type = 'bandpass'; bpf.frequency.value = 2000; bpf.Q.value = 0.8;
  src.connect(bpf); bpf.connect(gn); gn.connect(masterGain || audioCtx.destination);
  gn.gain.setValueAtTime(0.18, now);
  gn.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  src.start(now); src.stop(now + 0.27);
  if (reverbNode) { const rv = audioCtx.createGain(); rv.gain.value = 0.6; gn.connect(rv); rv.connect(reverbNode); }
}

// ═══════════════════════════════════════════════════════════
// Bomb enemy explosion
// ═══════════════════════════════════════════════════════════
const bombParticles  = [];
const bombShockwaves = [];

// Generic particle spawner shared by bomb and can be reused for other effects.
// speedRange/lifeRange/rRange are the random spread above the min value.
// vyBias: random upward nudge; vyConst: constant upward nudge.
function spawnParticles(arr, count, x, y, {speedMin, speedRange, lifeMin, lifeRange, maxLife, colFn, rMin, rRange, vyBias = 0, vyConst = 0}) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = speedMin + Math.random() * speedRange;
    arr.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - Math.random() * vyBias - vyConst,
      life: lifeMin + Math.random() * lifeRange, maxLife,
      col: colFn(), r: rMin + Math.random() * rRange,
    });
  }
}

const MAX_BOMB_PARTICLES = 400;

function spawnBombExplosion(kill) {
  bombShockwaves.push({ x: kill.x, y: kill.y, r: 8, maxR: 95, life: 28, maxLife: 28 });
  if (bombParticles.length < MAX_BOMB_PARTICLES) {
    spawnParticles(bombParticles, 50, kill.x, kill.y, {
      speedMin: 4, speedRange: 10, lifeMin: 30, lifeRange: 25, maxLife: 55,
      colFn: () => Math.random() < 0.5 ? '#fff' : '#ffee44', rMin: 1.5, rRange: 2, vyBias: 3,
    });
    spawnParticles(bombParticles, 60, kill.x, kill.y, {
      speedMin: 1.5, speedRange: 6, lifeMin: 45, lifeRange: 40, maxLife: 85,
      colFn: () => Math.random() < 0.5 ? '#ff4400' : '#ff8800', rMin: 2, rRange: 3.5, vyBias: 2,
    });
    spawnParticles(bombParticles, 30, kill.x, kill.y, {
      speedMin: 0.5, speedRange: 2.5, lifeMin: 60, lifeRange: 50, maxLife: 110,
      colFn: () => '#884422', rMin: 3, rRange: 4, vyConst: 0.5,
    });
  }
  const msg = kill.count > 1 ? `CHAIN x${kill.count}!` : 'BOMB!';
  addBigToast(`+${kill.points}`, '#ff4400', msg);
  playBombSound();
}

function tickBombParticles(ctx) {
  // Shockwave rings
  for (let i = bombShockwaves.length - 1; i >= 0; i--) {
    const sw = bombShockwaves[i];
    sw.r += (sw.maxR - sw.r) * 0.22;
    sw.life--;
    if (sw.life <= 0) { bombShockwaves.splice(i, 1); continue; }
    const alpha = sw.life / sw.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha * 0.7;
    ctx.strokeStyle = '#ff6600';
    ctx.lineWidth = 3 * alpha;
    ctx.shadowColor = '#ff4400';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  tickParticleArray(ctx, bombParticles, 0.1, 4);
}

function playBombSound() {
  if (!audioCtx || soundMode !== SOUND_ALL) return;
  const now = audioCtx.currentTime;
  // Huge deep boom + crackle + high screech
  for (const [f0, f1, dur, vol] of [
    [90,  12, 0.9,  0.30],  // sub-bass thud
    [260, 40, 0.55, 0.18],  // mid crack
    [600, 80, 0.30, 0.12],  // high snap
    [1200, 200, 0.15, 0.07],// screech
  ]) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(masterGain || audioCtx.destination);
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(f1, now + dur);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.start(now); o.stop(now + dur + 0.05);
  }
  // Noise burst
  const len = Math.ceil(audioCtx.sampleRate * 0.4);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 0.4);
  const src = audioCtx.createBufferSource();
  const gn  = audioCtx.createGain();
  src.buffer = buf;
  src.connect(gn); gn.connect(masterGain || audioCtx.destination);
  gn.gain.setValueAtTime(0.25, now);
  gn.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
  src.start(now); src.stop(now + 0.42);
  if (reverbNode) { const rv = audioCtx.createGain(); rv.gain.value = 1.0; gn.connect(rv); rv.connect(reverbNode); }
}

// Game over — descending minor pentatonic melody
function playGameOverMelody() {
  if (!audioCtx || soundMode === SOUND_OFF) return;
  if (musicScheduler) { clearTimeout(musicScheduler); musicScheduler = null; }
  const notes = [57, 55, 52, 50, 45, 43]; // A3 G3 E3 D3 A2 G2
  const dur = 0.38;
  const now = audioCtx.currentTime + 0.15;
  notes.forEach((midi, i) => {
    const t = now + i * dur;
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz(midi);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.setValueAtTime(0.18, t + dur * 0.65);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur * 1.1);
    osc.connect(gain);
    gain.connect(masterGain || audioCtx.destination);
    if (reverbNode) { const rv = audioCtx.createGain(); rv.gain.value = 1.4; gain.connect(rv); rv.connect(reverbNode); }
    osc.start(t); osc.stop(t + dur * 1.2);
  });
}

// Enemy hit — higher pitch zap with reverb and a touch of delay
function playEnemyHitSound() {
  if (!audioCtx || soundMode !== SOUND_ALL) return;
  const now = audioCtx.currentTime;

  // Tone: square wave starting high and snapping down
  const osc  = audioCtx.createOscillator();
  const filt = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1800, now);
  osc.frequency.exponentialRampToValueAtTime(340, now + 0.055);
  filt.type = 'bandpass';
  filt.frequency.value = 1200;
  filt.Q.value = 3;
  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  osc.connect(filt); filt.connect(gain);

  // Reverb send
  if (reverbNode) {
    const rvSend = audioCtx.createGain();
    rvSend.gain.value = 0.7;
    gain.connect(rvSend); rvSend.connect(reverbNode);
  }

  // Short delay send (~1/8 note)
  const hitDelay = audioCtx.createDelay(0.5);
  hitDelay.delayTime.value = 60 / (currentBPM * 2); // 8th note
  const hitDelayGain = audioCtx.createGain();
  hitDelayGain.gain.value = 0.22;
  gain.connect(hitDelay);
  hitDelay.connect(hitDelayGain);
  hitDelayGain.connect(masterGain);

  gain.connect(masterGain);
  osc.start(now); osc.stop(now + 0.12);
}

// Player hit — solid low thud
function playPlayerHitSound() {
  if (!audioCtx || soundMode !== SOUND_ALL) return;
  const now = audioCtx.currentTime;

  // Sub-bass thud: sine pitch-drops fast like a kick but heavier
  const osc  = audioCtx.createOscillator();
  const dist = audioCtx.createWaveShaper();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(130, now);
  osc.frequency.exponentialRampToValueAtTime(38, now + 0.12);

  // Soft clip for body
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i * 2) / 256 - 1;
    curve[i] = (Math.PI + 220) * x / (Math.PI + 220 * Math.abs(x));
  }
  dist.curve = curve;

  gain.gain.setValueAtTime(0.55, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

  osc.connect(dist); dist.connect(gain); gain.connect(masterGain);
  osc.start(now); osc.stop(now + 0.26);
}

function playUFOSound() {
  if (!audioCtx || soundMode !== SOUND_ALL) return;
  const now = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.type = 'sine';
  o.frequency.setValueAtTime(440, now);
  o.frequency.setValueAtTime(660, now + 0.05);
  o.frequency.setValueAtTime(440, now + 0.1);
  g.gain.setValueAtTime(0.05, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  o.start(now); o.stop(now + 0.2);
}

function playEnemyDeathSound(points) {
  if (!audioCtx || soundMode !== SOUND_ALL) return;
  const now = audioCtx.currentTime;
  const baseFreq = points === 30 ? 320 : points === 20 ? 240 : 180;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.type = 'square';
  o.frequency.setValueAtTime(baseFreq, now);
  o.frequency.exponentialRampToValueAtTime(baseFreq * 0.3, now + 0.12);
  g.gain.setValueAtTime(0.07, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
  o.start(now); o.stop(now + 0.18);
}

function toggleSound() {
  const prev = soundMode;
  if (soundMode === SOUND_ALL)        soundMode = SOUND_MUSIC;
  else if (soundMode === SOUND_MUSIC) soundMode = SOUND_OFF;
  else                                soundMode = SOUND_ALL;

  const labels = { [SOUND_ALL]: '♪ Music+SFX', [SOUND_MUSIC]: '♪ Music only', [SOUND_OFF]: '× Mute' };
  document.getElementById('soundBtn').textContent = labels[soundMode];

  if (soundMode === SOUND_OFF && audioCtx) {
    audioCtx.suspend();
  } else if (prev === SOUND_OFF && audioCtx) {
    audioCtx.resume();
    schedulerTick();
  }
}
