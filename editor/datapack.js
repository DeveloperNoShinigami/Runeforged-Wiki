// Runeforged datapack schemas and checks, shared by the editor page and check-schemas.js.
// Every rule here mirrors the mod's loaders (AwakeningProfile, SchemaValidationService,
// RuneforgeItemTuning*, AbracadabraTargeting*). When a loader rule changes, change it here too.
// The game also checks ids against its registries (spells, effects, sounds...), which this page
// cannot see, so ids are only checked for shape.

const DATAPACK_FORMAT = 48;     // Minecraft 1.21.1
const RESOURCEPACK_FORMAT = 34; // Minecraft 1.21.1
const CONDITIONS_KEY = 'neoforge:conditions';

const SCHOOLS = ['fire', 'ice', 'lightning', 'holy', 'ender', 'blood', 'evocation', 'nature', 'eldritch']
  .map(s => 'irons_spellbooks:' + s).concat('iss_runeforged:runesmith');
const RUNES = ['fire', 'ice', 'lightning', 'holy', 'ender', 'blood', 'evocation', 'nature', 'blank']
  .map(s => `irons_spellbooks:${s}_rune`);
const BEHAVIORS = ['melee', 'projectile', 'spell_casting', 'shield', 'armor', 'curio'];
const EVENTS = ['on_activate', 'on_deactivate', 'on_hit', 'on_kill', 'on_cast', 'on_damage_taken', 'on_block'];
const TARGETS = ['self', 'target', 'attacker'];
const TARGETS_BY_EVENT = {
  on_activate: ['self'], on_deactivate: ['self'],
  on_hit: ['self', 'target', 'attacker'], on_kill: ['self', 'target', 'attacker'],
  on_cast: ['self', 'attacker'], on_damage_taken: ['self', 'attacker'], on_block: ['self', 'attacker'],
};
const LIVING_TARGET_TYPES = ['apply_effect', 'apply_knockback', 'bonus_school_damage', 'cast_spell', 'ignite', 'spell_bleed'];
// The optional `if` block every action may carry (AwakeningProfile.Action IF_SCHEMA).
const ACTION_IF = { t: 'object', desc: 'Run only when every listed check passes', fields: {
  target_has_effect: { t: 'id' }, target_lacks_effect: { t: 'id' }, target_burning: { t: 'bool' },
  target_in_tag: { t: 'id', desc: 'Entity type tag, such as minecraft:undead' }, target_not_in_tag: { t: 'id' },
  self_has_effect: { t: 'id' }, chance: { t: 'num', gt: 0, max: 1, desc: 'Fraction, 0.25 = 25%' },
} };
const SOUND_SOURCES = ['master', 'music', 'record', 'weather', 'block', 'hostile', 'neutral', 'player', 'ambient', 'voice'];
// The mod ships one awakening config per school and behavior at data/iss_runeforged/awakening_configs/<school>/<behavior>.json.
const BUNDLED_AWAKENING_SCHOOLS = ['fire', 'ice', 'lightning', 'holy', 'ender', 'blood', 'evocation', 'nature'];
const BUNDLED_AWAKENING_BEHAVIORS = ['melee', 'projectile', 'spell_casting', 'shield', 'armor'];
// Suggestions only: item tuning accepts any registered attribute, including other mods'.
const ATTRIBUTES = [
  ...['spell_power', 'max_mana', 'mana_regen', 'cooldown_reduction', 'cast_time_reduction', 'spell_resist', 'summon_damage', 'casting_movespeed']
    .map(a => 'irons_spellbooks:' + a),
  ...SCHOOLS.flatMap(s => [`irons_spellbooks:${s}_spell_power`, `irons_spellbooks:${s}_magic_resist`]),
  ...['max_health', 'attack_damage', 'attack_speed', 'attack_knockback', 'armor', 'armor_toughness', 'knockback_resistance', 'movement_speed', 'luck']
    .map(a => 'minecraft:generic.' + a),
  'minecraft:player.block_interaction_range', 'minecraft:player.entity_interaction_range',
];

