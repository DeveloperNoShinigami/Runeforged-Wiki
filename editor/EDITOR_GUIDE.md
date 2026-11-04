# Runeforge Editor Guide

## Pack editor (index.html)

[index.html](index.html) edits a whole Runeforged datapack:

- **New pack** asks for a name, namespace and Minecraft version, then **Start from**:
  - **Blank**: empty folders (optionally a music folder and the Abracadabra file).
  - **Elemental lineup**: the 8 Iron's Spells schools the Starter Pack covers. It copies the Starter Pack's awakening configs for every school and behaviour, at the same paths, so they replace the Starter Pack's. It also copies the forging tags and adds ssets/<ns>/sounds.json. A second window picks the forgemap **difficulty** (Novice, Adept, Expert, Master, Grandmaster, God of Runesmithing; it only changes the maps) and either **From my songs** (drop .ogg files; each school gets one map per tier for each of the three minigames, built on the song's beats) or **Empty** (folders only). Songs can be reused across every slot, or used once each. The configs and tags come from `preset-data.js`; run `node editor/build-preset-data.js` after changing them in `packs/runeforged_starter_data/`.
- The mod itself ships no content. Awakening configs, forgemaps, forging tags, item tuning, Abracadabra spells and songs come from packs. The **Runeforged Starter Pack** (`packs/runeforged_starter_data` and `packs/runeforged_starter_resources`) is the foundation set; dev runs load it automatically. An awakening config in any other namespace replaces the Starter Pack's one for the same school and behaviour, whatever its path.
- **Ids from your game:** in game (op or cheats on), run `/runeforged dump`. It writes `runeforged/editor_dump.zip` in the game folder (click the path in chat to open the folder). The zip holds plain text lists of every item, item tag, spell, school, attribute, effect, sound, simple particle, enchantment and function in that modpack. Items are sorted the way the anvil forges them (melee, projectile, spell casting, shield, armor with its slot, curio, other); "detected" items look like that type but are not in a runeforgeable tag yet. Import the zip in the editor: a summary shows each group's **forgeable** and **can be made forgeable** counts (armour split into helmet, chestplate, leggings and boots). Item fields then offer only gear (armour, weapons, bows and guns, shields, curios), forgeable items first, plus item tags; food, blocks, ores and other items are left out. Spell, attribute, school, effect, sound, particle and function fields offer their own lists. The lists are kept in this browser until you import a new dump; typed ids that aren't listed still work.
- **Import** (or drop a file on the page): a datapack zip opens, or merges into the open pack (files at the same path are replaced). Any other file is added to the selected folder. Old two-folder exports from the forgemap page work too.
- The tree shows two packs. The data pack holds `pack.mcmeta` and `data/`. Below it, the resource pack holds `assets/` (songs, sounds, textures, lang) and gets its own `pack.mcmeta` on export. **Add a resource pack** (below the tree, or right-click the data pack) creates one. A label next to each folder names its type.
- Right-click a folder or file for New file, New folder, Import files here, Rename, Cut, Copy, Paste, Duplicate and Delete. Drag files and folders to move them. A file's type follows its folder, so moving it changes which editor opens.
- Each type opens its own editor:
  - Awakening configs, item tuning, Abracadabra spells and item tags open as forms, with a **Raw JSON** toggle.
  - Item tuning asks whether the file tunes **one item** or **a group** (several items and/or `#tags`). Both are the same file format; a single item is a one-entry `items` list. Attribute fields suggest Iron's Spells and vanilla attributes, but any registered attribute works.
  - Forgemaps open the built-in forgemap editor ([forgemap-editor.js](forgemap-editor.js)), which covers all three modes: Rune Forging (`standard`), Catch the Rune (`catch`) and Runic Lanes (`lanes`). Click to place, drag to move or to set a slider's or hold's length, and right-click or press Delete to remove. The mouse wheel scrubs; Ctrl+wheel zooms the vertical charts. Space plays, and Ctrl+Z / Ctrl+Y undo and redo. **Song** loads an `.ogg` into `assets/` (with its `sounds.json` entry and the map's music track), draws its waveform on the timeline and sets BPM from the song's detected beats. BPM and snap set the beat grid; they are kept in the editor only and are not exported. In Catch the Rune, drops are blue when reachable, amber when they need a dash and red when they can't be reached.
  - Other text files (`.mcfunction`, `.json`, ...) open as plain text. Binary files go into the export unchanged.
- Panels resize by dragging their edges and fold by double-clicking the edge. Hover any field or button for a tooltip.
- Problems show live on the right; click one to jump to the field or note. **Export** stays locked while any red one is left. Empty folders are not exported.
- The pack is saved in this browser as you work and comes back when you reopen the page.
- **Export** offers two outputs:
  - **Data pack + resource pack:** `<ns>_data.zip` for the world's `datapacks` folder, and `<ns>_resources.zip` for `resourcepacks` (only when the pack has a resource pack).
  - **Mod jar:** one plug-and-play jar holding both packs. It asks for a mod id, name, version, author, description and license. Drop it in `mods` next to Runeforged; it loads in every world with no `/reload`. Import reads the jar back.

The rules live in [datapack.js](datapack.js) and mirror the mod's loaders. Change them together with the loaders. `node editor/check-schemas.js` checks that every bundled data file passes and that known-bad files fail. The game also checks ids against its registries, which the page cannot see.

[examples/ice_tier1_example.json](examples/ice_tier1_example.json) is a map made by the editor's generator ([mapgen.js](mapgen.js)). The GameTest `editorExampleMapLoads` installs it as a world datapack, reloads, and checks that the game loads it and picks it for tier 1 ice.


## Forgemap page (forgemap.html)

The older standalone page. The pack editor no longer uses it; it still has Import .osz. The rest of this guide documents [forgemap.html](forgemap.html).

## Core Contract

- Timing unit is milliseconds (`_ms` fields). The mod rejects the old `_ticks` keys.
- `spawn_time_ms` is the absolute time in milliseconds when the note is hit.
- Notes use normalized positions in `0.0..1.0`.
- `total_hits = primary notes + 2 * slider notes`.
- Support notes do not count toward `total_hits`.
- A typed `0` stays `0`. Only an empty or non-numeric field falls back to the default.

## Runtime Fields

The editor exports:

- `tier` (0 to 4, the hammer mastery tier)
- `school` (`none`, or a full school id such as `irons_spellbooks:fire`)
- `weight` (1 to 1000, default 1)
- `name`
- `total_hits`
- `notes`
- `approach_ms`
- `music_track`
- `music_offset_ms`
- `scoring_config`

When several maps share a tier and school, the game picks one at random, weighted by `weight`.

## Getting A Map Into The Game

Use **Export pack (.zip)**. It asks for a namespace and a map file name, then downloads one zip
with:

- `<name>_data`, a datapack (`pack_format` 48) holding `data/<namespace>/forgemaps/<file>.json`.
- `<name>_music`, a resource pack (`pack_format` 34), only when you loaded an `.ogg` with
  Load Audio. It holds `assets/<namespace>/sounds.json` and the song, and the exported map's
  `music_track` is set to `<namespace>:minigame/<file>` to match.
- A short README with where each folder goes.

Single player: put the datapack folder in `saves/<world>/datapacks` and run `/reload`. Put the
resource pack in `resourcepacks` and turn it on.

Server: the datapack goes in the server's `world/datapacks` folder (the server admin does
this). Every player who should hear the song needs the resource pack, or the server can send it
as its server resource pack. A player without it plays the map in silence.

