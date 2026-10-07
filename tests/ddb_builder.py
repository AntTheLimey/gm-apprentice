#!/usr/bin/env python3
"""An invented character in D&D Beyond's shape, for tests of dnd_ddb_read.

SRD 5.2 names and made-up ones only; nothing here is copied from a real
character. Not a test file.
"""

SKILL_SLUGS = ("athletics", "acrobatics", "sleight-of-hand", "stealth", "arcana", "history",
               "investigation", "nature", "religion", "animal-handling", "insight", "medicine",
               "perception", "survival", "deception", "intimidation", "performance", "persuasion")
ARMOR_SLUGS = ("light-armor", "medium-armor", "heavy-armor", "shields")
WEAPON_CATEGORIES = ("simple-weapons", "martial-weapons")
SIZE_IDS = {"Tiny": 2, "Small": 3, "Medium": 4, "Large": 5, "Huge": 6, "Gargantuan": 7}
KNOWN_CASTERS = ("Bard", "Sorcerer", "Warlock")   # no spellPrepareType: every listed spell is known
CLASS_FEATURE, RACIAL_TRAIT, FEAT, ITEM = 12168134, 1960452172, 1088085227, 112130694
# The SRD full-caster table: slots of each spell level, by class level 0..20.
FULL_CASTER_SLOTS = [[0] * 9, [2] + [0] * 8, [3] + [0] * 8, [4, 2] + [0] * 7, [4, 3] + [0] * 7,
                     [4, 3, 2] + [0] * 6, [4, 3, 3] + [0] * 6, [4, 3, 3, 1] + [0] * 5,
                     [4, 3, 3, 2] + [0] * 5, [4, 3, 3, 3, 1] + [0] * 4, [4, 3, 3, 3, 2] + [0] * 4,
                     [4, 3, 3, 3, 2, 1] + [0] * 3, [4, 3, 3, 3, 2, 1] + [0] * 3,
                     [4, 3, 3, 3, 2, 1, 1] + [0] * 2, [4, 3, 3, 3, 2, 1, 1] + [0] * 2,
                     [4, 3, 3, 3, 2, 1, 1, 1, 0], [4, 3, 3, 3, 2, 1, 1, 1, 0],
                     [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
                     [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]]


def _stats(values):
    return [{"id": i + 1, "name": None, "value": v} for i, v in enumerate(values)]


def _limited_use(uses, reset, extra=None):
    if uses is None:
        return None
    use = {"name": None, "statModifierUsesId": None, "resetType": reset, "numberUsed": 0,
           "minNumberConsumed": 1, "maxNumberConsumed": 1, "maxUses": uses, "operator": 1,
           "useProficiencyBonus": False, "proficiencyBonusOperator": 1, "resetDice": None}
    use.update(extra or {})
    return use


def _action(name, component_id, component_type, uses, reset, extra=None):
    return {"componentId": component_id, "componentTypeId": component_type, "id": str(component_id),
            "name": name, "limitedUse": _limited_use(uses, reset, extra), "actionType": 3}


def _feature_def(ident, name, required, hidden, owner_id):
    return {"id": ident, "name": name, "requiredLevel": required, "hideInSheet": hidden,
            "entityTypeId": CLASS_FEATURE, "limitedUse": [{"level": None, "uses": 9}],
            "featureType": 1, "classId": owner_id}


def _entry(spec, default_required):
    """(name, uses, reset[, required level[, hidden[, scaling]]]) with defaults."""
    spec = tuple(spec) + (None,) * (6 - len(spec))
    name, uses, reset, required, hidden, scaling = spec
    return name, uses, reset, default_required if required is None else required, bool(hidden), scaling


def _modifier(ident, kind, sub, value, component_id, component_type, extra):
    if sub in SKILL_SLUGS:
        entity_type = 1958004211
    elif sub in ARMOR_SLUGS:
        entity_type = 174869515
    elif sub in WEAPON_CATEGORIES:
        entity_type = 660121713
    elif kind == "language":
        entity_type = 906033267
    elif kind == "proficiency" and sub.endswith(("tools", "kit", "supplies", "set")):
        entity_type = 2103445194
    else:
        entity_type = None
    mod = {"id": str(ident), "type": kind, "subType": sub, "value": value, "fixedValue": value,
           "entityId": None, "entityTypeId": entity_type, "statId": None, "restriction": "",
           "requiresAttunement": False, "availableToMulticlass": True, "bonusTypes": [],
           "friendlySubtypeName": sub.replace("-", " ").title(),
           "componentId": component_id, "componentTypeId": component_type}
    mod.update({k: v for k, v in extra.items() if k not in ("item", "class")})
    return mod


def character(name="Tavin Reedmere", classes=(("Wizard", 5, "Evoker", 4),), species="Human",
              background="Sage", alignment_id=2, stats=(8, 14, 14, 16, 12, 10),
              bonus_stats=(0,) * 6, override_stats=(None,) * 6, modifiers=(),
              spells=(), inventory=(), feats=(), class_features=(), racial_traits=(),
              currencies=None, xp=6500, size="Medium", speed=30):
    """classes: (name, level, subclass or "", spellcasting ability stat id or None).
    modifiers: (group, type, subType, value[, extras]) with group one of race, class,
    background, item, feat; extras is a dict that overrides a modifier field, plus
    "item": the inventory item an item modifier belongs to (the first by default) and
    "class": the class a class modifier belongs to (the first by default).
    spells: (name, level, prepared, always_prepared, concentration, ritual, component ids,
    source) with source a class name, "Species", "Feat: <name>" or "Item: <name>".
    inventory: (name, quantity, weight, magic, attuned, kind[, equipped[, charges[, reset]]])
    with kind armor, shield, weapon or gear.
    feats: (name,). class_features and racial_traits: (name, max uses or None, reset type
    1 short, 2 long, or None[, required level[, hidden in sheet[, limitedUse overrides]]]);
    class_features belong to the first class."""
    char_id = 4242
    class_rows, class_actions, feature_ids, ident = [], [], {}, 1000
    for i, (cname, level, subclass, ability) in enumerate(classes):
        feats_here = []
        if ability is not None:
            ident += 1
            feats_here.append({"definition": _feature_def(ident, "Spellcasting", 1, True, i), "levelScale": None})
        ident += 1
        feature_ids[cname] = ident
        feats_here.append({"definition": _feature_def(ident, f"{cname} Proficiencies", 1, True, i), "levelScale": None})
        if i == 0:
            for spec in class_features:
                fname, uses, reset, required, hidden, scaling = _entry(spec, 1)
                ident += 1
                feats_here.append({"definition": _feature_def(ident, fname, required, hidden, i), "levelScale": None})
                if uses is not None:
                    class_actions.append(_action(fname, ident, CLASS_FEATURE, uses, reset, scaling))
        sub_def = {"id": 7000 + i, "name": subclass, "spellCastingAbilityId": None, "classFeatures": []} if subclass else None
        rules = {"levelSpellSlots": FULL_CASTER_SLOTS, "isRitualSpellCaster": False,
                 "multiClassSpellSlotDivisor": 1, "multiClassSpellSlotRounding": 1} if ability else None
        class_rows.append({
            "id": 1000 + i, "level": level, "isStartingClass": i == 0, "hitDiceUsed": 0,
            "subclassDefinition": sub_def,
            "classFeatures": feats_here,
            "definition": {"id": 100 + i, "name": cname, "spellCastingAbilityId": ability,
                           "knowsAllSpells": cname not in KNOWN_CASTERS and ability is not None,
                           "spellPrepareType": None if cname in KNOWN_CASTERS or ability is None else 1,
                           "spellRules": rules}})

    actions = {"race": [], "class": class_actions, "background": None, "item": None, "feat": []}
    trait_rows = []
    for spec in racial_traits:
        tname, uses, reset, required, hidden, scaling = _entry(spec, None)
        ident += 1
        trait_rows.append({"definition": {"id": ident, "name": tname, "hideInSheet": hidden, "requiredLevel": required,
                                          "entityTypeId": RACIAL_TRAIT, "featureType": 1}})
        if uses is not None:
            actions["race"].append(_action(tname, ident, RACIAL_TRAIT, uses, reset, scaling))
    feat_rows, feat_ids = [], {}
    for (fname,) in feats:
        ident += 1
        feat_ids[fname] = ident
        feat_rows.append({"definition": {"id": ident, "name": fname, "entityTypeId": FEAT}})

    items, item_ids = [], {}

    def add_item(iname, qty=1, weight=0, magic=False, attuned=False, kind="gear", equipped=True,
                 charges=None, reset=None):
        defn = {"id": 5000 + len(items), "name": iname, "weight": weight, "magic": magic,
                "canAttune": magic, "stackable": qty > 1, "bundleSize": 1, "weightMultiplier": 1,
                "filterType": {"armor": "Armor", "shield": "Armor", "weapon": "Weapon"}.get(
                    kind, "Wondrous item" if magic else "Other Gear"),
                "armorTypeId": {"armor": 1, "shield": 4}.get(kind), "strengthRequirement": 0}
        row = {"id": 9000 + len(items), "definition": defn, "quantity": qty, "isAttuned": attuned,
               "equipped": equipped, "equippedEntityId": char_id if equipped else None,
               "limitedUse": None if charges is None else {"maxUses": charges, "numberUsed": 0, "resetType": reset}}
        items.append(row)
        item_ids.setdefault(iname, defn["id"])

    for spec in inventory:
        add_item(*spec)

    spell_rows = {"race": [], "class": [], "item": [], "feat": [], "background": None}
    class_spells = {c["definition"]["name"]: [] for c in class_rows}
    for sname, level, prepared, always, conc, ritual, components, source in spells:
        defn = {"name": sname, "level": level, "concentration": conc, "ritual": ritual,
                "components": list(components), "activation": {"activationTime": 1, "activationType": 1},
                "duration": {"durationInterval": 1, "durationUnit": "Minute", "durationType": "Concentration" if conc else "Time"},
                "range": {"origin": "Ranged", "rangeValue": 30, "aoeType": None, "aoeValue": None}}
        row = {"definition": defn, "prepared": prepared, "alwaysPrepared": always, "countsAsKnownSpell": True,
               "componentId": 0, "componentTypeId": 0}
        if source.startswith("Item: "):
            if source[6:] not in item_ids:
                add_item(source[6:], magic=True, attuned=True)
            spell_rows["item"].append({**row, "componentId": item_ids[source[6:]], "componentTypeId": ITEM})
        elif source.startswith("Feat: "):
            spell_rows["feat"].append({**row, "componentId": feat_ids[source[6:]], "componentTypeId": FEAT})
        elif source == "Species":
            spell_rows["race"].append(row)
        else:
            class_spells[source].append(row)

    mods = {"race": [], "class": [], "background": [], "item": [], "feat": [], "condition": []}
    for n, spec in enumerate(modifiers):
        group, kind, sub, value = spec[:4]
        extra = spec[4] if len(spec) > 4 else {}
        if group == "item":
            if not items:
                add_item("Charm of Tests", magic=True, attuned=True)
            owner, owner_type = item_ids[extra.get("item", items[0]["definition"]["name"])], ITEM
        elif group == "class":
            owner, owner_type = feature_ids[extra.get("class", classes[0][0])], CLASS_FEATURE
        else:
            owner, owner_type = 0, None
        mods[group].append(_modifier(n + 1, kind, sub, value, owner, owner_type, extra))

    return {
        "id": char_id, "name": name, "currentXp": xp, "alignmentId": alignment_id,
        "stats": _stats(stats), "bonusStats": _stats(bonus_stats), "overrideStats": _stats(override_stats),
        "preferences": {"progressionType": 1}, "characterValues": [], "customProficiencies": [],
        "customSpeeds": [], "conditions": [],
        "background": {"hasCustomBackground": False, "definition": {"name": background}},
        "race": {"fullName": species, "sizeId": SIZE_IDS[size], "size": None, "racialTraits": trait_rows,
                 "weightSpeeds": {"normal": {"walk": speed, "fly": 0, "burrow": 0, "swim": 0, "climb": 0}}},
        "classes": class_rows, "feats": feat_rows, "inventory": items,
        "currencies": currencies if currencies is not None else {"cp": 0, "sp": 0, "gp": 15, "ep": 0, "pp": 0},
        "modifiers": mods, "actions": actions, "spells": spell_rows,
        "classSpells": [{"characterClassId": 1000 + i, "spells": class_spells[c[0]]} for i, c in enumerate(classes)],
    }