// Schema notation: t = object | int | num | bool | str | id | enum | list | text | union | tagentry | json.
// req = required, min/max = inclusive, gt = must be greater than, notZero, values (enum), of (list item),
// minItems, unique, fields (object), variants (union, keyed by "type"), desc = tooltip, def = value for new.
const target = { t: 'enum', values: TARGETS, desc: 'Who the action hits. Defaults to target.' };
const SCHEMAS = {
  pack: {
    t: 'object', open: true, fields: {
      pack: {
        t: 'object', req: true, open: true, fields: {
          pack_format: { t: 'int', req: true, def: DATAPACK_FORMAT, desc: '48 for Minecraft 1.21.1' },
          description: { t: 'text', req: true, def: 'My Runeforged pack' },
        },
      },
    },
  },
  awakening: {
    t: 'object', conditions: true, fields: {
      school: { t: 'id', req: true, suggest: SCHOOLS, def: 'irons_spellbooks:fire', desc: 'Full school id, such as irons_spellbooks:fire' },
      behavior: { t: 'enum', req: true, values: BEHAVIORS, def: 'melee' },
      matching_rune: { t: 'id', req: true, suggest: RUNES, def: 'irons_spellbooks:fire_rune', desc: 'Rune item that pays for activation' },
      activation: {
        t: 'object', req: true, fields: {
          mana_cost: { t: 'int', req: true, min: 0, def: 50 },
          mana_cost_per_tick: { t: 'int', min: 0, desc: 'Default 0' },
          health_cost: { t: 'num', min: 0, desc: 'Default 0' },
          consume_offhand_rune: { t: 'bool', req: true, def: false },
          duration_ticks: { t: 'int', req: true, gt: 0, def: 240, desc: '20 ticks = 1 second' },
          cooldown_ticks: { t: 'int', req: true, min: 0, def: 320 },
        },
      },
      triggers: {
        t: 'list', req: true, minItems: 1, of: {
          t: 'object', fields: {
            event: { t: 'enum', req: true, values: EVENTS, def: 'on_hit' },
            actions: {
              t: 'list', req: true, minItems: 1, of: {
                t: 'union', def: 'apply_effect', variants: {
                  apply_effect: { effect: { t: 'id', req: true, def: 'minecraft:glowing' }, duration_ticks: { t: 'int', gt: 0 }, amplifier: { t: 'int', min: 0, max: 255 }, target },
                  bonus_school_damage: { amount: { t: 'num', gt: 0 }, additional_hits: { t: 'int', min: 1, max: 20 }, target },
                  apply_knockback: { strength: { t: 'num', min: 0 }, target },
                  particle_effect: { particle: { t: 'id', req: true, def: 'minecraft:flame', desc: 'Must be a simple particle (no extra options)' }, count: { t: 'int', min: 1, max: 1000 }, speed: { t: 'num', min: 0 }, target },
                  apply_attribute: { attribute: { t: 'id', req: true, def: 'irons_spellbooks:spell_power' }, amount: { t: 'num', req: true, notZero: true, def: 0.1 } },
                  mana_vampirism: { percent: { t: 'num', req: true, gt: 0, max: 1, def: 0.1, desc: 'Fraction, 0.25 = 25%' } },
                  play_sound: { sound: { t: 'id', req: true, def: 'minecraft:entity.blaze.shoot' }, volume: { t: 'num', gt: 0 }, pitch: { t: 'num', gt: 0, max: 2 }, sound_source: { t: 'enum', values: SOUND_SOURCES }, target },
                  run_command: { command: { t: 'str', req: true, def: 'say awakened' } },
                  run_function: { function: { t: 'id', req: true, def: 'my_pack:awaken' } },
                  cast_spell: { spell: { t: 'id', req: true, def: 'irons_spellbooks:firebolt' }, spell_level: { t: 'int', min: 1 }, target },
                  spell_vamp: { percent: { t: 'num', req: true, gt: 0, max: 1, def: 0.15, desc: 'Heals this fraction of the damage dealt' } },
                  ignite: { seconds: { t: 'num', req: true, gt: 0, max: 600, def: 4 }, target },
                  spell_bleed: { percent_max_hp: { t: 'num', req: true, gt: 0, max: 1, def: 0.02, desc: 'Fraction of max health per second per stack' }, seconds: { t: 'num', req: true, gt: 0, max: 600, def: 5 }, max_stacks: { t: 'int', min: 1, max: 100 }, max_damage_per_tick: { t: 'num', gt: 0, desc: 'Cap per second; omit for no cap' }, target },
                },
              },
            },
          },
        },
      },
      conditions: {
        t: 'object', fields: {
          required_item_tags: { t: 'list', of: { t: 'id' }, desc: 'The forged item must be in every tag listed' },
        },
      },
      display: {
        t: 'object', req: true, fields: {
          title: { t: 'text', req: true, def: 'My Awakening' },
          description_active: { t: 'text', req: true, def: 'What happens while awakened.' },
          description_inactive: { t: 'text', req: true, def: 'Press the awakening key to awaken.' },
          icon: { t: 'id', desc: 'Texture path, such as iss_runeforged:textures/gui/fire/fire_awakening.png' },
        },
      },
    },
  },
  tuning: {
    t: 'object', conditions: true, fields: {
      items: { t: 'list', req: true, minItems: 1, unique: true, of: { t: 'id', tagOk: true }, desc: 'Item ids or #item_tags', def: ['minecraft:iron_sword'] },
      supported_attributes: { t: 'list', req: true, minItems: 1, unique: true, of: { t: 'id', suggest: ATTRIBUTES }, def: ['irons_spellbooks:spell_power'], desc: 'The only manuscript attributes these items accept' },
    },
  },
  abracadabra: {
    t: 'object', conditions: true, fields: {
      replace: { t: 'bool', desc: 'true drops every rule loaded from lower packs' },
      spells: {
        t: 'list', of: {
          t: 'object', fields: {
            spell: { t: 'id', req: true, def: 'irons_spellbooks:heal' },
            target: { t: 'enum', req: true, values: ['self', 'attacker'], def: 'self' },
          },
        },
      },
    },
  },
  tag: {
    t: 'object', conditions: true, fields: {
      replace: { t: 'bool' },
      values: { t: 'list', req: true, of: { t: 'tagentry' }, def: [] },
    },
  },
};