To replace a Starter Pack map, export with namespace `iss_runeforged` and the Starter Pack's file
name, such as `baseline_tier2`, in a pack loaded above it.

**Export JSON** still gives the bare forgemap file, for packs you build by hand.

## Preview And Music

- Preview uses millisecond time.
- `approach_ms` is the base approach duration in milliseconds; `scoring_config.speed.approach_multiplier` adjusts it for the exported map.
- `Load Audio` plays a local file in the editor preview. Minecraft only plays Ogg Vorbis, so
  only an `.ogg` file goes into the exported resource pack.
- Runtime music uses `music_track`, a sound event id such as `iss_runeforged:minigame/tetsu_uchi_uta`.
  The sound must exist on the player's client (in the mod or in a resource pack).
- `music_offset_ms` shifts music alignment and does not affect server scoring.

## Slider Placement

- First click places the slider start.
- Second click places the slider end.
- `slider_duration_ms` is the travel time from start to end, in milliseconds.
- After placement, the cursor advances to `sliderSpawn + sliderDuration + autoAdvance`.

## Validation

The validation panel mirrors the game's loader, so a map that passes here loads in game. The
game also checks the school against the installed schools, which the editor cannot see.

- `tier` is a whole number from 0 to 4.
- `school` is `none` or a full `namespace:path` school id.
- `weight` is a whole number from 1 to 1000.
- `name` is not blank.
- `total_hits` equals primary plus two per slider.
- `approach_ms` is positive.
- `music_track` is blank or a sound event id.
- Notes are non-empty and sorted by non-decreasing `spawn_time_ms` (whole numbers, 0 or more).
- Note ids are not blank and are unique.
- Note type is `primary`, `support`, or `slider`. Only sliders carry slider fields.
- Hit windows are positive.
- Positions, slider ends and slider path points are normalized. A slider has at most 256 path points.
- Sliders include `slider_end` and positive `slider_duration_ms`.
- Feedback point fields `perfect`, `good`, `miss` and `support_hit` are whole numbers.
- `scoring_config.speed.approach_multiplier` is 0.1 to 4.0 and `response_window_ms` is 1 to 5000.
- `scoring_config.scale` radius multipliers are 0.25 to 2.0.
- `scoring_config.accuracy` windows (`perfect_window_ms`, `good_window_ms`) are 1 to 5000 ms and perfect is at most good.
- Each weight is 0 to 1, and speed, scale and accuracy weights sum to `1.0`.
- `scoring_config.quality_thresholds` are whole numbers from 0 to 100, ascending from Uncommon through Myth.
