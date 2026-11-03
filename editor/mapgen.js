// Runeforged forgemap generator: song analysis + draft forgemap builder.
// Plain script: defines globals in the browser, module.exports in node. No dependencies.
//
// Timing convention (read from the mod, not guessed). All forgemap times are integer milliseconds.
//   spawn_time_ms is the HIT moment, not the spawn moment.
//   - RunicMinigameSession.expectedMs(): startMs + note.spawnTimeMs()          (RunicMinigameSession.java:524-526)
//     and every judge (lanes, clicks, catch landing) compares against that time.
//   - Slider second tap is judged at spawn + slider_duration_ms                (RunicMinigameSession.java:364, 456)
//   - The client draws the approach ring from targetMs - approachMs to targetMs
//     (RunicMinigameClientState.java:874, RunicMinigameOverlay.java:94), so approach_ms is lead-in only.
//   - Music starts at minigameStartMs + music_offset_ms                        (RunicMinigameClientState.java:291-292)
//   So a sound at song time ms is heard at music_offset_ms + ms after the session start, and its note gets
//   spawn_time_ms = round(onset ms) + music_offset_ms (no tick rounding any more). We use music_offset_ms 0 and keep
//   ABSOLUTE song time (the track always plays from its start), so the window (startMs, or the auto-picked
//   loudest section) only chooses which part of the song gets notes. Notes earlier than approach_ms are skipped
//   so the first ring gets its full approach. Judges add LATENCY_GRACE_MS = 50 (RunicMinigameSession.java:20).

const TIER_CURVE = [
  { tier: 0, label: 'Novice',      nps: 1.0, lengthS: 20, approachMs: 2000, hitWindowMs: 300, perfectMs: 150, goodMs: 300, thresholds: [40, 60, 75, 88, 95] },
  { tier: 1, label: 'Adept',       nps: 1.4, lengthS: 25, approachMs: 1700, hitWindowMs: 250, perfectMs: 150, goodMs: 250, thresholds: [45, 65, 80, 90, 96] },
  { tier: 2, label: 'Expert',      nps: 1.8, lengthS: 30, approachMs: 1400, hitWindowMs: 200, perfectMs: 100, goodMs: 200, thresholds: [50, 70, 85, 95, 98] },
  { tier: 3, label: 'Master',      nps: 2.3, lengthS: 35, approachMs: 1200, hitWindowMs: 200, perfectMs: 100, goodMs: 200, thresholds: [55, 75, 88, 96, 99] },
  { tier: 4, label: 'Grandmaster', nps: 2.8, lengthS: 40, approachMs: 1000, hitWindowMs: 150, perfectMs: 50,  goodMs: 150, thresholds: [60, 80, 90, 97, 99] },
];

const DIFFICULTIES = [
  { id: 'novice',              label: 'Novice',              nps: 0.6, windows: 1.5,  thresholds: -10 },
  { id: 'adept',               label: 'Adept',               nps: 0.8, windows: 1.25, thresholds: -5 },
  { id: 'expert',              label: 'Expert',              nps: 1.0, windows: 1.0,  thresholds: 0 },
  { id: 'master',              label: 'Master',              nps: 1.2, windows: 0.85, thresholds: 2 },
  { id: 'grandmaster',         label: 'Grandmaster',         nps: 1.4, windows: 0.7,  thresholds: 4 },
  { id: 'god_of_runesmithing', label: 'God of Runesmithing', nps: 1.7, windows: 0.55, thresholds: 6 },
];

// ------------------------------------------------------------------ analysis

const FFT_N = 1024, HOP = 512;

function fftMag(re, im) { // in-place radix-2, returns nothing; re/im length power of 2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2;
        const tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function interp(arr, x) {
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= arr.length) return 0;
  const f = x - i;
  return arr[i] * (1 - f) + arr[i + 1] * f;
}