const ID_RE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

// Which editor a pack path opens in. Returns null for files the editor only keeps.
function kindOf(path) {
  if (path === 'pack.mcmeta') return 'pack';
  let m = path.match(/^data\/([a-z0-9_.-]+)\/(.+)\.json$/);
  if (!m) return null;
  const [, ns, rest] = m;
  if (rest.startsWith('forgemaps/')) return 'forgemap';
  if (rest.startsWith('awakening_configs/')) return 'awakening';
  if (rest.startsWith('runeforge_item_tuning/')) return 'tuning';
  if (ns === 'iss_runeforged' && rest === 'abracadabra_spells') return 'abracadabra';
  if (rest.startsWith('tags/item/')) return 'tag';
  return null;
}

function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

// Returns [{path, msg}] for one value against one schema node.
function validate(s, v, path, out) {
  const err = msg => out.push({ path, msg });
  switch (s.t) {
    case 'object': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return err('must be an object');
      for (const [k, f] of Object.entries(s.fields)) {
        if (v[k] === undefined || v[k] === '') { if (f.req) out.push({ path: join(path, k), msg: 'is required' }); continue; }
        validate(f, v[k], join(path, k), out);
      }
      if (!s.open) for (const k of Object.keys(v)) {
        if (!(k in s.fields) && !(s.conditions && k === CONDITIONS_KEY)) out.push({ path: join(path, k), msg: `unknown field (allowed: ${Object.keys(s.fields).join(', ')})` });
      }
      if (s.conditions && v[CONDITIONS_KEY] !== undefined && !Array.isArray(v[CONDITIONS_KEY])) out.push({ path: join(path, CONDITIONS_KEY), msg: 'must be a list of conditions' });
      return;
    }
    case 'union': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return err('must be an object');
      const fields = s.variants[v.type];
      if (!fields) return out.push({ path: join(path, 'type'), msg: `unknown action type '${v.type}' (allowed: ${Object.keys(s.variants).join(', ')})` });
      return validate({ t: 'object', fields: { type: { t: 'str' }, if: ACTION_IF, ...fields } }, v, path, out);
    }
    case 'list': {
      if (!Array.isArray(v)) return err('must be a list');
      if (s.minItems && v.length < s.minItems) err(`needs at least ${s.minItems} entr${s.minItems > 1 ? 'ies' : 'y'}`);
      v.forEach((x, i) => validate(s.of, x, `${path}[${i}]`, out));
      if (s.unique) v.forEach((x, i) => { if (v.indexOf(x) !== i) out.push({ path: `${path}[${i}]`, msg: `lists ${x} twice` }); });
      return;
    }
    case 'int': case 'num': {
      if (!isNum(v)) return err(s.t === 'int' ? 'must be a whole number' : 'must be a number');
      if (s.t === 'int' && !Number.isInteger(v)) return err('must be a whole number');
      if (s.min !== undefined && v < s.min) err(`must be ${s.min} or more`);
      if (s.gt !== undefined && v <= s.gt) err(`must be more than ${s.gt}`);
      if (s.max !== undefined && v > s.max) err(`must be at most ${s.max}`);
      if (s.notZero && v === 0) err('must not be 0');
      return;
    }
    case 'bool': if (typeof v !== 'boolean') err('must be true or false'); return;
    case 'str': if (typeof v !== 'string' || !v.trim()) err('must be non-empty text'); return;
    case 'enum': if (!s.values.includes(v)) err(`must be one of ${s.values.join(', ')}`); return;
    case 'id': {
      const id = typeof v === 'string' && s.tagOk && v.startsWith('#') ? v.slice(1) : v;
      if (typeof id !== 'string' || !ID_RE.test(id)) err(`must be an id like namespace:path${s.tagOk ? ' (or #namespace:tag)' : ''}`);
      return;
    }
    case 'text': {
      if (typeof v === 'string') { if (!v.trim()) err('must not be blank'); return; }
      if (!v || typeof v !== 'object') err('must be text or a text component');
      return;
    }
    case 'tagentry': {
      if (typeof v === 'string') return validate({ t: 'id', tagOk: true }, v, path, out);
      return validate({ t: 'object', fields: { id: { t: 'id', req: true, tagOk: true }, required: { t: 'bool' } } }, v, path, out);
    }
  }
}

