// Forgemap editor, part of the pack editor (index.html). It edits a forgemap file's JSON in place.
// Times are milliseconds. spawn_time_ms is the moment a note is hit; a slider's end is hit at
// spawn + slider_duration_ms and a hold is released at spawn + hold_ms (RunicMinigameSession).
// The song plays at (ms + music_offset_ms) / 1000 seconds, as in the game.
const ForgemapEditor = (() => {
  const TIERS = ['Novice', 'Adept', 'Expert', 'Master', 'Grandmaster'];
  const SCHOOL_IDS = ['none', 'fire', 'ice', 'lightning', 'holy', 'ender', 'blood', 'evocation', 'nature', 'eldritch'].map(s => s === 'none' ? s : 'irons_spellbooks:' + s);
  const LANE_KEYS = ['D', 'F', 'J', 'K'];
  const MODES = {
    standard: { label: 'Rune Forging', tip: 'Strike the rune seals as the closing ring meets them. Mouse, or Z/X/C in game (default keys, rebindable in Controls).',
      tools: { primary: 'Seal: one strike. 1 forge hit.', slider: 'Slider: strike at the start, drag to the end. Drag on the board to draw it. 2 forge hits.', support: 'Support: optional bonus seal. Builds a chain, never counts as a forge hit.' } },
    catch: { label: 'Catch the Rune', tip: 'Runes fall onto the catch line; move the crucible bar under them. A/D or arrows, Shift to dash (default keys, rebindable in Controls).',
      tools: { drop: 'Rune: lands on the catch line at its time. 1 forge hit.', support: 'Spark: optional bonus rune, never a forge hit.' } },
    lanes: { label: 'Runic Lanes', tip: 'Runes slide down 4 lanes to the strike line; press the lane key (D F J K) on the beat.',
      tools: { tap: 'Tap: press the lane key on time. 1 forge hit.', hold: 'Hold: press on the head, release at the tail. Drag up on the board to set its length. 2 forge hits.' } },
  };
  const NOTE_COLORS = { primary: '#ff9f43', slider: '#54a0ff', support: '#1dd1a1', drop: '#48dbfb', tap: '#ff9f43', hold: '#54a0ff' };
  // Expert-difficulty notes per second per tier (the preset curve), used for the "plays like" hint.
  const CURVE_NPS = [1.0, 1.4, 1.8, 2.3, 2.8];
  const DIFF = [['Novice', 0.6], ['Adept', 0.8], ['Expert', 1], ['Master', 1.2], ['Grandmaster', 1.4], ['God of Runesmithing', 1.7]];

  let S = null; // the open map: { f, d, ctx, host, ... }

  const h = (tag, { dataset, ...props } = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); Object.assign(e.dataset, dataset); e.append(...kids.filter(k => k !== null && k !== undefined && k !== false)); return e; };
  const num = (v, fb) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : fb);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mode = () => (S.d.mode || 'standard');

  // ------------------------------------------------------------------ data helpers
  function judgedHits(d) {
    const n = d.notes || [];
    const c = t => n.filter(x => x.type === t).length;
    if ((d.mode || 'standard') === 'catch') return c('drop');
    if (d.mode === 'lanes') return c('tap') + 2 * c('hold');
    return c('primary') + 2 * c('slider');
  }
  function tidy() {
    const d = S.d;
    if (!Array.isArray(d.notes)) d.notes = [];
    const selNote = d.notes[S.sel];
    d.notes.sort((a, b) => num(a.spawn_time_ms, 0) - num(b.spawn_time_ms, 0));
    S.sel = selNote ? d.notes.indexOf(selNote) : -1;
    d.total_hits = judgedHits(d);
  }
  function snapshot() { S.undo.push(JSON.stringify(S.d)); if (S.undo.length > 80) S.undo.shift(); S.redo = []; }
  function restore(json) { const v = JSON.parse(json); for (const k of Object.keys(S.d)) delete S.d[k]; Object.assign(S.d, v); S.sel = -1; edited(true); }
  function edited(rebuildSide) { tidy(); S.ctx.changed(S.f); if (rebuildSide) buildSide(); else refreshInspector(); draw(); stats(); }
  function newId() {
    const used = new Set((S.d.notes || []).map(n => n.id));
    const p = { primary: 'n', slider: 's', support: 'p', drop: 'd', tap: 't', hold: 'h' }[S.tool] || 'n';
    let i = used.size; while (used.has(p + i)) i++;
    return p + i;
  }
  const window_ = () => num(S.f.editor?.window, 200);

  // Beat grid (editor only; kept with the project, not exported, since the mod has no bpm field).
  const ed = () => (S.f.editor ??= { bpm: 120, snap: 4, window: 200 });
  function snapMs() { const e = ed(); return e.snap ? 60000 / e.bpm / e.snap : 50; }
  function snap(t) {
    const e = ed();
    if (!e.snap) return Math.max(0, Math.round(t));
    const step = snapMs(), off = num(e.offset, 0);
    return Math.max(0, Math.round(Math.round((t - off) / step) * step + off));
  }

  // ------------------------------------------------------------------ open / close
  // Maps from before the switch to milliseconds use *_ticks keys (1 tick = 50 ms), which the mod now rejects.
  function fromTicks(f) {
    let found = false;
    const conv = o => { if (o) for (const k of Object.keys(o)) if (k.endsWith('_ticks')) { o[k.slice(0, -6) + '_ms'] = Math.round(num(o[k], 0) * 50); delete o[k]; found = true; } };
    const d = f.data, sc = d.scoring_config;
    [d, sc?.speed, sc?.accuracy, ...(d.notes || [])].forEach(conv);
    if (found) {
      if (d.catch?.bar_speed !== undefined) d.catch.bar_speed = clamp(Math.round(num(d.catch.bar_speed, 0.035) * 20 * 1000) / 1000, 0.1, 4);
      if (f.editor && num(f.editor.window, 0) <= 100) f.editor.window = num(f.editor.window, 4) * 50;
    }
    return found;
  }

  function open(host, f, ctx) {
    close();
    if (fromTicks(f)) { ctx.toast('This map used ticks; it was converted to milliseconds (1 tick = 50 ms).'); ctx.changed(f); }
    S = { f, d: f.data, ctx, host, tool: Object.keys(MODES[f.data.mode || 'standard'].tools)[0], playhead: 0, playing: false, sel: -1,
      zoom: 0.15, undo: [], redo: [], audio: null, peaks: null, raf: 0, lastHit: -1 };
    tidy();
    const first = (f.data.notes || [])[0]; // generated maps start mid-song: open at the first note
    if (first) S.playhead = Math.max(0, num(first.spawn_time_ms, 0) - 1000);
    host.innerHTML = '';
    host.className = 'fm';
    const tools = h('div', { className: 'seg', id: 'fm-tools' });
    const modeSeg = h('div', { className: 'seg' }, ...Object.entries(MODES).map(([id, m]) =>
      h('button', { textContent: m.label, className: mode() === id ? 'on' : '', title: m.tip, onclick: () => switchMode(id) })));
    const bpm = S.bpmIn = h('input', { type: 'text', value: ed().bpm, style: 'width:56px;flex:none', title: 'Beats per minute of the song. Sets the beat grid notes snap to. Editor only: not saved into the map.', onchange: e => { ed().bpm = clamp(num(e.target.value, 120), 30, 400); e.target.value = ed().bpm; S.ctx.changed(S.f); draw(); } });
    const snapSel = h('select', { title: 'Snap new notes to this fraction of a beat. Off places on any millisecond.', onchange: e => { ed().snap = Number(e.target.value); S.ctx.changed(S.f); draw(); } },
      ...[[1, '1/1'], [2, '1/2'], [3, '1/3'], [4, '1/4'], [6, '1/6'], [8, '1/8'], [0, 'off']].map(([v, l]) => h('option', { value: v, textContent: l, selected: ed().snap === v })));
    S.playBtn = h('button', { className: 'primary', textContent: '▶', title: 'Play or pause from the playhead (Space)', onclick: togglePlay });
    S.timeLabel = h('span', { className: 'mono dim', style: 'min-width:120px' });
    S.songLabel = h('span', { className: 'dim', style: 'max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' });
    const songIn = h('input', { type: 'file', accept: '.ogg,audio/ogg', hidden: true, onchange: e => { if (e.target.files[0]) loadSong(e.target.files[0]); e.target.value = ''; } });
    const bar = h('div', { className: 'fm-bar' },
      h('span', { className: 'dim', textContent: 'Mode' }), modeSeg, h('span', { className: 'sep' }),
      h('span', { className: 'dim', textContent: 'Place' }), tools, h('span', { className: 'sep' }),
      S.playBtn, h('button', { textContent: '■', title: 'Stop and go back to the start', onclick: () => { pause(); setPlayhead(0); } }), S.timeLabel,
      h('span', { className: 'sep' }),
      h('button', { textContent: '♫ Song', title: 'Load the song for this map (.ogg, the only format Minecraft plays). It is added to the pack under assets/ and the map\'s music track is set.', onclick: () => songIn.click() }), songIn, S.songLabel,
      h('span', { className: 'sep' }),
      h('span', { className: 'dim', textContent: 'BPM', title: 'Beats per minute of the song' }), bpm,
      h('span', { className: 'dim', textContent: 'Snap' }), snapSel,
      h('span', { style: 'flex:1' }),
      h('button', { textContent: '↶', title: 'Undo (Ctrl+Z)', onclick: undo }), h('button', { textContent: '↷', title: 'Redo (Ctrl+Y)', onclick: redo }));
    S.side = h('div', { className: 'fm-side', id: 'fm-side' });
    S.canvas = h('canvas', { tabIndex: 0 });
    S.board = h('div', { className: 'fm-board' }, S.canvas);
    S.tl = h('canvas');
    S.timeline = h('div', { className: 'fm-tl', id: 'fm-tl' }, S.tl);
    S.status = h('div', { className: 'fm-status' });
    host.append(ctx.crumb, bar,
      h('div', { className: 'fm-main' }, S.side, h('div', { className: 'split v', dataset: { target: 'fm-side', side: 'left', min: 180 }, title: 'Drag to resize, double-click to fold' }), S.board),
      h('div', { className: 'split h', dataset: { target: 'fm-tl', side: 'bottom', min: 50 }, title: 'Drag to resize, double-click to fold' }), S.timeline, S.status);
    buildTools(); buildSide(); bindBoard(); bindTimeline();
    S.ro = new ResizeObserver(() => draw());
    S.ro.observe(S.board); S.ro.observe(S.timeline);
    S.keys = keydown; document.addEventListener('keydown', S.keys);
    attachSong();
    stats(); draw();
  }

  function close() {
    if (!S) return;
    pause();
    S.ro?.disconnect();
    document.removeEventListener('keydown', S.keys);
    if (S.audioUrl) URL.revokeObjectURL(S.audioUrl);
    S = null;
  }

  // ------------------------------------------------------------------ toolbar
  function buildTools() {
    const box = document.getElementById('fm-tools');
    box.innerHTML = '';
    Object.entries(MODES[mode()].tools).forEach(([t, tip], i) => box.append(h('button', {
      className: S.tool === t ? 'on' : '', title: `${tip} (key ${i + 1})`,
      innerHTML: `<span class="dot" style="background:${NOTE_COLORS[t]}"></span>${t === 'primary' ? 'seal' : t === 'drop' ? 'rune' : t === 'support' && mode() === 'catch' ? 'spark' : t}`,
      onclick: () => { S.tool = t; buildTools(); } })));
  }

  async function switchMode(to) {
    if (to === mode()) return;
    const d = S.d;
    const n = (d.notes || []).length;
    if (n && !(await S.ctx.confirmBox(`Switch to ${MODES[to].label}?`, `The ${n} notes keep their timing and are turned into ${Object.keys(MODES[to].tools).join(' / ')} notes. ${to === 'lanes' ? 'Support notes are removed, and notes that would overlap in a lane move to a free lane or are removed.' : ''} You can undo this.`, 'Switch'))) return;
    snapshot();
    const out = [];
    const laneFree = [-1, -1, -1, -1];
    for (const note of d.notes || []) {
      const x = note.position?.x ?? (Number.isInteger(note.lane) ? (note.lane + 0.5) / 4 : 0.5);
      const long = note.type === 'slider' ? num(note.slider_duration_ms, 500) : note.type === 'hold' ? num(note.hold_ms, 500) : 0;
      const base = { id: note.id, spawn_time_ms: note.spawn_time_ms, hit_window_ms: note.hit_window_ms };
      if (to === 'lanes') {
        if (note.type === 'support') continue;
        const t = num(note.spawn_time_ms, 0);
        let lane = clamp(Math.floor(x * 4), 0, 3);
        if (t <= laneFree[lane]) lane = [0, 1, 2, 3].find(l => t > laneFree[l]) ?? -1;
        if (lane < 0) continue;
        laneFree[lane] = t + long;
        out.push(long ? { ...base, type: 'hold', lane, hold_ms: long } : { ...base, type: 'tap', lane });
      } else if (to === 'catch') {
        out.push({ ...base, type: note.type === 'support' ? 'support' : 'drop', position: { x: round3(x) } });
      } else {
        const y = note.position?.y ?? 0.5;
        if (long) out.push({ ...base, type: 'slider', position: { x: round3(x), y: round3(y) }, slider_end: { x: round3(clamp(x + 0.2, 0.05, 0.95)), y: round3(y) }, slider_duration_ms: long });
        else out.push({ ...base, type: note.type === 'support' ? 'support' : 'primary', position: { x: round3(x), y: round3(y) } });
      }
    }
    d.notes = out;
    if (to === 'standard') delete d.mode; else d.mode = to;
    if (to === 'catch') d.catch ??= { bar_width: 0.22, bar_speed: 0.7, dash_multiplier: 2.0 }; else delete d.catch;
    S.tool = Object.keys(MODES[to].tools)[0];
    S.sel = -1;
    S.host.querySelectorAll('.fm-bar .seg:first-of-type button').forEach((b, i) => b.className = Object.keys(MODES)[i] === to ? 'on' : '');
    buildTools();
    edited(true);
  }
  const round3 = v => Math.round(v * 1000) / 1000;

  // ------------------------------------------------------------------ side panel (map settings + selected note)
  function section(id, title, tip, ...rows) {
    const open = !(S.f.editor?.folded || []).includes(id);
    const det = h('details', { open }, h('summary', { textContent: title, title: tip }), ...rows);
    det.ontoggle = () => { const e = ed(); e.folded = (e.folded || []).filter(x => x !== id).concat(det.open ? [] : [id]); };
    return det;
  }
  // A number/text row bound to obj()[key]; obj is a function so nested objects are created on first edit.
  function field(label, tip, get, set, opts = {}) {
    const input = opts.options
      ? h('select', { title: tip, onchange: e => { snapshot(); set(e.target.value); edited(opts.rebuild); } }, ...opts.options.map(([v, l]) => h('option', { value: v, textContent: l, selected: String(get()) === String(v) })))
      : h('input', { type: 'text', value: get() ?? '', title: tip, placeholder: opts.placeholder || '', onfocus: () => snapshot(),
          oninput: e => { const t = e.target.value.trim(); set(opts.text ? t : (t !== '' && Number.isFinite(Number(t)) ? Number(t) : t)); edited(false); } });
    if (opts.list) { input.setAttribute('list', 'fm-dl-' + label.replace(/\W/g, '')); }
    return h('label', { className: 'row', title: tip }, h('span', { textContent: label }), input,
      opts.list ? h('datalist', { id: 'fm-dl-' + label.replace(/\W/g, '') }, ...opts.list.map(v => h('option', { value: v }))) : null);
  }
  const at = (path, create) => { let o = S.d; for (const k of path) { if (o[k] === undefined || typeof o[k] !== 'object') { if (!create) return undefined; o[k] = {}; } o = o[k]; } return o; };
  const bind = (path, key, label, tip, opts) => field(label, tip, () => at(path)?.[key], v => { at(path, true)[key] = v; }, opts);

  function buildSide() {
    const d = S.d, side = S.side;
    side.innerHTML = '';
    side.append(...[
      section('map', 'Map', 'Which forgings play this map: the hammer\'s mastery tier and the rune\'s school.',
        bind([], 'name', 'Name', 'Shown to players and in the editor. Not blank.', { text: true }),
        bind([], 'tier', 'Tier', 'Hammer mastery tier this map plays at. The game picks among the maps of the same tier and school, at random by weight.', { options: TIERS.map((n, i) => [i, `${i} · ${n}`]), rebuild: false }),
        bind([], 'school', 'School', 'none = a baseline map for any rune. A school id (irons_spellbooks:fire) plays when the hammer is specialised in the rune\'s school; baseline maps fill in when a school has none.', { text: true, list: SCHOOL_IDS }),
        bind([], 'weight', 'Weight', 'Relative chance among maps of the same tier and school. 1 to 1000; weight 3 is picked three times as often as weight 1.')),
      section('timing', 'Timing and song', 'How early notes appear, and the song that plays.',
        bind([], 'approach_ms', 'Approach', 'Milliseconds a note is visible before it must be hit (1000 = 1 second). Lower is harder.'),
        bind([], 'music_track', 'Music track', 'Sound event id that plays, for example my_pack:minigame/song. Set for you when you load a song. Players need the sound (the pack\'s assets/ part as a resource pack).', { text: true }),
        bind([], 'music_offset_ms', 'Music offset', 'Shifts the song against the notes, in milliseconds. Positive starts the song later into the track. Does not change scoring.')),
      mode() === 'catch' ? section('catch', 'Crucible bar', 'The bar players move to catch runes.',
        bind(['catch'], 'bar_width', 'Bar width', 'Width of the bar as a fraction of the board (0 to 1). Narrower is harder.'),
        bind(['catch'], 'bar_speed', 'Bar speed', 'How far the bar moves per second, in board widths (0.1 to 4). Runes too far apart to reach show red on the board.'),
        bind(['catch'], 'dash_multiplier', 'Dash ×', 'Speed multiplier while Shift is held. Runes reachable only with a dash show amber.')) : null,
      section('accuracy', 'Judging', 'How strict the timing is.',
        field('New note window', 'Hit window (milliseconds either side) given to notes you place. Each note keeps its own; edit it on the selected note.', () => window_(), v => { ed().window = clamp(num(v, 200), 1, 5000); }),
        bind(['scoring_config', 'accuracy'], 'perfect_window_ms', 'Perfect window', 'Milliseconds from the exact moment that still count as perfect. 1 to 5000, at most the good window.'),
        bind(['scoring_config', 'accuracy'], 'good_window_ms', 'Good window', 'Milliseconds from the exact moment that still count as good. 1 to 5000.'),
        bind(['scoring_config', 'speed'], 'approach_multiplier', 'Approach ×', 'Speeds up (above 1) or slows down the approach. 0.1 to 4.'),
        bind(['scoring_config', 'speed'], 'response_window_ms', 'Response window', 'Milliseconds used to score reaction speed. 1 to 5000.'),
        bind(['scoring_config', 'scale'], 'action_radius_multiplier', 'Target size ×', 'Size of strike targets. Below 1 is smaller and harder. 0.25 to 2.'),
        bind(['scoring_config', 'scale'], 'support_radius_multiplier', 'Support size ×', 'Size of support targets. 0.25 to 2.')),
      section('quality', 'Forge quality', 'Score needed for each quality. The hammer\'s tier also caps the best quality it can reach.',
        ...['uncommon', 'rare', 'epic', 'legendary', 'myth'].map(q => bind(['scoring_config', 'quality_thresholds'], q, q[0].toUpperCase() + q.slice(1), `Minimum score (0 to 100) for ${q}. Must rise from Uncommon to Myth.`)),
        bind(['scoring_config', 'speed'], 'weight', 'Speed weight', 'Share of the score from reaction speed. Speed + scale + accuracy weights must add up to 1.'),
        bind(['scoring_config', 'scale'], 'weight', 'Scale weight', 'Share of the score from hitting inside smaller targets.'),
        bind(['scoring_config', 'accuracy'], 'weight', 'Accuracy weight', 'Share of the score from timing.')),
      section('points', 'Score popups', 'Points shown while playing. They don\'t decide quality.',
        ...[['perfect', 'Perfect'], ['good', 'Good'], ['miss', 'Miss'], ['support_hit', 'Support hit'], ['support_miss', 'Support miss']].map(([k, l]) => bind(['scoring_config'], k, l, `Points for a ${l.toLowerCase()} (whole number).`))),
      S.insp = h('div')].filter(Boolean));
    refreshInspector();
  }

  function refreshInspector() {
    if (!S.insp) return;
    S.insp.innerHTML = '';
    const n = S.d.notes?.[S.sel];
    if (!n) { S.insp.append(h('div', { className: 'hint', textContent: 'Click the board to place notes at the playhead. Click a note to select it; drag to move it; right-click or Delete removes it. Space plays, arrow keys step by the snap.' })); return; }
    const t = n.type, rows = [
      field('Type', 'Note type', () => t, v => { n.type = v; if (v === 'slider') { n.slider_end ??= { x: clamp((n.position?.x ?? 0.5) + 0.2, 0, 1), y: n.position?.y ?? 0.5 }; n.slider_duration_ms ??= 500; } else { delete n.slider_end; delete n.slider_duration_ms; delete n.slider_path_points; } if (v === 'hold') n.hold_ms ??= 500; else delete n.hold_ms; }, { options: Object.keys(MODES[mode()].tools).map(x => [x, x]), rebuild: true }),
      field('Time (ms)', 'The moment the note must be hit, from the start of the forging.', () => n.spawn_time_ms, v => { n.spawn_time_ms = v; }),
      field('Hit window', 'Milliseconds either side of the time that still count.', () => n.hit_window_ms, v => { n.hit_window_ms = v; }),
      field('Id', 'Unique name of the note within the map.', () => n.id, v => { n.id = v; }, { text: true }),
    ];
    if (mode() === 'lanes') rows.push(field('Lane', 'Lane 0 to 3 (keys D F J K).', () => n.lane, v => { n.lane = v; }));
    else rows.push(field('X', 'Across the board, 0 (left) to 1 (right).', () => n.position?.x, v => { (n.position ??= {}).x = v; }));
    if (mode() === 'standard') rows.push(field('Y', 'Down the board, 0 (top) to 1 (bottom).', () => n.position?.y, v => { (n.position ??= {}).y = v; }));
    if (t === 'slider') rows.push(
      field('Slide length', 'Milliseconds from the start strike to the end strike.', () => n.slider_duration_ms, v => { n.slider_duration_ms = v; }),
      field('End X', 'Where the slider ends, 0 to 1.', () => n.slider_end?.x, v => { (n.slider_end ??= {}).x = v; }),
      field('End Y', 'Where the slider ends, 0 to 1.', () => n.slider_end?.y, v => { (n.slider_end ??= {}).y = v; }));
    if (t === 'hold') rows.push(field('Hold length', 'Milliseconds from press to release.', () => n.hold_ms, v => { n.hold_ms = v; }));
    S.insp.append(section('note', `Selected note (${t})`, 'The note you clicked on the board.', ...rows,
      h('button', { textContent: 'Delete note', title: 'Remove this note (Delete key)', onclick: deleteSelected, style: 'margin-top:6px' })));
  }

  // ------------------------------------------------------------------ board drawing
  const css = v => getComputedStyle(document.body).getPropertyValue(v).trim();
  function fit(canvas) {
    const r = canvas.parentElement.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.height * dpr);
    canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w: r.width, hgt: r.height };
  }
  function draw() { if (!S) return; drawBoard(); drawTimeline(); S.timeLabel.textContent = `${(S.playhead / 1000).toFixed(2)} s`; }

  // Vertical charts (lanes, catch): the strike line sits near the bottom at the playhead; later notes are higher.
  function vgeom(w, hgt) { const strike = hgt - 46; return { strike, ty: t => strike - (t - S.playhead) * S.zoom, tAt: y => S.playhead + (strike - y) / S.zoom }; }
  function standardRect(w, hgt) { const s = Math.min(w, hgt) - 24; return { x: (w - s) / 2, y: (hgt - s) / 2, s }; }

  function drawBoard() {
    const { g, w, hgt } = fit(S.canvas);
    g.fillStyle = css('--bg2'); g.fillRect(0, 0, w, hgt);
    const notes = S.d.notes || [];
    const accent = css('--accent'), line = css('--line'), dim = css('--dim');
    if (mode() === 'standard') {
      const R = standardRect(w, hgt), ap = Math.max(1, num(S.d.approach_ms, 1000));
      g.strokeStyle = line; g.lineWidth = 1; g.strokeRect(R.x, R.y, R.s, R.s);
      g.globalAlpha = 0.35; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(R.x + R.s * i / 4, R.y); g.lineTo(R.x + R.s * i / 4, R.y + R.s); g.moveTo(R.x, R.y + R.s * i / 4); g.lineTo(R.x + R.s, R.y + R.s * i / 4); g.stroke(); } g.globalAlpha = 1;
      const P = p => [R.x + clamp(num(p?.x, 0.5), 0, 1) * R.s, R.y + clamp(num(p?.y, 0.5), 0, 1) * R.s];
      const r = Math.max(8, R.s * 0.035);
      notes.forEach((n, i) => {
        const t = num(n.spawn_time_ms, 0), end = t + (n.type === 'slider' ? num(n.slider_duration_ms, 0) : 0);
        const dt = t - S.playhead;
        // paused: the next approach window solid, the one after and the last one faint, the rest hidden
        let alpha = S.playing ? (dt > ap || S.playhead > end + 300 ? 0 : 1) : (dt > ap * 2 || S.playhead > end + ap ? 0 : dt > ap || S.playhead > end ? 0.25 : 1);
        if (i === S.sel) alpha = 1;
        if (!alpha) return;
        g.globalAlpha = alpha;
        const [x, y] = P(n.position);
        if (n.type === 'slider') {
          const pts = [n.position, ...(n.slider_path_points || []), n.slider_end].map(P);
          g.strokeStyle = NOTE_COLORS.slider; g.lineWidth = r * 1.2; g.lineCap = 'round'; g.globalAlpha = alpha * 0.35;
          g.beginPath(); pts.forEach(([a, b], k) => k ? g.lineTo(a, b) : g.moveTo(a, b)); g.stroke(); g.globalAlpha = alpha;
          const [ex, ey] = pts[pts.length - 1]; ring(g, ex, ey, r * 0.8, NOTE_COLORS.slider, false);
        }
        ring(g, x, y, n.type === 'support' ? r * 0.7 : r, NOTE_COLORS[n.type] || accent, i === S.sel);
        if (dt > 0 && dt <= ap) { g.strokeStyle = NOTE_COLORS[n.type] || accent; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + (dt / ap) * r * 2.4, 0, Math.PI * 2); g.stroke(); }
        g.globalAlpha = 1;
      });
      g.fillStyle = dim; g.font = '11px Segoe UI'; g.fillText(S.playing ? 'Preview: notes appear as in game' : 'Paused: nearby notes bright, later ones faint. Click to place at the playhead.', R.x, R.y + R.s + 16);
      return;
    }
    const G = vgeom(w, hgt);
    // beat grid
    const e = ed(), beat = 60000 / e.bpm, sub = snapMs();
    const t0 = G.tAt(hgt), t1 = G.tAt(0);
    if (sub * S.zoom > 4) for (let t = Math.ceil(t0 / sub) * sub; t < t1; t += sub) {
      const y = G.ty(t), onBeat = Math.abs(t / beat - Math.round(t / beat)) < 1e-6;
      g.strokeStyle = line; g.globalAlpha = onBeat ? 0.7 : 0.25; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }
    g.globalAlpha = 1;
    if (mode() === 'lanes') {
      const lw = Math.min(90, w / 5), x0 = (w - lw * 4) / 2;
      for (let l = 0; l < 4; l++) {
        g.fillStyle = l % 2 ? css('--bg3') : css('--bg2'); g.fillRect(x0 + l * lw, 0, lw, hgt);
        g.fillStyle = dim; g.font = '12px Consolas'; g.textAlign = 'center'; g.fillText(LANE_KEYS[l], x0 + l * lw + lw / 2, hgt - 14);
      }
      g.textAlign = 'left';
      g.strokeStyle = accent; g.lineWidth = 3; g.beginPath(); g.moveTo(x0, G.strike); g.lineTo(x0 + lw * 4, G.strike); g.stroke();
      notes.forEach((n, i) => {
        const t = num(n.spawn_time_ms, 0), len = n.type === 'hold' ? num(n.hold_ms, 0) : 0;
        const y = G.ty(t), y2 = G.ty(t + len);
        if (y2 > hgt + 20 || y < -20) return;
        const lane = clamp(num(n.lane, 0), 0, 3), x = x0 + lane * lw + 6;
        g.fillStyle = NOTE_COLORS[n.type]; g.globalAlpha = 0.45;
        if (len) g.fillRect(x + lw * 0.25, y2, lw * 0.5 - 12, y - y2);
        g.globalAlpha = 1; roundRect(g, x, y - 7, lw - 12, 14, 4); g.fill();
        if (i === S.sel) { g.strokeStyle = '#fff'; g.lineWidth = 2; roundRect(g, x - 2, y - 9, lw - 8, 18, 5); g.stroke(); }
      });
      return;
    }
    // catch
    const bw = clamp(num(S.d.catch?.bar_width, 0.22), 0.01, 1), sp = num(S.d.catch?.bar_speed, 0.7) / 1000, dash = num(S.d.catch?.dash_multiplier, 2);
    const bx = 30, bwid = w - 60;
    g.strokeStyle = line; g.strokeRect(bx, 0, bwid, hgt);
    g.strokeStyle = accent; g.lineWidth = 3; g.beginPath(); g.moveTo(bx, G.strike); g.lineTo(bx + bwid, G.strike); g.stroke();
    // the bar, centred under the next rune at the playhead
    const next = notes.find(n => n.type === 'drop' && num(n.spawn_time_ms, 0) >= S.playhead - 1);
    const cx = next ? clamp(num(next.position?.x, 0.5), bw / 2, 1 - bw / 2) : 0.5;
    g.fillStyle = accent; g.globalAlpha = 0.3; g.fillRect(bx + (cx - bw / 2) * bwid, G.strike + 4, bw * bwid, 12); g.globalAlpha = 1;
    let prev = null;
    notes.forEach((n, i) => {
      const t = num(n.spawn_time_ms, 0), y = G.ty(t);
      const x = bx + clamp(num(n.position?.x, 0.5), 0, 1) * bwid;
      let col = NOTE_COLORS[n.type];
      if (n.type === 'drop') {
        if (prev) { // reachability from the previous rune with the bar's speed (the bar only has to cover the rune with its edge)
          const gap = Math.max(1, t - num(prev.spawn_time_ms, 0)), dx = Math.max(0, Math.abs(num(n.position?.x, .5) - num(prev.position?.x, .5)) - bw);
          if (dx > gap * sp * dash) col = '#ff5252'; else if (dx > gap * sp) col = '#ffb74d';
        }
        prev = n;
      }
      if (y < -20 || y > hgt + 20) return;
      g.fillStyle = col; g.beginPath(); const r = n.type === 'support' ? 5 : 8;
      g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fill();
      if (i === S.sel) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
    });
    g.fillStyle = dim; g.font = '11px Segoe UI'; g.fillText('Blue: reachable. Amber: needs a dash to reach. Red: can\'t be reached.', bx + 6, 14);
  }
  function ring(g, x, y, r, col, sel) {
    g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,.5)'; g.lineWidth = sel ? 3 : 1.5; g.stroke();
  }
  function roundRect(g, x, y, w, hh, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  // ------------------------------------------------------------------ board input
  function hitTest(px, py) {
    const { w, hgt } = { w: S.canvas.clientWidth, hgt: S.canvas.clientHeight };
    const notes = S.d.notes || [];
    let best = -1, bd = 14;
    notes.forEach((n, i) => {
      let x, y;
      if (mode() === 'standard') {
        const R = standardRect(w, hgt), t = num(n.spawn_time_ms, 0), ap = Math.max(1, num(S.d.approach_ms, 1000));
        if (t - S.playhead > ap * 2 || S.playhead - t > ap + num(n.slider_duration_ms, 0)) return;
        x = R.x + num(n.position?.x, .5) * R.s; y = R.y + num(n.position?.y, .5) * R.s;
      } else {
        const G = vgeom(w, hgt); y = G.ty(num(n.spawn_time_ms, 0));
        if (mode() === 'lanes') { const lw = Math.min(90, w / 5), x0 = (w - lw * 4) / 2; x = x0 + (num(n.lane, 0) + 0.5) * lw; if (Math.abs(px - x) < lw / 2 && Math.abs(py - y) < 10) { best = i; bd = 0; } return; }
        x = 30 + num(n.position?.x, .5) * (w - 60);
      }
      const dd = Math.hypot(px - x, py - y);
      if (dd < bd) { bd = dd; best = i; }
    });
    return best;
  }

  function bindBoard() {
    const c = S.canvas;
    let drag = null;
    const pos = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const norm = (px, py) => {
      const w = c.clientWidth, hgt = c.clientHeight;
      if (mode() === 'standard') { const R = standardRect(w, hgt); return { x: round3(clamp((px - R.x) / R.s, 0, 1)), y: round3(clamp((py - R.y) / R.s, 0, 1)) }; }
      const G = vgeom(w, hgt);
      if (mode() === 'lanes') { const lw = Math.min(90, w / 5), x0 = (w - lw * 4) / 2; return { lane: clamp(Math.floor((px - x0) / lw), 0, 3), t: snap(G.tAt(py)) }; }
      return { x: round3(clamp((px - 30) / (w - 60), 0, 1)), t: snap(G.tAt(py)) };
    };
    c.addEventListener('contextmenu', e => { e.preventDefault(); const i = hitTest(...pos(e)); if (i >= 0) { S.sel = i; deleteSelected(); } });
    c.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      c.focus();
      const [px, py] = pos(e);
      const i = hitTest(px, py);
      if (i >= 0) { S.sel = i; snapshot(); drag = { kind: 'move', note: S.d.notes[i], start: norm(px, py) }; refreshInspector(); draw(); return; }
      const p = norm(px, py);
      const t = mode() === 'standard' ? snap(S.playhead) : p.t;
      const note = { id: newId(), type: S.tool, spawn_time_ms: t, hit_window_ms: window_() };
      if (mode() === 'lanes') {
        note.lane = p.lane;
        if ((S.d.notes || []).some(n => n.lane === p.lane && t >= num(n.spawn_time_ms, 0) && t <= num(n.spawn_time_ms, 0) + num(n.hold_ms, 0))) return S.ctx.toast('That lane is busy then: a note may not start before the previous one in its lane ends.');
      } else if (mode() === 'catch') note.position = { x: p.x };
      else note.position = { x: p.x, y: p.y };
      if (S.tool === 'slider') { note.slider_end = { x: p.x, y: p.y }; note.slider_duration_ms = Math.round(60000 / ed().bpm); }
      if (S.tool === 'hold') note.hold_ms = Math.round(60000 / ed().bpm);
      snapshot();
      S.d.notes.push(note);
      tidy();
      S.sel = S.d.notes.indexOf(note);
      drag = S.tool === 'slider' || S.tool === 'hold' ? { kind: 'len', note } : null;
      edited(false);
    });
    window.addEventListener('mousemove', S.mm = e => {
      if (!drag || !S) return;
      const p = norm(...pos(e)), n = drag.note;
      if (drag.kind === 'len') {
        if (n.type === 'slider') { n.slider_end = { x: p.x, y: p.y }; }
        else n.hold_ms = Math.max(1, p.t - num(n.spawn_time_ms, 0));
      } else {
        if (mode() === 'standard') n.position = { x: p.x, y: p.y };
        else { n.spawn_time_ms = p.t; if (mode() === 'lanes') n.lane = p.lane; else n.position = { x: p.x }; }
      }
      tidy(); draw(); refreshInspector();
    });
    window.addEventListener('mouseup', S.mu = () => { if (drag && S) { drag = null; edited(false); } });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.ctrlKey && mode() !== 'standard') { S.zoom = clamp(S.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 0.02, 1); return draw(); }
      setPlayhead(S.playhead + (e.deltaY > 0 ? -1 : 1) * snapMs() * (e.shiftKey ? 4 : 1) * (mode() === 'standard' ? 1 : 2));
    }, { passive: false });
  }

  function deleteSelected() {
    if (S.sel < 0) return;
    snapshot(); S.d.notes.splice(S.sel, 1); S.sel = -1; edited(false);
  }
  function undo() { if (S.undo.length) { S.redo.push(JSON.stringify(S.d)); restore(S.undo.pop()); } }
  function redo() { if (S.redo.length) { S.undo.push(JSON.stringify(S.d)); restore(S.redo.pop()); } }

  function keydown(e) {
    if (!S || !document.body.contains(S.canvas)) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.getElementById('modal')?.style.display === 'flex') return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); togglePlay(); }
    else if (k === 'ArrowRight' || k === 'ArrowUp') { e.preventDefault(); setPlayhead(snap(S.playhead + snapMs() * (e.shiftKey ? 4 : 1))); }
    else if (k === 'ArrowLeft' || k === 'ArrowDown') { e.preventDefault(); setPlayhead(snap(S.playhead - snapMs() * (e.shiftKey ? 4 : 1))); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSelected(); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (/^[1-3]$/.test(k)) { const t = Object.keys(MODES[mode()].tools)[Number(k) - 1]; if (t) { S.tool = t; buildTools(); } }
  }

  // ------------------------------------------------------------------ timeline strip
  function mapEnd() {
    const last = Math.max(0, ...(S.d.notes || []).map(n => num(n.spawn_time_ms, 0) + num(n.slider_duration_ms, 0) + num(n.hold_ms, 0)));
    const song = S.audio && Number.isFinite(S.audio.duration) ? S.audio.duration * 1000 - num(S.d.music_offset_ms, 0) : 0;
    return Math.max(200, last + 40, song);
  }
  function drawTimeline() {
    const { g, w, hgt } = fit(S.tl);
    g.fillStyle = css('--bg'); g.fillRect(0, 0, w, hgt);
    const end = mapEnd(), X = t => (t / end) * w;
    if (S.peaks) { // waveform, aligned with the offset
      g.fillStyle = css('--line'); const off = num(S.d.music_offset_ms, 0), n = S.peaks.length;
      for (let i = 0; i < n; i++) { const t = (i / n) * S.peaks.dur * 1000 - off; const x = X(t); if (x < 0 || x > w) continue; const a = S.peaks[i] * (hgt - 8) / 2; g.fillRect(x, hgt / 2 - a, Math.max(1, w / n), a * 2); }
    }
    const ys = { primary: .3, drop: .3, tap: .3, slider: .5, hold: .5, support: .75 };
    (S.d.notes || []).forEach((n, i) => {
      const x = X(num(n.spawn_time_ms, 0)), len = num(n.slider_duration_ms, 0) + num(n.hold_ms, 0);
      const y = mode() === 'lanes' ? 6 + num(n.lane, 0) * (hgt - 12) / 4 : ys[n.type] * hgt - 4;
      const hh = mode() === 'lanes' ? (hgt - 12) / 4 - 2 : 8;
      g.fillStyle = NOTE_COLORS[n.type]; g.fillRect(x, y, Math.max(2, X(len)), hh);
      if (i === S.sel) { g.strokeStyle = '#fff'; g.strokeRect(x - 1, y - 1, Math.max(2, X(len)) + 2, hh + 2); }
    });
    g.fillStyle = css('--accent'); g.fillRect(X(S.playhead) - 1, 0, 2, hgt);
  }
  function bindTimeline() {
    let down = false;
    const seek = e => { const r = S.tl.getBoundingClientRect(); setPlayhead(snap(clamp((e.clientX - r.left) / r.width, 0, 1) * mapEnd())); };
    S.tl.addEventListener('mousedown', e => { down = true; seek(e); });
    window.addEventListener('mousemove', S.tm = e => { if (down && S) seek(e); });
    window.addEventListener('mouseup', S.tu = () => { down = false; });
    S.tl.title = 'Click or drag to move the playhead. Notes: top = strikes, middle = sliders/holds, bottom = support.';
  }

  // ------------------------------------------------------------------ playback + song
  function setPlayhead(t) { S.playhead = Math.max(0, t); if (S.audio && !S.playing) S.audio.currentTime = Math.max(0, (S.playhead + num(S.d.music_offset_ms, 0)) / 1000); draw(); }
  function togglePlay() { S.playing ? pause() : play(); }
  function play() {
    S.playing = true; S.playBtn.textContent = '❚❚';
    S.lastHit = S.playhead;
    if (S.audio) { S.audio.currentTime = Math.max(0, (S.playhead + num(S.d.music_offset_ms, 0)) / 1000); S.audio.play().catch(() => {}); }
    let last = performance.now();
    const step = now => {
      if (!S || !S.playing) return;
      if (S.audio && !S.audio.paused) S.playhead = S.audio.currentTime * 1000 - num(S.d.music_offset_ms, 0);
      else S.playhead += now - last;
      last = now;
      clickNotes();
      if (S.playhead > mapEnd()) { pause(); setPlayhead(0); return; }
      draw(); S.raf = requestAnimationFrame(step);
    };
    S.raf = requestAnimationFrame(step);
  }
  function pause() { if (!S) return; S.playing = false; cancelAnimationFrame(S.raf); S.audio?.pause(); if (S.playBtn) S.playBtn.textContent = '▶'; draw(); }
  // A short tick when the playhead passes a note, so timing can be judged by ear.
  function clickNotes() {
    const from = S.lastHit, to = S.playhead; S.lastHit = to;
    if (!(S.d.notes || []).some(n => { const t = num(n.spawn_time_ms, -1); return t > from && t <= to && n.type !== 'support'; })) return;
    try {
      const a = (clickNotes.ctx ??= new AudioContext()), o = a.createOscillator(), gn = a.createGain();
      o.frequency.value = 1400; gn.gain.setValueAtTime(0.15, a.currentTime); gn.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.05);
      o.connect(gn).connect(a.destination); o.start(); o.stop(a.currentTime + 0.06);
    } catch (e) { /* no audio output */ }
  }

  function attachSong() {
    const p = S.ctx.musicFileFor(S.d.music_track);
    S.songLabel.textContent = p ? p.split('/').pop() : (S.d.music_track ? `${S.d.music_track} (not in this pack)` : 'no song');
    S.songLabel.title = p ? `Playing ${p} from this pack` : 'Load a song to hear the map while editing.';
    if (!p) return;
    const bytes = S.ctx.files[p].raw;
    const blob = new Blob([bytes], { type: 'audio/ogg' });
    S.audioUrl = URL.createObjectURL(blob);
    S.audio = new Audio(S.audioUrl);
    S.audio.onloadedmetadata = () => draw();
    blob.arrayBuffer().then(buf => new (window.OfflineAudioContext || window.AudioContext)(1, 2, 44100).decodeAudioData(buf)).then(ab => {
      if (!S) return;
      const ch = ab.getChannelData(0), n = 1500, per = Math.floor(ch.length / n), peaks = new Float32Array(n);
      for (let i = 0; i < n; i++) { let m = 0; for (let j = i * per; j < (i + 1) * per; j += 8) m = Math.max(m, Math.abs(ch[j])); peaks[i] = m; }
      peaks.dur = ab.duration; S.peaks = peaks; draw();
    }).catch(() => {});
  }

  async function loadSong(file) {
    if (!/\.ogg$/i.test(file.name)) return S.ctx.toast('Minecraft only plays .ogg (Ogg Vorbis). Convert the song first, for example with Audacity.');
    const name = S.ctx.path.split('/').pop().replace('.json', '');
    const bytes = new Uint8Array(await file.arrayBuffer());
    S.ctx.addSong(name, bytes);
    snapshot();
    S.d.music_track = `${S.ctx.ns}:minigame/${name}`;
    let beat = '';
    if (typeof analyzeSong === 'function') { // mapgen.js: the beat grid follows the song's detected tempo
      try { ed().bpm = clamp(Math.round((await analyzeSong(bytes.slice().buffer)).bpm * 100) / 100, 30, 400); S.bpmIn.value = ed().bpm; beat = `, detected ${ed().bpm} BPM`; } catch (e) { /* undecodable: keep the BPM */ }
    }
    if (S.audioUrl) URL.revokeObjectURL(S.audioUrl);
    S.audio = null; S.peaks = null;
    edited(true); attachSong();
    S.ctx.toast(`Added ${file.name} as ${S.d.music_track}${beat}.`);
  }

  // ------------------------------------------------------------------ stats
  function stats() {
    const d = S.d, notes = d.notes || [];
    const judged = notes.filter(n => n.type !== 'support');
    const first = judged.length ? num(judged[0].spawn_time_ms, 0) : 0, last = judged.length ? num(judged[judged.length - 1].spawn_time_ms, 0) : 0;
    const secs = Math.max(0.05, (last - first) / 1000), nps = judged.length > 1 ? judged.length / secs : 0;
    const times = judged.map(n => n.spawn_time_ms), chords = times.filter((t, i) => i && t === times[i - 1]).length;
    const tier = clamp(num(d.tier, 0), 0, 4), ratio = nps / CURVE_NPS[tier];
    const like = DIFF.reduce((b, x) => Math.abs(x[1] - ratio) < Math.abs(b[1] - ratio) ? x : b);
    S.status.innerHTML = '';
    const item = (label, value, tip) => S.status.append(h('span', { title: tip }, h('span', { className: 'dim', textContent: label + ' ' }), h('b', { textContent: value })));
    item('Forge hits', d.total_hits, 'total_hits, counted for you from the notes');
    item('Notes', notes.length, 'All notes including support');
    item('Notes/s', nps.toFixed(2), 'Judged notes per second between the first and last note');
    item('Length', `${secs.toFixed(1)} s`, 'From the first to the last judged note');
    if (chords) item('Chords', chords, 'Notes at the same moment as another');
    if (nps) item('Plays like', `${like[0]} difficulty`, `Compared with the preset curve for tier ${tier} (${TIERS[tier]}): ${CURVE_NPS[tier]} notes/s at Expert difficulty`);
  }

  // Selects the note a problem points at (paths like notes[3].lane).
  function focusPath(path) {
    if (!S) return;
    const m = /^notes\[(\d+)\]/.exec(path || '');
    if (!m) return;
    S.sel = Number(m[1]);
    const n = S.d.notes?.[S.sel];
    if (n) setPlayhead(num(n.spawn_time_ms, 0) - (mode() === 'standard' ? 250 : 0));
    refreshInspector();
  }

  return { open, close, focusPath, fromTicks, isOpen: () => !!S };
})();