function analyzeSamples(samples, sampleRate) {
  const bins = FFT_N / 2;
  const nFrames = Math.max(0, Math.floor((samples.length - FFT_N) / HOP) + 1);
  const hopMs = HOP / sampleRate * 1000;
  // Frame i is centred on sample i*HOP + N/2; onsets are reported at the frame centre
  // minus a quarter window (flux peaks while the attack sits in the rising half of the Hann window).
  const frameMs = i => (i * HOP + FFT_N / 4) / sampleRate * 1000;
  const win = new Float32Array(FFT_N);
  for (let i = 0; i < FFT_N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT_N - 1));
  // ponytail: full log spectrogram kept in memory (~2 KB/frame, ~45 MB for 4 min); band it down if songs get long.
  const spec = new Float32Array(nFrames * bins);
  const flux = new Float32Array(nFrames);
  const re = new Float64Array(FFT_N), im = new Float64Array(FFT_N);
  for (let f = 0; f < nFrames; f++) {
    const o = f * HOP;
    for (let i = 0; i < FFT_N; i++) { re[i] = samples[o + i] * win[i]; im[i] = 0; }
    fftMag(re, im);
    let fl = 0;
    for (let k = 0; k < bins; k++) {
      const v = Math.log1p(Math.hypot(re[k], im[k]));
      spec[f * bins + k] = v;
      if (f > 0) { const d = v - spec[(f - 1) * bins + k]; if (d > 0) fl += d; }
    }
    flux[f] = fl;
  }

  // Adaptive threshold peak picking.
  const local = new Float32Array(nFrames);
  for (let i = 0, sum = 0, lo = 0, hi = -1; i < nFrames; i++) {
    const a = Math.max(0, i - 16), b = Math.min(nFrames - 1, i + 8);
    while (hi < b) sum += flux[++hi];
    while (lo < a) sum -= flux[lo++];
    local[i] = sum / (hi - lo + 1);
  }
  let fmax = 0; for (const v of flux) if (v > fmax) fmax = v;
  const peaks = [];
  for (let i = 1; i < nFrames - 1; i++) {
    const v = flux[i];
    if (v < local[i] * 1.25 + 0.03 * fmax) continue;
    let isMax = true;
    for (let j = Math.max(0, i - 3); j <= Math.min(nFrames - 1, i + 3); j++) if (flux[j] > v || (flux[j] === v && j < i)) { isMax = false; break; }
    if (isMax) peaks.push(i);
  }
  const sortedPeak = peaks.map(i => flux[i]).sort((a, b) => a - b);
  const ref = sortedPeak.length ? sortedPeak[Math.floor(sortedPeak.length * 0.95)] || sortedPeak[sortedPeak.length - 1] : 1;
  // Second, lower pick: softer hits the map can fall back on when the strong onsets can't fill the target.
  const weakPeaks = [];
  for (let i = 1, s = 0; i < nFrames - 1; i++) {
    const v = flux[i];
    if (v < local[i] * 1.0 + 0.01 * fmax) continue;
    let isMax = true;
    for (let j = Math.max(0, i - 2); j <= Math.min(nFrames - 1, i + 2); j++) if (flux[j] > v || (flux[j] === v && j < i)) { isMax = false; break; }
    if (!isMax) continue;
    while (s < peaks.length && peaks[s] < i - 2) s++;
    if (s < peaks.length && Math.abs(peaks[s] - i) <= 2) continue;
    weakPeaks.push(i);
  }

  const binHz = sampleRate / FFT_N, lgLo = Math.log2(80), lgHi = Math.log2(8000);
  const describe = f => {
    // Pitch: centroid of what is NEW in this frame (positive spectral difference) on a log-frequency axis
    // (bins weighted 1/k so every octave counts the same, else broadband hats swamp it), normalised 80 Hz..8 kHz.
    const w = new Float32Array(bins);
    let ws = 0, wc = 0;
    for (let k = 1; k < bins; k++) {
      const d = spec[f * bins + k] - spec[(f - 1) * bins + k];
      if (d > 0) { w[k] = d; ws += d / k; wc += d / k * Math.log2(k * binHz); }
    }
    const c = ws > 0 ? wc / ws : 10;
    const pitch = Math.min(1, Math.max(0, (c - lgLo) / (lgHi - lgLo)));
    // Sustain: how long the bins that rose stay above half their onset level.
    const energy = g => { let e = 0; for (let k = 1; k < bins; k++) if (w[k]) e += w[k] * spec[g * bins + k]; return e; };
    let peakE = 0;
    for (let g = f; g < Math.min(nFrames, f + 3); g++) peakE = Math.max(peakE, energy(g));
    const base = energy(Math.max(0, f - 2));
    let end = f, maxEnd = Math.min(nFrames - 1, f + Math.ceil(4000 / hopMs));
    while (end < maxEnd && energy(end + 1) - base > 0.5 * (peakE - base)) end++;
    return {
      ms: Math.round(frameMs(f) * 10) / 10,
      strength: Math.min(1, flux[f] / ref),
      pitch: Math.round(pitch * 1000) / 1000,
      sustainMs: Math.round((end - f) * hopMs),
    };
  };
  const onsets = peaks.map(describe);
  const weakOnsets = weakPeaks.map(describe);

  // Tempo: comb over the autocorrelation of the onset envelope, 60-200 BPM, mild prior around 120.
  const env = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) env[i] = Math.max(0, flux[i] - local[i]);
  const maxLag = Math.min(nFrames - 1, Math.ceil(4 * 60000 / 60 / hopMs) + 2);
  const ac = new Float32Array(maxLag + 1);
  for (let l = 1; l <= maxLag; l++) {
    let s = 0;
    for (let i = 0; i + l < nFrames; i++) s += env[i] * env[i + l];
    ac[l] = s / (nFrames - l);
  }
  let bpm = 120, best = -1;
  for (let b = 60; b <= 200; b += 0.05) {
    const p = 60000 / b / hopMs;
    let s = 0;
    for (let k = 1; k <= 4; k++) s += interp(ac, k * p);
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(b / 120) / 0.9, 2));
    if (s * prior > best) { best = s * prior; bpm = b; }
  }
  // Beat phase (and a fine tempo refinement, since 0.1 BPM drifts ~25 ms in 30 s): the grid where the detected
  // onsets (same time base as the notes) sit closest to the beats, strength-weighted so on-beat hits outvote hats.
  const coarse = bpm;
  let beatOffsetMs = 0, bestP = -1;
  for (let b = coarse - 0.3; b <= coarse + 0.3; b += 0.02) {
    const beat = 60000 / b;
    for (let ph = 0; ph < beat; ph += 2) {
      let s = 0;
      for (const o of onsets) {
        const d = ((o.ms - ph) % beat + beat) % beat, e = Math.min(d, beat - d);
        if (e < 60) s += o.strength * Math.exp(-(e * e) / 450);
      }
      if (s > bestP) { bestP = s; beatOffsetMs = ph; bpm = b; }
    }
  }

  return {
    durationMs: Math.round(samples.length / sampleRate * 1000),
    bpm: Math.round(bpm * 100) / 100,
    beatOffsetMs: Math.round(beatOffsetMs * 10) / 10,
    onsets,
    // Extras for buildForgemap's fill: softer onsets, and the onset envelope (flux / strength ref) per frame.
    weakOnsets,
    envelope: { startMs: Math.round(frameMs(0) * 10) / 10, hopMs, values: Array.from(flux, v => Math.round(Math.min(1, v / ref) * 1000) / 1000) },
  };
}