function join(path, k) { return path ? `${path}.${k}` : k; }

// Rules that span fields (SchemaValidationService.validateAction).
function extraChecks(kind, v, out) {
  if (kind === 'awakening' && v && Array.isArray(v.triggers)) {
    v.triggers.forEach((t, ti) => {
      const reach = t && TARGETS_BY_EVENT[t.event];
      (t && Array.isArray(t.actions) ? t.actions : []).forEach((a, ai) => {
        if (!a) return;
        const path = `triggers[${ti}].actions[${ai}]`;
        const tgt = a.target ?? 'target';
        if (reach && LIVING_TARGET_TYPES.includes(a.type) && !reach.includes(tgt)) {
          out.push({ path: join(path, 'target'), msg: `'${tgt}' never exists on ${t.event}; use ${reach.join(', ')}${a.target === undefined ? " (target defaults to 'target')" : ''}` });
        }
        if (a.type === 'apply_attribute' && t.event !== 'on_activate') {
          out.push({ path, msg: 'apply_attribute only works on on_activate (it is removed on deactivate)' });
        }
      });
    });
  }
  if (kind === 'abracadabra' && v && Array.isArray(v.spells)) {
    const seen = new Set();
    v.spells.forEach((r, i) => { if (r && seen.has(r.spell)) out.push({ path: `spells[${i}].spell`, msg: `${r.spell} is listed more than once in this file` }); if (r) seen.add(r.spell); });
  }
}

