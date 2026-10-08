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
ITEM_ROW, WEAPON_BASE, WEAPON_CATEGORY, ACTION, UNARMED = 1439493548, 1782728300, 660121713, 222216831, 1120657896
SIMPLE, MARTIAL = 1, 2                          # weapon category ids
LIGHT, MEDIUM, HEAVY, SHIELD = 1, 2, 3, 4       # armour type ids
# The SRD full-caster table: slots of each spell level, by class level 0..20.
FULL_CASTER_SLOTS = [[0] * 9, [2] + [0] * 8, [3] + [0] * 8, [4, 2] + [0] * 7, [4, 3] + [0] * 7,
                     [4, 3, 2] + [0] * 6, [4, 3, 3] + [0] * 6, [4, 3, 3, 1] + [0] * 5,
                     [4, 3, 3, 2] + [0] * 5, [4, 3, 3, 3, 1] + [0] * 4, [4, 3, 3, 3, 2] + [0] * 4,
                     [4, 3, 3, 3, 2, 1] + [0] * 3, [4, 3, 3, 3, 2, 1] + [0] * 3,
                     [4, 3, 3, 3, 2, 1, 1] + [0] * 2, [4, 3, 3, 3, 2, 1, 1] + [0] * 2,
                     [4, 3, 3, 3, 2, 1, 1, 1, 0], [4, 3, 3, 3, 2, 1, 1, 1, 0],
                     [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
                     [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]]


def dice(text, fixed=None):
    """'2d6' as the data writes a set of dice."""
    count, value = text.split("d")
    return {"diceCount": int(count), "diceValue": int(value), "diceMultiplier": None,
            "fixedValue": fixed, "diceString": text}


def weapon(damage="1d8", damage_type="Slashing", category=SIMPLE, base_item=1, ranged=False, properties=(), **more):
    """Definition fields of a weapon, for `item_details`. `damage` None is a weapon with no dice."""
    return {"baseTypeId": WEAPON_BASE, "baseItemId": base_item, "categoryId": category,
            "attackType": 2 if ranged else 1, "damage": dice(damage) if damage else None,
            "fixedDamage": None, "damageType": damage_type, "isMonkWeapon": False, "weaponBehaviors": [],
            "properties": [{"id": n + 1, "name": p, "notes": None} for n, p in enumerate(properties)], **more}


def armour(armor_class, kind=LIGHT, **more):
    """Definition fields of a suit of armour or a shield, for `item_details`."""
    return {"armorClass": armor_class, "armorTypeId": kind, **more}


def cantrip(damage=None, damage_type="fire", attack=None, save=None, tiers=(), primary_stat=False, **more):
    """Definition fields of a cantrip, for `spell_details`. attack: 1 melee, 2 ranged, None for
    no attack roll. save: the stat id the target saves with. tiers: (level, dice) the damage
    becomes at that character level."""
    mods = []
    if damage:
        higher = [{"level": lvl, "typeId": 15, "dice": dice(d), "value": None} for lvl, d in tiers]
        mods.append({"type": "damage", "subType": damage_type, "die": dice(damage), "usePrimaryStat": primary_stat,
                     "atHigherLevels": {"higherLevelDefinitions": higher, "additionalAttacks": [], "points": []}})
    return {"level": 0, "requiresAttackRoll": attack is not None, "attackType": attack,
            "requiresSavingThrow": save is not None, "saveDcAbilityId": save, "scaleType": "characterlevel",
            "asPartOfWeaponAttack": False, "modifiers": mods, **more}


def attack_action(name, ident=700, **more):
    """An entry of `actions`: a feature's action as the data lists it. Nothing is set that
    makes it an attack; pass attackTypeRange, saveStatId, dice and the rest."""
    return {"id": str(ident), "entityTypeId": str(ACTION), "name": name, "actionType": 3, "attackSubtype": None,
            "attackTypeRange": None, "abilityModifierStatId": None, "isProficient": False, "fixedToHit": None,
            "saveStatId": None, "fixedSaveDc": None, "dice": None, "value": None, "damageTypeId": None,
            "isMartialArts": False, "displayAsAttack": None, "limitedUse": None,
            "componentId": 0, "componentTypeId": None, **more}


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
              currencies=None, xp=6500, size="Medium", speed=30,
              hit_points=None, hit_dice=None, item_details=None, spell_details=None,
              actions=(), custom_actions=(), character_values=()):
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
    class_features belong to the first class.
    hit_points: any of base (the rolled total), bonus, override and type (1 fixed from the hit
    dice, 2 rolled); without it the data carries no hit point fields. hit_dice: class name ->
    die size. item_details: item name -> definition fields laid over the item's (see `weapon`
    and `armour`), with "row" a dict laid over the inventory row. spell_details: the same for
    a spell's definition and its row (see `cantrip`). actions: (group, action) with group
    race, class or feat (see `attack_action`). custom_actions: the player's own actions, as
    the data lists them. character_values: (type id, value, target[, target type id]) with
    target "item:<name>" for an inventory row, "unarmed" for the Unarmed Strike, None for a
    character-wide value, or an id."""
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
        if hit_dice and cname in hit_dice:
            class_rows[-1]["definition"]["hitDice"] = hit_dice[cname]

    given_actions = actions
    actions = {"race": [], "class": class_actions, "background": None, "item": None, "feat": []}
    for group, action in given_actions:
        actions[group].append(action)
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
                 charges=None, reset=None, consumable=False):
        defn = {"id": 5000 + len(items), "name": iname, "weight": weight, "magic": magic,
                "canAttune": magic, "isConsumable": consumable, "stackable": qty > 1, "bundleSize": 1, "weightMultiplier": 1,
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
    for iname, details in (item_details or {}).items():
        for row in items:
            if row["definition"]["name"] == iname:
                row["definition"].update({k: v for k, v in details.items() if k != "row"})
                row.update(details.get("row", {}))

    spell_rows = {"race": [], "class": [], "item": [], "feat": [], "background": None}
    class_spells = {c["definition"]["name"]: [] for c in class_rows}
    for sname, level, prepared, always, conc, ritual, components, source in spells:
        defn = {"name": sname, "level": level, "concentration": conc, "ritual": ritual,
                "components": list(components), "activation": {"activationTime": 1, "activationType": 1},
                "duration": {"durationInterval": 1, "durationUnit": "Minute", "durationType": "Concentration" if conc else "Time"},
                "range": {"origin": "Ranged", "rangeValue": 30, "aoeType": None, "aoeValue": None}}
        row = {"definition": defn, "prepared": prepared, "alwaysPrepared": always, "countsAsKnownSpell": True,
               "componentId": 0, "componentTypeId": 0}
        details = (spell_details or {}).get(sname, {})
        defn.update({k: v for k, v in details.items() if k != "row"})
        row.update(details.get("row", {}))
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

    values = []
    for spec in character_values:
        type_id, value, target = spec[:3]
        if target == "unarmed":
            target, target_type = "1", str(UNARMED)
        elif isinstance(target, str) and target.startswith("item:"):
            target = str(next(r["id"] for r in items if r["definition"]["name"] == target[5:]))
            target_type = str(ITEM_ROW)
        else:
            target_type = str(spec[3]) if len(spec) > 3 else None
        values.append({"typeId": type_id, "value": value, "notes": None, "valueId": target,
                       "valueTypeId": target_type, "contextId": None, "contextTypeId": None})
    hp_fields = {}
    if hit_points is not None:
        hp_fields = {"baseHitPoints": hit_points.get("base", 0), "bonusHitPoints": hit_points.get("bonus"),
                     "overrideHitPoints": hit_points.get("override"),
                     "removedHitPoints": 0, "temporaryHitPoints": 0}

    built = {
        "id": char_id, "name": name, "currentXp": xp, "alignmentId": alignment_id,
        "stats": _stats(stats), "bonusStats": _stats(bonus_stats), "overrideStats": _stats(override_stats),
        "preferences": {"progressionType": 1}, "characterValues": values, "customProficiencies": [],
        "customSpeeds": [], "conditions": [],
        "background": {"hasCustomBackground": False, "definition": {"name": background}},
        "race": {"fullName": species, "sizeId": SIZE_IDS[size], "size": None, "racialTraits": trait_rows,
                 "weightSpeeds": {"normal": {"walk": speed, "fly": 0, "burrow": 0, "swim": 0, "climb": 0}}},
        "classes": class_rows, "feats": feat_rows, "inventory": items,
        "currencies": currencies if currencies is not None else {"cp": 0, "sp": 0, "gp": 15, "ep": 0, "pp": 0},
        "modifiers": mods, "actions": actions, "spells": spell_rows,
        "classSpells": [{"characterClassId": 1000 + i, "spells": class_spells[c[0]]} for i, c in enumerate(classes)],
        "customActions": list(custom_actions), **hp_fields,
    }
    if hit_points is not None:
        built["preferences"]["hitPointType"] = hit_points.get("type", 2)
    return built