async function analyzeSong(arrayBuffer) {
  const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const ctx = Ctx ? new Ctx(1, 1, 44100) : new AudioContext();
  const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const mono = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels;
  }
  if (ctx.close && !Ctx) ctx.close();
  return analyzeSamples(mono, buf.sampleRate);
}

// ------------------------------------------------------------------ map building

function prng(seed) { // mulberry32 over a string/number hash
  let h = 1779033703 ^ String(seed).length;
  for (const ch of String(seed)) { h = Math.imul(h ^ ch.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let LAMBDA_MAX = 4;
const r3 = v => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function thresholdsFor(base, add) {
  const t = base.map(v => clamp(v + add, 0, 99));
  for (let i = 1; i < 5; i++) t[i] = Math.max(t[i], t[i - 1] + 1);
  t[4] = Math.min(t[4], 99);
  for (let i = 3; i >= 0; i--) t[i] = Math.min(t[i], t[i + 1] - 1);
  return t;
}

/** The numbers a map gets from tier x difficulty, all in ms (exported for the editor UI and the test). */
function curveFor(tier, difficulty) {
  const c = TIER_CURVE[tier], d = DIFFICULTIES.find(x => x.id === difficulty);
  if (!c) throw new Error('tier must be 0-4');
  if (!d) throw new Error('unknown difficulty ' + difficulty);
  const s = v => Math.max(50, Math.round(v * d.windows));
  const good = s(c.goodMs), perfect = Math.min(s(c.perfectMs), good);
  // Minimum gap between judged notes (not counting lane chords): the next note's window may not open
  // before the previous target has passed (good + 50), and never under 150 ms (~6-7 taps/s, the
  // fastest steady repeat a player can read and react to).
  return {
    nps: c.nps * d.nps, lengthS: c.lengthS, approach: s(c.approachMs), hitWindow: s(c.hitWindowMs),
    perfect, good, thresholds: thresholdsFor(c.thresholds, d.thresholds), minGap: Math.max(150, good + 50),
  };
}

/** Start of the lenMs window with the most onset energy, keeping off the first/last 5% of the song when it fits. */
function pickSection(onsets, durationMs, lenMs, minStart) {
  let lo = Math.max(minStart, durationMs * 0.05), hi = durationMs * 0.95 - lenMs;
  if (hi < lo) { lo = minStart; hi = durationMs - lenMs; }
  if (hi <= lo) return lo;
  const sorted = onsets.map(o => [o.ms, o.strength]).sort((a, b) => a[0] - b[0]);
  let best = lo, bestS = -1;
  for (let s = lo; s <= hi; s += 250) {
    let sum = 0;
    for (const [ms, st] of sorted) { if (ms > s + lenMs) break; if (ms >= s) sum += st; }
    if (sum > bestS + 1e-9) { bestS = sum; best = s; }
  }
  return Math.round(best);
}

function buildForgemap(opts) {
  const { analysis, mode = 'standard', tier = 0, difficulty = 'expert', school = 'none', name = 'generated', musicTrack = '', seed = 1, startMs, lengthMs } = opts;
  if (!['standard', 'catch', 'lanes'].includes(mode)) throw new Error('mode must be standard, catch or lanes');
  const cv = curveFor(tier, difficulty);
  const rnd = prng(seed + ':' + mode + ':' + tier + ':' + difficulty);
  const beatMs = 60000 / (analysis.bpm || 120);
  const gridMs = beatMs / (tier >= 3 ? 4 : 2);
  const off = analysis.beatOffsetMs || 0;
  const offset = 0; // music_offset_ms
  const allOnsets = analysis.onsets.concat(analysis.weakOnsets || []);
  const lenMs = lengthMs ?? cv.lengthS * 1000, minStart = cv.approach; // lengthMs: optional map length (default per tier)
  const winStart = Math.max(startMs === undefined ? pickSection(allOnsets, analysis.durationMs, lenMs, minStart) : startMs, minStart);
  const winEnd = Math.min(analysis.durationMs, winStart + lenMs);
  let catchCfg;

  // Every candidate has `t` = its hit time in ms (song time + offset). Onsets snap to the exact beat grid when
  // within 50 ms, so they stay on the real sound. Grid points (the fill) come after every real onset, and
  // `taken` keeps them (and duplicate onsets) off times a candidate already owns.
  const taken = [];
  const isTaken = t => taken.some(u => Math.abs(u - t) < 25);
  const beatPosOf = ms => (ms - off) / beatMs;
  const onBeatOf = ms => Math.abs(beatPosOf(ms) - Math.round(beatPosOf(ms))) < 0.2;
  // Held notes are salient even when their attack is soft (and are where holds/sliders come from),
  // so long sustains are picked before the drums around them can crowd them out.
  const longMs = 700 - 75 * tier; // sustain that turns into a hold/slider
  const prio = c => c.strength + (c.sustainMs >= longMs ? 1 : 0);
  const fromOnsets = list => {
    const out = [];
    for (const o of list.slice().sort((a, b) => prio(b) - prio(a) || a.ms - b.ms)) {
      if (o.ms < winStart || o.ms > winEnd) continue;
      const g = off + Math.round((o.ms - off) / gridMs) * gridMs;
      const ms = Math.round(Math.abs(g - o.ms) <= 50 ? g : o.ms);
      if (isTaken(ms + offset)) continue;
      taken.push(ms + offset);
      out.push({ ...o, t: ms + offset, onBeat: onBeatOf(ms) });
    }
    return out;
  };
  const strongCands = fromOnsets(analysis.onsets);
  const weakCands = fromOnsets(analysis.weakOnsets || []);
  const cands = strongCands.concat(weakCands);
  // Grid fill: beats, then 1/2 beats, then 1/4 beats (tier 3+); louder envelope frames first.
  // Pitch comes from the nearest real onset so lanes/catch/paths still follow the melody.
  const env = analysis.envelope;
  const envAt = ms => {
    if (!env) return 0;
    const i = Math.round((ms - env.startMs) / env.hopMs);
    let v = 0;
    for (let j = i - 1; j <= i + 1; j++) if (j >= 0 && j < env.values.length) v = Math.max(v, env.values[j]);
    return v;
  };
  const sortedOnsets = allOnsets.slice().sort((a, b) => a.ms - b.ms);
  const pitchAt = ms => {
    let lo = 0, hi = sortedOnsets.length - 1;
    if (hi < 0) return 0.5;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sortedOnsets[m].ms < ms) lo = m + 1; else hi = m; }
    const a = sortedOnsets[Math.max(0, lo - 1)], b = sortedOnsets[lo];
    return Math.abs(a.ms - ms) < Math.abs(b.ms - ms) ? a.pitch : b.pitch;
  };
  const gridPass = div => {
    const step = beatMs / div, out = [];
    for (let k = Math.ceil((winStart - off) / step); off + k * step <= winEnd; k++) {
      const ms = Math.round(off + k * step);
      if (ms < winStart || isTaken(ms + offset)) continue;
      taken.push(ms + offset);
      out.push({ ms, t: ms + offset, strength: envAt(ms) * 0.5, pitch: pitchAt(ms), sustainMs: 0, onBeat: onBeatOf(ms), grid: true });
    }
    return out.sort((a, b) => b.strength - a.strength || a.t - b.t);
  };
  const fill = [gridPass(1), gridPass(2)].concat(tier >= 3 ? [gridPass(4)] : []);
  const target = Math.round(cv.nps * (winEnd - winStart) / 1000);
  const chordFrac = mode === 'lanes' && tier >= 2 ? 0.04 + 0.03 * (tier - 2) : 0;
  const chordCount = Math.round(target * chordFrac / (1 + chordFrac));
  const want = target - chordCount;

  const minLong = Math.max(200, 2 * cv.good);
  const longCap = 0.08 + 0.05 * tier; // share of notes that may be long
  // Selection. Each candidate occupies [t, t + slider span + minGap); picked notes may not overlap (standard
  // sliders hold the cursor, so they reserve their span; lane holds only block their lane and are added later).
  // A plain strongest-first greedy stalls near the beat rate (strong beats leave gaps just under 2 x minGap), so
  // this is weighted interval scheduling: weight = source rank (strong onset 2, weak onset 1, grid 0) + strength
  // + lambda per note, with lambda raised until the target count fits; extras are trimmed weakest-first.
  // The first nLong long candidates (sliders/holds, in priority order) are mandatory: no lambda can outbid them,
  // else the count maximiser would always trade one sustained note for the drum hits beside it. When their spans
  // keep the map from its target (dense standard maps), the weakest long note is released and we retry.
  const longIdx = [];
  const all = [[strongCands, 2], [weakCands, 1], ...fill.map(f => [f, 0])].flatMap(([list, rankW]) => list.map(c => {
    const isLong = mode !== 'catch' && c.sustainMs >= longMs && Math.min(c.sustainMs, 1200) >= minLong;
    return { c, rankW, isLong };
  }));
  all.forEach((a, i) => { if (a.isLong) longIdx.push(i); });
  const select = nLong => {
    const longSet = new Set(longIdx.slice(0, nLong));
    const items = all.map(({ c, rankW }, i) => {
      const long = longSet.has(i);
      // dense maps get short sliders, else the slider spans eat the time the target needs
      const dur = long && mode === 'standard' ? Math.round(Math.max(minLong, Math.min(c.sustainMs, 1.5 * beatMs, 1200, 2000 / cv.nps))) : 0;
      return { ...c, dur, end: c.t + dur, w: rankW + prio(c) + (long ? 1000 : 0) };
    });
    items.sort((a, b) => (a.end - b.end) || (a.t - b.t));
    const reachEnd = items.map(it => it.end + cv.minGap);
    const prevOf = items.map(it => { // last item whose reserved span ends by it.t
      let lo = 0, hi = items.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (reachEnd[m] <= it.t) lo = m + 1; else hi = m; }
      return lo - 1;
    });
    const schedule = lambda => {
      const best = new Float64Array(items.length + 1), take = new Uint8Array(items.length);
      for (let i = 0; i < items.length; i++) {
        const withIt = items[i].w + lambda + best[prevOf[i] + 1];
        if (withIt > best[i]) { best[i + 1] = withIt; take[i] = 1; } else best[i + 1] = best[i];
      }
      const out = [];
      for (let i = items.length - 1; i >= 0;) { if (take[i]) { out.push(items[i]); i = prevOf[i]; } else i--; }
      return out;
    };
    let out = schedule(0);
    if (out.length < want) {
      // lambda is capped: past ~4 the scheduler starts swapping one real onset for two silent grid points
      // just to squeeze out the last few notes of the target
      let lo = 0, hi = LAMBDA_MAX;
      out = schedule(hi);
      if (out.length > want) {
        for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (schedule(mid).length >= want) hi = mid; else lo = mid; }
        out = schedule(hi);
      }
    }
    return out.length > want ? out.sort((a, b) => b.w - a.w || a.t - b.t).slice(0, want) : out;
  };
  let nLong = Math.min(longIdx.length, Math.floor(longCap * want));
  let picked = select(nLong);
  // Release while it buys a note toward the target, or swaps grid fill for real onsets; stop when it doesn't.
  const better = (a, b) => Math.min(a.length, want) - Math.min(b.length, want) || b.filter(p => p.grid).length - a.filter(p => p.grid).length;
  while (nLong > 0 && picked.some(p => p.grid || picked.length < want)) {
    const next = select(nLong - 1);
    if (better(next, picked) <= 0) break;
    picked = next; nLong--;
  }
  picked.sort((a, b) => a.t - b.t);
  const pitches = picked.map(p => p.pitch).sort((a, b) => a - b);
  const rank = p => pitches.length > 1 ? pitches.filter(v => v < p).length / (pitches.length - 1) : 0.5;
  const pickedTimes = new Set(picked.map(p => p.t));

  const base = (id, type, t) => ({ id, type, spawn_time_ms: t, hit_window_ms: cv.hitWindow });
  const notes = [];

  if (mode === 'lanes') {
    const freeAt = [0, 0, 0, 0];
    let holdEnd = -1, holds = 0;
    const mirror = new Map();
    const strong = new Set(picked.slice().sort((a, b) => b.strength - a.strength).slice(0, chordCount).map(p => p.t));
    picked.forEach((p, i) => {
      const next = picked[i + 1];
      let hold = 0;
      if (p.sustainMs >= longMs && holds < longCap * picked.length && p.t > holdEnd && !strong.has(p.t)) {
        let len = Math.round(p.sustainMs);
        if (tier < 2 && next) len = Math.min(len, next.t - p.t - cv.minGap);
        len = Math.min(len, 2000);
        if (len >= minLong) hold = len;
      }
      // pitch band, mirrored for some 4-bar phrases (seeded) so patterns vary without losing the contour's shape
      const ph = Math.floor((p.t - offset - off) / (beatMs * 16));
      if (!mirror.has(ph)) mirror.set(ph, rnd() < 0.35);
      const band = clamp(Math.floor(rank(p.pitch) * 4), 0, 3);
      const want = mirror.get(ph) ? 3 - band : band;
      const pick = exclude => {
        const free = [0, 1, 2, 3].filter(l => l !== exclude && freeAt[l] <= p.t);
        let lane = rnd() < 0.2 ? clamp(want + (rnd() < 0.5 ? -1 : 1), 0, 3) : want;
        if (!free.includes(lane)) {
          const d = Math.min(...free.map(l => Math.abs(l - lane)));
          const near = free.filter(l => Math.abs(l - lane) === d);
          lane = near[Math.floor(rnd() * near.length)];
        }
        return lane;
      };
      const lane = pick(-1);
      const n = { ...base('', hold ? 'hold' : 'tap', p.t), lane };
      if (hold) { n.hold_ms = hold; holdEnd = p.t + hold; holds++; }
      freeAt[lane] = p.t + hold + (hold ? cv.minGap : 1);
      notes.push(n);
      if (strong.has(p.t)) {
        const l2 = pick(lane);
        freeAt[l2] = p.t + 1;
        notes.push({ ...base('', 'tap', p.t), lane: l2 });
      }
    });
  } else if (mode === 'catch') {
    const barWidth = r3(0.28 - 0.03 * tier);
    const barSpeed = r3(0.8 - 0.1 * tier); // board widths per second; walking covers tier 0 jumps, tier 4 needs the dash
    const dash = Math.round((2 + 0.25 * tier) * 100) / 100;
    const reach = gapMs => barWidth / 2 * 0.3 + barSpeed * dash * gapMs / 1000 * 0.9; // perfect-catch reach with dashing
    const amp = 0.5 + 0.1 * tier; // wider swings at higher tiers, so walking stops being enough
    let x = 0.5, last = 0;
    for (const p of picked) {
      const want = 0.5 + (rank(p.pitch) - 0.5) * amp;
      let nx = x + (want - x) * 0.7 + (rnd() - 0.5) * 0.08;
      const m = reach(p.t - last);
      nx = clamp(clamp(nx, x - m, x + m), barWidth / 2, 1 - barWidth / 2);
      notes.push({ ...base('', 'drop', p.t), position: { x: r3(nx) } });
      x = r3(nx); last = p.t;
    }
    catchCfg = { bar_width: barWidth, bar_speed: barSpeed, dash_multiplier: dash };
  } else {
    let pos = [0.5, 0.5], ang = rnd() * Math.PI * 2, prevPitch = 0.5, prevEnd = 0;
    const spans = [];
    const inBox = v => clamp(v, 0.1, 0.9);
    const step = (from, dist) => {
      let nx = from[0] + Math.cos(ang) * dist, ny = from[1] + Math.sin(ang) * dist;
      if (nx < 0.1 || nx > 0.9) { ang = Math.PI - ang; nx = from[0] + Math.cos(ang) * dist; }
      if (ny < 0.1 || ny > 0.9) { ang = -ang; ny = from[1] + Math.sin(ang) * dist; }
      return [r3(inBox(nx)), r3(inBox(ny))];
    };
    const phraseOf = t => Math.floor((t - offset - off) / (beatMs * 16));
    picked.forEach(p => {
      const dt = p.t - prevEnd;
      const phrase = dt > 1.5 * beatMs || phraseOf(p.t) !== phraseOf(prevEnd);
      ang += phrase ? (rnd() < 0.5 ? -1 : 1) * (Math.PI / 2 + rnd() * Math.PI / 2) : (p.pitch - prevPitch) * 1.2 + (rnd() - 0.5) * 0.3;
      prevPitch = p.pitch;
      pos = step(pos, clamp(0.06 + dt * 0.00024, 0.08, 0.28) * (0.8 + 0.1 * tier));
      const dur = p.dur;
      const n = { ...base('', dur ? 'slider' : 'primary', p.t), position: { x: pos[0], y: pos[1] } };
      prevEnd = p.t;
      if (dur) {
        const start = pos;
        const end = step(start, clamp(dur * 0.0002, 0.1, 0.3));
        const bend = (rnd() < 0.5 ? -1 : 1) * 0.05;
        const mid = [r3(inBox((start[0] + end[0]) / 2 - Math.sin(ang) * bend)), r3(inBox((start[1] + end[1]) / 2 + Math.cos(ang) * bend))];
        n.slider_end = { x: end[0], y: end[1] };
        n.slider_duration_ms = dur;
        n.slider_path_points = [start, mid, end].map(([x, y]) => ({ x, y }));
        pos = end; prevEnd = p.t + dur;
        spans.push([p.t, p.t + dur]);
      }
      notes.push(n);
    });
    // Support notes from tier 2: weaker off-beat onsets between the judged ones, away from their windows.
    if (tier >= 2) {
      const judged = notes.slice();
      const gap = Math.max(100, Math.ceil(cv.minGap / 2));
      const maxSupport = Math.round(judged.length * 0.1 * (tier - 1));
      const supports = [];
      for (const c of cands) {
        if (supports.length >= maxSupport) break;
        if (c.onBeat || pickedTimes.has(c.t)) continue;
        if (judged.some(j => Math.abs(j.spawn_time_ms - c.t) < gap)) continue;
        if (supports.some(s => Math.abs(s.spawn_time_ms - c.t) < gap)) continue;
        if (spans.some(([a, b]) => c.t >= a && c.t <= b + gap)) continue;
        const prev = judged.filter(j => j.spawn_time_ms < c.t).pop();
        const nxt = judged.find(j => j.spawn_time_ms > c.t);
        const a = prev ? (prev.slider_end || prev.position) : { x: 0.5, y: 0.5 };
        const b = nxt ? nxt.position : a;
        supports.push({ ...base('', 'support', c.t), position: {
          x: r3(clamp((a.x + b.x) / 2 + (rnd() - 0.5) * 0.12, 0.1, 0.9)),
          y: r3(clamp((a.y + b.y) / 2 + (rnd() - 0.5) * 0.12, 0.1, 0.9)) } });
      }
      notes.push(...supports);
    }
  }

  notes.sort((a, b) => a.spawn_time_ms - b.spawn_time_ms || (a.type === 'support') - (b.type === 'support'));
  notes.forEach((n, i) => { n.id = 'n' + i; });
  const count = t => notes.filter(n => n.type === t).length;
  const totalHits = mode === 'catch' ? count('drop')
    : mode === 'lanes' ? count('tap') + 2 * count('hold')
    : count('primary') + 2 * count('slider');
  const [uncommon, rare, epic, legendary, myth] = cv.thresholds;
  const map = {
    tier, school, name, mode, weight: 1, total_hits: totalHits,
    approach_ms: cv.approach, music_track: musicTrack, music_offset_ms: offset,
  };
  if (mode === 'catch') map.catch = catchCfg;
  map.scoring_config = {
    perfect: 2, good: 1, miss: -2, support_hit: 2, support_miss: -1,
    speed: { approach_multiplier: 1, response_window_ms: 500, weight: 0.3 },
    scale: { action_radius_multiplier: 1, support_radius_multiplier: 1, weight: 0.2 },
    accuracy: { perfect_window_ms: cv.perfect, good_window_ms: cv.good, weight: 0.5 },
    quality_thresholds: { uncommon, rare, epic, legendary, myth },
  };
  map.notes = notes;
  return map;
}

if (typeof module !== 'undefined') {
  module.exports = { analyzeSamples, analyzeSong, buildForgemap, curveFor, DIFFICULTIES, TIER_CURVE };
}