// Forgemap rules: ForgemapSchemaValidator + the forgemap codecs. Registered schools are only checked for shape.
const FORGEMAP_MODES = ['standard', 'catch', 'lanes'];
const LANE_COUNT = 4;
const TIER_NAMES = ['Novice', 'Adept', 'Expert', 'Master', 'Grandmaster']; // tooltip.iss_runeforged.runic_hammer.tier.N
const FM_KEYS = {
  root: ['tier', 'school', 'name', 'total_hits', 'notes', 'approach_ms', 'music_track', 'music_offset_ms', 'scoring_config', 'weight', 'mode', 'catch'],
  scoring_config: ['perfect', 'good', 'miss', 'support_hit', 'support_miss', 'speed', 'scale', 'accuracy', 'quality_thresholds'],
  speed: ['approach_multiplier', 'response_window_ms', 'weight'],
  scale: ['action_radius_multiplier', 'support_radius_multiplier', 'weight'],
  accuracy: ['perfect_window_ms', 'good_window_ms', 'weight'],
  quality_thresholds: ['uncommon', 'rare', 'epic', 'legendary', 'myth'],
  catch: ['bar_width', 'bar_speed', 'dash_multiplier'],
  note: ['id', 'type', 'spawn_time_ms', 'hit_window_ms', 'position', 'slider_end', 'slider_duration_ms', 'slider_path_points', 'lane', 'hold_ms'],
  position: ['x', 'y'],
};

