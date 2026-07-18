import os
from mobrpg.commands import suggest


def _vault(tmp_path):
    def w(rel, fm, body="Body text."):
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(f"---\n{fm}\n---\n{body}\n", encoding="utf-8")
    w("Characters/NPCs/Imogen_Bellamy.md",
      'type: npc\ntags:\n  - chapter-1\naliases:\n  - "Bells"\n  - Agent Bellamy\n'
      'occupation: "Order Field Agent, Linguist"\ngender: Female\n'
      'relationships:\n  - target: "[[Dr_Erasmus_Hume]]"\n    type: imprisoned_by\n'
      '    description: "Held captive"\n  - target: "[[Nathaniel_Rooke]]"\n    type: friend_of')
    w("Locations/British_Museum.md", 'type: location\ntags:\n  - chapter-1\nlocation_type: "Museum"')
    w("Items & Artifacts/Liber_Ivonis.md", 'type: item\ntags:\n  - chapter-2\n')
    return str(tmp_path)


def test_collect_entities_parses_and_filters(tmp_path):
    v = _vault(tmp_path)
    ents = suggest.collect_entities(v, chapter="chapter-1")
    names = {e["name"] for e in ents}
    assert names == {"Imogen Bellamy", "British Museum"}   # chapter-2 item excluded
    im = next(e for e in ents if e["name"] == "Imogen Bellamy")
    assert im["kind"] == "npc"
    assert im["aliases"] == ["Bells", "Agent Bellamy"]
    assert im["occupation"].startswith("Order Field Agent")
    assert im["gender"] == "Female"
    assert im["description"].startswith("<p>") and "Body text" in im["description"]
    assert im["relationships"] == [
        {"target": "Dr_Erasmus_Hume", "predicate": "imprisoned_by", "desc": "Held captive"},
        {"target": "Nathaniel_Rooke", "predicate": "friend_of", "desc": ""}]


def test_collect_entities_kind_and_only(tmp_path):
    v = _vault(tmp_path)
    assert {e["name"] for e in suggest.collect_entities(v, kind="location")} == {"British Museum"}
    assert {e["name"] for e in suggest.collect_entities(v, only="imogen")} == {"Imogen Bellamy"}
