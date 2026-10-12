// The sections the GURPS and CoC sheets read into their own blocks, so the page shows no
// accordion for them (pc.js). Here so the renderers can name them too (overflowNotes).
// GURPS: when a GURPS system sheet is present these leave the accordion list.
const GURPS_CONSUMED_TITLES = new Set(['stat sheet', 'skills', 'advantages & perks', 'disadvantages & quirks', 'techniques', 'spells', 'languages', 'cultural familiarities', 'combat action chains', 'active defenses', 'dr by hit location', 'points summary', 'reaction modifiers', 'current status', 'multi-action combat skill chains', 'combat summary']);

// CoC: 'connections' and 'cover identity' are deliberately NOT here: the structured renderer
// doesn't place them, so consuming them would silently drop the sections. Left un-consumed,
// they fall through to the Record tab's leftover-accordion guard (no content loss).
const COC_CONSUMED_TITLES = new Set(['stat sheet', 'skills', 'combat', 'background', 'injuries & scars', 'phobias & manias', 'encounters with strange entities', 'arcane tomes & spells', 'fellow investigators', 'current status', 'equipment']);

// Sections the Equipment tab takes in every system (pc.js).
const EQUIPMENT_SECTION_TITLES = new Set(['equipment', 'gear', 'inventory', 'weapons', 'armour', 'armor', 'items', 'possessions', 'melee weapons', 'ranged weapons', 'encumbrance']);

module.exports = { GURPS_CONSUMED_TITLES, COC_CONSUMED_TITLES, EQUIPMENT_SECTION_TITLES };