// Returns [{path, msg, warn}] for one parsed forgemap file.
function checkForgemap(fm) {
  const out = [];
  const add = (path, msg) => out.push({ path, msg, warn: false });
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(fm)) return [{ path: '', msg: 'must be an object', warn: false }];
  const keys = (v, set, path) => { if (isObj(v)) for (const k of Object.keys(v)) if (!set.includes(k) && k !== CONDITIONS_KEY) add(path ? `${path}.${k}` : k, `has unknown field '${k}' (allowed: ${set.join(', ')})`); };
  const sub = (v, k) => isObj(v) ? v[k] : undefined;

  // unknown keys (ForgemapSchemaValidator.checkKeys)
  keys(fm, FM_KEYS.root, '');
  const sc = fm.scoring_config;
  keys(sc, FM_KEYS.scoring_config, 'scoring_config');
  for (const k of ['speed', 'scale', 'accuracy', 'quality_thresholds']) keys(sub(sc, k), FM_KEYS[k], 'scoring_config.' + k);
  keys(fm.catch, FM_KEYS.catch, 'catch');
  const notes = Array.isArray(fm.notes) ? fm.notes : [];
  const lanesMode = typeof fm.mode === 'string' && fm.mode.toLowerCase() === 'lanes';
  notes.forEach((n, i) => {
    const p = `notes[${i}]`;
    keys(n, FM_KEYS.note, p);
    if (!lanesMode && isObj(n) && n.position === undefined) add(p, "is missing required field 'position'");
    keys(sub(n, 'position'), FM_KEYS.position, p + '.position');
    keys(sub(n, 'slider_end'), FM_KEYS.position, p + '.slider_end');
    const pts = sub(n, 'slider_path_points');
    if (Array.isArray(pts)) pts.forEach((q, j) => keys(q, FM_KEYS.position, `${p}.slider_path_points[${j}]`));
  });

  // codec: types, required fields, ranges. Any failure rejects the file, so stop before the semantic rules.
  const codec = [];
  const bad = (path, msg) => codec.push({ path, msg, warn: false });
  const typed = (o, k, path, kind, req, lo, hi) => {
    const v = o[k], p = path ? `${path}.${k}` : k;
    if (v === undefined) { if (req) bad(p, 'is required'); return; }
    if (kind === 'str') { if (typeof v !== 'string') bad(p, 'must be text'); return; }
    if (!isNum(v) || (kind === 'int' && !Number.isInteger(v))) return bad(p, kind === 'int' ? 'must be a whole number' : 'must be a number');
    if (lo !== undefined && (v < lo || v > hi)) bad(p, `Value ${v} outside of range [${lo}:${hi}]`);
  };
  const fields = (o, path, spec) => { if (!isObj(o)) return bad(path, 'must be an object'); for (const [k, kind, req, lo, hi] of spec) typed(o, k, path, kind, req, lo, hi); return true; };
  const pos = (v, path) => fields(v, path, [['x', 'num', true], ['y', 'num']]);
  fields(fm, '', [['tier', 'int', true], ['school', 'str', true], ['name', 'str', true], ['total_hits', 'int', true], ['approach_ms', 'int', true],
    ['music_track', 'str'], ['music_offset_ms', 'int'], ['weight', 'int'], ['mode', 'str']]);
  if (!Array.isArray(fm.notes)) bad('notes', fm.notes === undefined ? 'is required' : 'must be a list');
  if (fm.catch !== undefined) fields(fm.catch, 'catch', [['bar_width', 'num', false, 0.05, 0.9], ['bar_speed', 'num', false, 0.1, 4], ['dash_multiplier', 'num', false, 1, 4]]);
  if (sc === undefined) bad('scoring_config', 'is required');
  else if (fields(sc, 'scoring_config', [['perfect', 'int', true], ['good', 'int', true], ['miss', 'int', true], ['support_hit', 'int', true], ['support_miss', 'num', true]])) {
    const sect = (k, spec) => sub(sc, k) === undefined ? bad('scoring_config.' + k, 'is required') : fields(sc[k], 'scoring_config.' + k, spec);
    sect('speed', [['approach_multiplier', 'num', true, 0.1, 4], ['response_window_ms', 'int', true, 1, 5000], ['weight', 'num', true, 0, 1]]);
    sect('scale', [['action_radius_multiplier', 'num', true, 0.25, 2], ['support_radius_multiplier', 'num', true, 0.25, 2], ['weight', 'num', true, 0, 1]]);
    sect('accuracy', [['perfect_window_ms', 'int', true, 1, 5000], ['good_window_ms', 'int', true, 1, 5000], ['weight', 'num', true, 0, 1]]);
    sect('quality_thresholds', FM_KEYS.quality_thresholds.map(k => [k, 'int', true, 0, 100]));
  }
  notes.forEach((n, i) => {
    const p = `notes[${i}]`;
    if (!fields(n, p, [['id', 'str', true], ['type', 'str', true], ['spawn_time_ms', 'int', true], ['hit_window_ms', 'int', true], ['slider_duration_ms', 'int'], ['lane', 'int'], ['hold_ms', 'int']])) return;
    if (n.position !== undefined) pos(n.position, p + '.position');
    if (n.slider_end !== undefined) pos(n.slider_end, p + '.slider_end');
    if (n.slider_path_points !== undefined) {
      if (!Array.isArray(n.slider_path_points)) bad(p + '.slider_path_points', 'must be a list');
      else n.slider_path_points.forEach((q, j) => pos(q, `${p}.slider_path_points[${j}]`));
    }
  });
  if (codec.length) return out.concat(codec);

  // ForgemapSchemaValidator.validate
  const mode = fm.mode ?? 'standard', lower = mode.toLowerCase();
  const isCatch = lower === 'catch', isLanes = lower === 'lanes';
  const is = (n, t) => n.type.toLowerCase() === t;
  const lane = n => n.lane ?? -1, hold = n => n.hold_ms ?? 0, dur = n => n.slider_duration_ms ?? 0;
  const yOf = q => q.y ?? 0.5;
  const count = t => notes.filter(n => is(n, t)).length;
  const hits = isCatch ? count('drop') : isLanes ? count('tap') + 2 * count('hold') : count('primary') + 2 * count('slider');
  if (fm.tier < 0 || fm.tier > 4) add('tier', `must be in range [0, 4], got ${fm.tier}`);
  const schoolMsg = `must be 'none' or a registered Iron's Spells school such as irons_spellbooks:fire, got '${fm.school}'`;
  if (!fm.school.trim() || (fm.school.includes(':') && !ID_RE.test(fm.school))) add('school', schoolMsg);
  const weight = fm.weight ?? 1;
  if (weight < 1 || weight > 1000) add('weight', `must be in range [1, 1000], got ${weight}`);
  if (!fm.name.trim()) add('name', 'must not be blank');
  if (fm.total_hits !== hits) add('total_hits', `(${fm.total_hits}) must equal ${isCatch ? 'count of drop notes' : isLanes ? 'count of tap notes + (2 x hold notes)' : 'count of primary notes + (2 x slider notes)'} = ${hits}`);
  if (mode !== 'standard' && !isCatch && !isLanes) add('mode', `must be standard, catch, or lanes, got '${mode}'`);
  if (fm.approach_ms <= 0) add('approach_ms', `must be positive, got ${fm.approach_ms}`);
  const track = fm.music_track;
  if (track && track.trim() && !/^([a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(track)) add('music_track', `must be blank or a valid namespaced asset path like iss_runeforged:minigame/tetsu_uchi_uta, got '${track}'`);
  if ((fm.music_offset_ms ?? 0) < 0) add('music_offset_ms', `must be >= 0, got ${fm.music_offset_ms}`);
  if (!notes.length) add('notes', 'array must not be empty');
  else if (hits === 0) add('notes', 'at least one judged note (primary/slider, drop, or tap/hold) is required');

  let last = -1;
  const ids = new Set();
  notes.forEach((n, i) => {
    const p = `notes[${i}]`;
    if (!n.id.trim()) add(p + '.id', 'must not be blank');
    else if (ids.has(n.id)) add(p + '.id', `'${n.id}' is used by an earlier note; note ids must be unique`);
    ids.add(n.id);
    if (n.spawn_time_ms < 0) add(p + '.spawn_time_ms', `must be >= 0, got ${n.spawn_time_ms}`);
    if (n.spawn_time_ms < last) add(p + '.spawn_time_ms', `(${n.spawn_time_ms}) must be greater than or equal to previous note (${last})`);
    last = n.spawn_time_ms;
    if (n.hit_window_ms <= 0) add(p + '.hit_window_ms', `must be positive, got ${n.hit_window_ms}`);
    if (isCatch) { if (!is(n, 'drop') && !is(n, 'support')) add(p + '.type', `must be drop or support in catch mode, got '${n.type}'`); }
    else if (isLanes) {
      if (!is(n, 'tap') && !is(n, 'hold')) add(p + '.type', `must be tap or hold in lanes mode, got '${n.type}'`);
      if (lane(n) < 0 || lane(n) >= LANE_COUNT) add(p + '.lane', `must be in range [0, ${LANE_COUNT - 1}] in lanes mode, got ${lane(n)}`);
    } else if (!['primary', 'support', 'slider'].some(t => is(n, t))) add(p + '.type', `must be primary, support, or slider, got '${n.type}'`);
    if (!isLanes && lane(n) !== -1) add(p + '.lane', 'is only used in lanes mode');
    if (is(n, 'hold') ? hold(n) <= 0 : hold(n) !== 0) add(p + '.hold_ms', `must be > 0 on hold notes and absent otherwise, got ${hold(n)}`);
  });
  if (isLanes) {
    const free = Array(LANE_COUNT).fill(-1);
    notes.forEach((n, i) => {
      if (lane(n) < 0 || lane(n) >= LANE_COUNT) return;
      if (n.spawn_time_ms <= free[lane(n)]) add(`notes[${i}]`, `overlaps the previous note in lane ${lane(n)}`);
      free[lane(n)] = n.spawn_time_ms + hold(n);
    });
  }
  const outside = q => q.x < 0 || q.x > 1 || yOf(q) < 0 || yOf(q) > 1;
  notes.forEach((n, i) => {
    const p = `notes[${i}]`, at = n.position ?? { x: 0.5 };
    if (at.x < 0 || at.x > 1) add(p + '.position.x', `must be in range [0.0, 1.0], got ${at.x}`);
    if (yOf(at) < 0 || yOf(at) > 1) add(p + '.position.y', `must be in range [0.0, 1.0], got ${yOf(at)}`);
    const slider = is(n, 'slider');
    if (!slider && (n.slider_end !== undefined || n.slider_path_points !== undefined || dur(n) !== 0)) add(p, `has slider fields but type is '${n.type}'`);
    if (!slider) return;
    if (n.slider_end === undefined) add(p, "is a slider but missing required field 'slider_end'");
    else {
      const e = n.slider_end;
      if (e.x < 0 || e.x > 1) add(p + '.slider_end.x', `must be in range [0.0, 1.0], got ${e.x}`);
      if (yOf(e) < 0 || yOf(e) > 1) add(p + '.slider_end.y', `must be in range [0.0, 1.0], got ${yOf(e)}`);
    }
    const pts = n.slider_path_points;
    if (pts) {
      if (pts.length > 256) add(p + '.slider_path_points', `must have at most 256 points, got ${pts.length}`);
      pts.forEach((q, j) => { if (outside(q)) add(`${p}.slider_path_points[${j}]`, 'must have x and y in range [0.0, 1.0]'); });
    }
    if (dur(n) <= 0) add(p + '.slider_duration_ms', `must be > 0 for slider notes, got ${dur(n)}`);
  });
  const w = sc.speed.weight + sc.scale.weight + sc.accuracy.weight;
  if (Math.abs(w - 1) > 0.001) add('scoring_config', `weights must sum to 1.0, got ${w}`);
  if (sc.accuracy.perfect_window_ms > sc.accuracy.good_window_ms) add('scoring_config.accuracy.perfect_window_ms', 'must be <= good_window_ms');
  const t = sc.quality_thresholds;
  if (t.uncommon > t.rare || t.rare > t.epic || t.epic > t.legendary || t.legendary > t.myth) add('scoring_config.quality_thresholds', 'must be ascending from uncommon through myth');
  return out;
}

// Checks every file. files: { path: { kind, data, parseError } }. Returns [{file, path, msg, warn}].
function checkPack(files) {
  const problems = [];
  const add = (file, list, warn) => list.forEach(p => problems.push({ file, path: p.path, msg: p.msg, warn: !!warn }));
  if (!files['pack.mcmeta']) problems.push({ file: 'pack.mcmeta', path: '', msg: 'the pack needs a pack.mcmeta', warn: false });
  const awakeningOwners = {};
  const tunedItems = {};
  for (const [file, f] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!f.kind) continue;
    if (f.parseError) { problems.push({ file, path: '', msg: 'not valid JSON: ' + f.parseError, warn: false }); continue; }
    if (f.kind === 'forgemap') { add(file, checkForgemap(f.data)); continue; }
    const out = [];
    validate(SCHEMAS[f.kind], f.data, '', out);
    extraChecks(f.kind, f.data, out);
    add(file, out);
    const d = f.data || {};
    if (f.kind === 'awakening' && d.school && d.behavior) {
      const key = `${d.school} ${d.behavior}`;
      if (awakeningOwners[key]) problems.push({ file, path: 'behavior', msg: `${awakeningOwners[key]} already covers ${key}; only one file per school and behavior loads`, warn: false });
      else awakeningOwners[key] = file;
      const m = d.school.match(/^irons_spellbooks:(\w+)$/);
      const own = `data/iss_runeforged/awakening_configs/${m && m[1]}/${d.behavior}.json`;
      if (m && BUNDLED_AWAKENING_SCHOOLS.includes(m[1]) && BUNDLED_AWAKENING_BEHAVIORS.includes(d.behavior) && file !== own) {
        problems.push({ file, path: 'school', msg: `the mod already ships ${key}, and only one file per school and behaviour loads. Click here to move this file to ${own} so it replaces the built-in one`, warn: false, moveTo: own });
      }
    }
    if (f.kind === 'tuning' && Array.isArray(d.items)) {
      for (const item of d.items) {
        if (typeof item !== 'string' || item.startsWith('#')) continue;
        if (tunedItems[item]) problems.push({ file, path: 'items', msg: `${item} is already tuned in ${tunedItems[item]}; an item can be in only one tuning file`, warn: false });
        else tunedItems[item] = file;
      }
    }
  }
  return problems;
}

// A new value for a schema node, from its defaults.
function blank(s) {
  if (s.def !== undefined && s.t !== 'union') return structuredClone(s.def);
  if (s.t === 'object') {
    const o = {};
    for (const [k, f] of Object.entries(s.fields)) if (f.req) o[k] = blank(f);
    return o;
  }
  if (s.t === 'union') return blankAction(s, s.def);
  if (s.t === 'list') return s.minItems ? [blank(s.of)] : [];
  if (s.t === 'bool') return false;
  if (s.t === 'enum') return s.values[0];
  if (s.t === 'tagentry') return 'minecraft:iron_sword';
  return '';
}

function blankAction(s, type) {
  const o = { type };
  for (const [k, f] of Object.entries(s.variants[type])) if (f.req) o[k] = blank(f);
  return o;
}

if (typeof module !== 'undefined') {
  module.exports = { SCHEMAS, kindOf, validate, extraChecks, checkPack, checkForgemap, FORGEMAP_MODES, LANE_COUNT, TIER_NAMES, blank, blankAction, DATAPACK_FORMAT, RESOURCEPACK_FORMAT, CONDITIONS_KEY };
}
