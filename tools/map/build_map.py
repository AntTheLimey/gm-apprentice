#!/usr/bin/env python3
"""Build an interactive 3D star map from a campaign vault.

Reads Locations/*.md frontmatter and prose, resolves containment, gates and
lanes, and writes a self-contained HTML page.

    python3 build_map.py --vault VAULT            # GM copy, Keeper layer behind a keyword
    python3 build_map.py --vault VAULT --player   # player-safe copy, Keeper material removed

Rerun after a mobRPG pull or a session wrap-up; new systems, planets, gates
and sites appear on their own. The layout file (default
VAULT/_meta/map/layout.json, see layout.example.json) holds only what the
vault has no field for: sector positions, inferred lanes, prose anchors,
page wording and the Keeper overlay.
"""
import argparse
import base64
import json
import re
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE / "star-map.template.html"
# Set from the command line in main(); module-level so the helpers can read them.
VAULT = Path(".")
LOCATIONS = VAULT / "Locations"
CACHE = VAULT / "_meta" / "map" / ".cache"
# Same markers the publish-site build strips (gm-apprentice tools/publish/lib/processor.js).
MARKED = re.compile(r"<!--\s*(gm-only|spoiler)\s*-->(.*?)<!--\s*/\1\s*-->", re.S | re.I)
COMMENT = re.compile(r"<!--.*?-->", re.S)

ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8,
         "IX": 9, "X": 10, "XI": 11, "XII": 12}
WIKILINK = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")


def read_note(path):
    text = path.read_text(encoding="utf-8")
    fm, body = {}, text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            try:
                fm = yaml.safe_load(text[3:end]) or {}
            except yaml.YAMLError as exc:
                print(f"warning: bad frontmatter in {path.name}: {exc}", file=sys.stderr)
            body = text[end + 4:]
    return fm, body


def link_target(value):
    if not value:
        return None
    m = WIKILINK.search(str(value))
    return m.group(1).strip() if m else None


def plain(text):
    text = re.sub(r"!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)", "", text)  # image embeds
    text = WIKILINK.sub(lambda m: m.group(2) or m.group(1), text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def sections(body):
    out, name, buf = {}, "_", []
    for line in body.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            out[name] = buf
            name, buf = m.group(1), []
        else:
            buf.append(line)
    out[name] = buf
    return out


def overview(secs):
    """First prose paragraphs of ## Overview, callouts and import stamps removed."""
    lines = secs.get("Overview", [])
    paras, cur = [], []
    for line in lines:
        s = line.strip()
        if s.startswith(">") or "mobRPG" in s or s.startswith("<!--"):
            continue
        if not s:
            if cur:
                paras.append(" ".join(cur))
                cur = []
            continue
        cur.append(s)
    if cur:
        paras.append(" ".join(cur))
    text = plain(" ".join(paras[:2]))
    return text[:700] + ("…" if len(text) > 700 else "")


def keeper_blocks(body):
    """Text of every '> [!info] Keeper Only' callout in the note."""
    blocks, cur = [], None
    for line in body.splitlines():
        if re.match(r"^>\s*\[!info\]\s*Keeper Only", line, re.I):
            cur = []
            blocks.append(cur)
            continue
        if cur is not None:
            if line.startswith(">"):
                s = line.lstrip(">").strip()
                if s:
                    cur.append(s)
            else:
                cur = None
    return [plain(" ".join(b)) for b in blocks if b]


def appearances(secs):
    sessions = set()
    for line in secs.get("Appearances", []):
        for m in re.finditer(r"Session\s+0*(\d+)", line):
            sessions.add(int(m.group(1)))
    return sorted(sessions)


def classify(name, ltype, parent_kind):
    t = (ltype or "").lower()
    if t == "star system":
        return "system"
    if t == "star":
        return "star"
    if "hyperspace gate" in t or t == "gate":
        return "gate"
    if t == "trade route":
        return "route"
    if "asteroid belt" in t:
        return "belt"
    if t == "space station":
        return "station"
    if t == "spaceship":
        return "ship"
    if "anomaly" in t:
        return "anomaly"
    if t == "moon":
        return "moon"
    if "planet" in t or "giant" in t:
        return "moon" if parent_kind in ("planet", "star") else "planet"
    if t in ("sector", "polity", "territory") and parent_kind is None:
        return "region"
    return "site"


def numeral(name):
    m = re.search(r"\b([IVX]+)\b(?:\s+[A-Z])?$", name)
    return ROMAN.get(m.group(1), 99) if m else 99


def star_color(text):
    t = text.lower()
    if "failed star" in t or "brown dwarf" in t:
        return "#b0503a"
    for keys, col in ((("blue-white", "a-type", "b-type"), "#bcd4ff"),
                      (("yellow-white", "f-type"), "#fff4d6"),
                      (("orange", "k-type", "k5", "k type"), "#ffb35c"),
                      (("red", "m-type"), "#ff6a4a"),
                      (("yellow", "g-type"), "#ffe28a"),
                      (("white",), "#f4f6ff")):
        if any(k in t for k in keys):
            return col
    return "#ffe9b0"


def planet_tint(ltype, text):
    t = f"{ltype} {text}".lower()
    for keys, col in ((("toxic",), "#9bd45a"), (("irradiated",), "#c77dff"),
                      (("icy", "ice"), "#a8e6ff"), (("gas giant",), "#f0a060"),
                      (("earth-like", "jungle", "ocean"), "#4fd1a5"),
                      (("tidally", "molten", "volcan"), "#ff7a4a"),
                      (("desert", "arid"), "#e0c070")):
        if any(k in t for k in keys):
            return col
    return "#7fb8ff"



# ─── Surface traits: read from each note so textures follow the canon ───────
COLOR_WORDS = {
    "purple": "#7a4fb0", "violet": "#8a5cc8", "copper": "#b8733a", "orange": "#e08a3c",
    "cream": "#efe0bd", "yellow": "#d9c24a", "sulfur": "#d9c24a", "red": "#b8432e",
    "green": "#4f8f4a", "blue": "#3f6fb5", "obsidian": "#1c1a24", "iron oxide": "#a0522d",
    "rust": "#9a4a2a", "gold": "#d4a64a", "amber": "#d8963a", "teal": "#3a9a95",
}


def traits(kind, ltype, raw):
    t = f"{ltype} {raw}".lower()
    has = lambda *ws: any(re.search(r"\b" + re.escape(w) + r"\b", t) for w in ws)
    if kind == "star":
        return {"arch": "brown" if has("failed star", "brown dwarf") else "star"}
    if re.match(r"\s*(an? )?(failed star|brown dwarf)", raw.lower()):
        arch = "brown"
    elif has("molten", "lava"):
        arch = "molten"
    elif has("hot gas giant"):
        arch = "hotgas"
    elif has("ice giant", "frozen gas giant") or (has("ammonia", "methane") and has("giant", "massive")):
        arch = "icegiant"
    elif has("gas giant", "hydrogen"):
        arch = "gas"
    elif has("only ocean", "no land", "ocean world"):
        arch = "ocean"
    elif has("earth-like", "earth like", "habitable", "rainforest", "living world", "life exists"):
        arch = "earth"
    elif has("toxic", "sulfur", "corrosive", "greenhouse"):
        arch = "toxic"
    elif has("desert", "arid", "dust", "iron oxide"):
        arch = "desert"
    elif has("irradiated", "radiation"):
        arch = "irradiated"
    elif has("icy", "ice", "frozen", "nitrogen", "snow"):
        arch = "icy"
    else:
        arch = "rock"
    tr = {"arch": arch}
    if arch == "earth" and has("icy"):
        tr["icecaps"] = "big"
    ring = re.search(r"\b(complex ring|multiple rings|set of rings|large ring|one large ring|faint ring|slight ring|"
                     r"thin ring|dark, thin ring|rings?|ringed)\b", t)
    if ring and kind != "belt":
        w = ring.group(1)
        if "ringed with orbital" in t or "industrially worked" in t:
            tr["rings"] = "industrial"
        elif any(k in w for k in ("complex", "multiple", "set of")):
            tr["rings"] = "complex"
        elif "large" in w:
            tr["rings"] = "large"
        elif any(k in w for k in ("faint", "slight", "thin")):
            tr["rings"] = "faint"
        else:
            tr["rings"] = "single"
        if "dark" in t[max(0, ring.start() - 20):ring.end()]:
            tr["ringDark"] = True
    if re.search(r"tidal(ly)?[- ]lock", t) and not re.search(r"with an? tidally[- ]locked moon", t):
        tr["tidal"] = True
    m = re.search(r"tilt of (\d+)", t)
    if m:
        tr["tilt"] = int(m.group(1))
    if has("fast rotation", "fast rotational"):
        tr["spin"] = "fast"
    if has("no rotation"):
        tr["spin"] = "none"
    if has("retrograde"):
        tr["retro"] = True
    if has("storm", "lightning", "cross winds", "wind speeds", "monsoon", "blizzard"):
        tr["storms"] = True
    if has("aurora", "auroras"):
        tr["aurora"] = True
    if has("crater", "airless", "no atmosphere", "meteor"):
        tr["craters"] = True
    if has("canyon", "canyons", "volcano", "volcanoes"):
        tr["canyons"] = True
    if has("obsidian", "jagged"):
        tr["streaks"] = True
    if has("airless", "no atmosphere", "stripped"):
        tr["atmo"] = "none"
    elif has("trace atmosphere"):
        tr["atmo"] = "trace"
    elif has("dense", "thick", "crushing", "reflective", "fog"):
        tr["atmo"] = "thick"
    if has("scorched", "extreme temperature", "extreme temperatures", "very high average temperature", "extreme tempatures", "extreme-temperature"):
        tr["hot"] = True
    words = [c for w, c in COLOR_WORDS.items() if has(w)]
    if words:
        tr["colors"] = words[:4]
    return tr


def art_images(path, want_palette):
    """Panel art (a data URI) and, for bodies, a palette sampled from the centre of the picture."""
    try:
        from PIL import Image
    except ImportError:
        return {}
    if not path.exists():
        return {}
    import hashlib
    import io
    cache = CACHE
    cache.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(f"{path}:{path.stat().st_mtime}:{want_palette}:v2".encode()).hexdigest()
    hit = cache / f"{key}.json"
    if hit.exists():
        return json.loads(hit.read_text())
    img = Image.open(path).convert("RGB")
    out = {}
    art = img.copy()
    art.thumbnail((640, 640))
    buf = io.BytesIO()
    art.save(buf, "JPEG", quality=74, optimize=True)
    out["art"] = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    if want_palette:
        w, h = img.size
        side = int(min(w, h) * (0.6 if min(w, h) < 300 else 0.42))
        box = ((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2)
        crop = img.crop(box).resize((96, 96))
        q = crop.quantize(colors=6, method=Image.Quantize.MEDIANCUT)
        pal = q.getpalette()[:18]
        counts = sorted(q.getcolors(), reverse=True)
        cols = []
        for _, idx in counts:
            r, g, b = pal[idx * 3: idx * 3 + 3]
            if (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.07:
                continue  # background space
            cols.append(f"#{r:02x}{g:02x}{b:02x}")
        if cols:
            out["palette"] = cols[:5]
    hit.write_text(json.dumps(out))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--vault", type=Path, required=True, help="campaign vault root")
    ap.add_argument("--layout", type=Path,
                    help="layout JSON (default VAULT/_meta/map/layout.json)")
    ap.add_argument("--out", type=Path,
                    help="output HTML (default VAULT/_meta/map/star-map.html, or star-map-player.html)")
    ap.add_argument("--player", action="store_true",
                    help="player-safe build: no Keeper text, no hidden lanes, publish:false notes dropped")
    args = ap.parse_args()
    global VAULT, LOCATIONS, CACHE
    VAULT = args.vault.resolve()
    LOCATIONS = VAULT / "Locations"
    mapdir = VAULT / "_meta" / "map"
    CACHE = mapdir / ".cache"
    player = args.player
    layout_path = args.layout or mapdir / "layout.json"
    out_path = args.out or mapdir / ("star-map-player.html" if player else "star-map.html")
    if not LOCATIONS.is_dir():
        sys.exit(f"no Locations/ folder in {VAULT}")
    if not layout_path.exists():
        sys.exit(f"no layout file at {layout_path} (start from {HERE / 'layout.example.json'})")
    # The player map never shows a location the published site has chosen to exclude.
    site_excluded = set()
    manifest = VAULT / "_meta" / "publish-manifest.md"
    if player and manifest.exists():
        section = None
        for line in manifest.read_text(encoding="utf-8").splitlines():
            if line.startswith("## "):
                section = line[3:].strip()
            elif section == "Excluded":
                m = re.search(r"Locations/([^\]|]+?)\.md", line)
                if m:
                    site_excluded.add(m.group(1))
    layout = json.loads(layout_path.read_text())
    notes = {}
    for path in sorted(LOCATIONS.glob("*.md")):
        fm, body = read_note(path)
        if fm.get("type") not in (None, "location"):
            continue
        if player and (fm.get("publish") in (False, "false", "none") or path.stem in site_excluded):
            continue
        marked = [plain(m.group(2)) for m in MARKED.finditer(body) if m.group(2).strip()]
        body = COMMENT.sub("", MARKED.sub("", body))
        secs = sections(body)
        name = path.stem
        notes[name] = {
            "name": name,
            "ltype": (fm.get("location_type") or "").strip(),
            "parent": link_target(fm.get("parent_location")),
            "overview": overview(secs),
            "keeper": keeper_blocks(body) + marked + ([plain(fm["secrets"])] if fm.get("secrets") else []),
            "sessions": appearances(secs),
            "aliases": fm.get("aliases") or [],
            "file": f"Locations/{name}",
            "raw": plain(" ".join(secs.get("Overview", []))),
            "portrait": (fm.get("portrait") or "").strip(),
        }

    # Name-based parent recovery for mobRPG imports that arrive without containment.
    systems = [n for n, v in notes.items() if v["ltype"].lower() == "star system"]
    stems = {s[: -len(" System")]: s for s in systems if s.endswith(" System")}
    for n, v in notes.items():
        if v["parent"] or n in systems:
            continue
        for stem, sysname in sorted(stems.items(), key=lambda kv: -len(kv[0])):
            if n == stem or n.startswith(stem + " "):
                v["parent"] = sysname
                v["inferred_parent"] = True
                break

    # Classify (parents first so moons can see their planet).
    def kind_of(n, seen=()):
        v = notes[n]
        if "kind" in v:
            return v["kind"]
        p = v["parent"] if v["parent"] in notes and v["parent"] not in seen else None
        pk = kind_of(p, seen + (n,)) if p else None
        v["kind"] = classify(n, v["ltype"], pk)
        return v["kind"]

    for n in notes:
        kind_of(n)
    for n, anchor in layout.get("anchors", {}).items():
        if n in notes:
            notes[n]["anchor"] = anchor

    def system_of(n, depth=0):
        v = notes.get(n)
        if not v or depth > 12:
            return None
        if v["kind"] == "system":
            return n
        return system_of(v["parent"], depth + 1)

    def body_of(n, depth=0):
        """Nearest ancestor that exists as a 3D body (planet, moon, station, belt, star, ship)."""
        v = notes.get(n)
        if not v or depth > 12:
            return None
        if depth and v["kind"] in ("planet", "moon", "station", "belt", "star", "ship"):
            return n
        return body_of(v["parent"], depth + 1)

    # Routes and gate pairing.
    routes = []
    for n, v in notes.items():
        if v["kind"] != "route":
            continue
        m = re.match(r"^(.+?)-(.+?) Route$", n)
        if not m:
            continue
        a, b = f"{m.group(1)} System", f"{m.group(2)} System"
        if a in notes and b in notes:
            routes.append({"name": n, "a": a, "b": b, "gates": {}, "inferred": False,
                           "overview": v["overview"]})
    for r in layout.get("inferred_routes", []):
        routes.append({"name": f"{r['a'].replace(' System', '')}–{r['b'].replace(' System', '')} (unconfirmed)",
                       "a": r["a"], "b": r["b"], "gates": {r["a"]: r.get("gate_a")} if r.get("gate_a") else {},
                       "inferred": True, "overview": r.get("note", "")})

    gates_by_sys = {}
    for n, v in notes.items():
        if v["kind"] == "gate":
            gates_by_sys.setdefault(system_of(n), []).append(n)
    for sysname, gates in gates_by_sys.items():
        mine = [r for r in routes if sysname in (r["a"], r["b"])]
        free = sorted(g for g in gates if not any(r["gates"].get(sysname) == g for r in mine))
        # Pass 1: the gate's own prose names the route or the far system.
        for g in list(free):
            text = notes[g]["raw"].lower()
            for r in mine:
                if r["gates"].get(sysname):
                    continue
                other = r["b"] if r["a"] == sysname else r["a"]
                if r["name"].lower() in text or other.lower().replace(" system", " system") in text:
                    r["gates"][sysname] = g
                    free.remove(g)
                    break
        # Pass 2: elimination, in name order.
        for r in mine:
            if not r["gates"].get(sysname) and free:
                r["gates"][sysname] = free.pop(0)
    for r in routes:
        for sysname, g in r["gates"].items():
            if g in notes:
                notes[g]["route"] = r["name"]

    # Assemble systems.
    out_systems = []
    positions = layout.get("sector_positions", {})
    placed = {s: positions[s] for s in systems if s in positions}
    for s in systems:
        if s in placed:
            continue
        nbrs = [placed[r["b"] if r["a"] == s else r["a"]] for r in routes
                if s in (r["a"], r["b"]) and (r["b"] if r["a"] == s else r["a"]) in placed]
        base = [sum(c) / len(nbrs) for c in zip(*nbrs)] if nbrs else [0, 0, 0]
        k = len(placed)
        placed[s] = [base[0] + 34 * ((k % 3) - 1) + 18, base[1] + (-1) ** k * 8, base[2] + 30 + 6 * k]
        print(f"note: auto-placed {s} at {placed[s]} (add it to layout.json to pin it)")

    def entity(n):
        v = notes[n]
        e = {"name": n, "kind": v["kind"], "type": v["ltype"], "overview": v["overview"],
             "sessions": v["sessions"], "file": v["file"], "parent": v["parent"]}
        if v.get("anchor"):
            e["anchor"] = v["anchor"]
        if v.get("route"):
            e["route"] = v["route"]
        if v.get("inferred_parent"):
            e["inferred_parent"] = True
        if v["kind"] == "star":
            e["color"] = star_color(v["ltype"] + " " + v["raw"])
            e["failed"] = "failed star" in v["raw"].lower()
        if v["kind"] in ("planet", "moon"):
            e["tint"] = planet_tint(v["ltype"], v["raw"])
            t = (v["ltype"] + " " + v["raw"]).lower()
            e["size"] = "giant" if "giant" in t else "normal"
            e["order"] = numeral(n)
        if v["kind"] == "belt":
            m = re.search(r"between\s+([A-Z][\w-]*(?: [IVX]+))\s+and\s+([A-Z][\w-]*(?: [IVX]+))", v["raw"])
            if m:
                e["between"] = [m.group(1), m.group(2)]
        if v["kind"] in ("planet", "moon", "star", "belt"):
            e["traits"] = traits(v["kind"], v["ltype"], v["raw"])
        return e

    images = {}
    for n, v in notes.items():
        if v["portrait"]:
            img = art_images(VAULT / v["portrait"], v["kind"] in ("planet", "moon", "star", "gate", "belt"))
            if img:
                images[n] = img

    # The crew's own ship: where it is comes from its note's frontmatter
    # (current_location / arriving_from / destination), so moving it is a vault edit.
    crew = None
    ccfg = layout.get("crew_ship")
    cpath = VAULT / f"{ccfg['note']}.md" if ccfg else None
    if cpath and cpath.exists():
        cfm, cbody = read_note(cpath)
        if not (player and cfm.get("publish") in (False, "false", "none")):
            csecs = sections(COMMENT.sub("", MARKED.sub("", cbody)))
            loc = link_target(cfm.get("current_location"))
            csys = loc if loc in systems else system_of(loc)
            if csys:
                crew = {"name": cpath.stem, "file": ccfg["note"], "label": ccfg.get("label", "Crew ship"),
                        "overview": overview(csecs), "sessions": appearances(csecs), "system": csys,
                        "at": loc if loc != csys else None, "from": link_target(cfm.get("arriving_from")),
                        "dest": link_target(cfm.get("destination"))}
                if cfm.get("portrait"):
                    img = art_images(VAULT / cfm["portrait"], False)
                    if img:
                        images[crew["name"]] = img
            else:
                print(f"note: crew ship location {loc!r} is not a placed system or body — ship not drawn")

    # The voyage: each session note's ordered `route:` of places the crew went.
    voyage = []
    on_map = {n for n in notes if system_of(n)} | set(systems)
    for sp in sorted(VAULT.glob("Chapters/*/Sessions/*/*.md")):
        if "Play Notes" in sp.name:
            continue
        sfm, _ = read_note(sp)
        if sfm.get("type") != "session" or not sfm.get("route"):
            continue
        if player and sfm.get("publish") in (False, "false", "none"):
            continue
        stops = []
        for x in sfm["route"]:
            t = link_target(x)
            if t in on_map:
                stops.append(t)
            else:
                print(f"note: {sp.stem}: route stop {x!r} is not on the map — skipped")
        voyage.append({"session": sfm.get("session_number"), "title": sp.stem,
                       "file": str(sp.relative_to(VAULT))[:-3], "stops": stops})
    voyage.sort(key=lambda v: (v["session"] or 0))

    keeper = {}
    for n, v in notes.items():
        if v["keeper"]:
            keeper[n] = v["keeper"]

    for s in systems:
        members = [n for n in notes if system_of(n) == s and n != s]
        bodies = [n for n in members if notes[n]["kind"] in
                  ("star", "planet", "moon", "gate", "station", "belt", "ship")]
        sites = [n for n in members if notes[n]["kind"] in ("site", "region")]
        ents = [entity(n) for n in bodies]
        for n in sites:
            e = entity(n)
            e["host"] = body_of(n)
            ents.append(e)
        v = notes[s]
        out_systems.append({
            "name": s, "short": s.replace(" System", ""), "overview": v["overview"],
            "sessions": v["sessions"], "file": v["file"], "pos": placed[s],
            "profile": layout.get("traffic_profiles", {}).get(s, "settled"),
            "outer_gates": [g for g in layout.get("outer_gates", []) if system_of(g) == s],
            "entities": ents,
        })

    anomalies = []
    for n, cfg in layout.get("anomalies", {}).items():
        v = notes.get(n, {})
        anomalies.append({"name": n, "pos": cfg["pos"], "radius": cfg.get("radius", 20),
                          "overview": v.get("overview", ""), "file": v.get("file"),
                          "sessions": v.get("sessions", [])})

    claimed = {n for s in systems for n in notes if system_of(n) == s} | set(systems)
    claimed |= set(layout.get("anomalies", {}))
    unplaced = [entity(n) for n, v in notes.items()
                if n not in claimed and v["kind"] not in ("route", "region")]

    hidden = []
    if player:
        keeper = {}
    for h in ([] if player else layout.get("keeper", {}).get("hidden_gates", [])):
        text = [t for src in h.get("source_notes", []) for t in notes.get(src, {}).get("keeper", [])]
        hidden.append({**h, "notes": text})

    data = {
        "vault": layout.get("vault_name", VAULT.name),
        "systems": out_systems,
        "routes": routes,
        "anomalies": anomalies,
        "unplaced": unplaced,
        "player": player,
        "page": layout.get("page", {}),
        # The keyword is casual-proofing only, like the base64 below; the real
        # protection is the --player build, which carries no Keeper material.
        "keeper_keyword": None if player else layout.get("keeper", {}).get("keyword", "keeper"),
        "crew": crew,
        "voyage": voyage,
        # Keeper material is base64'd so it isn't readable at a glance in view-source.
        "images": images,
        "keeper": base64.b64encode(json.dumps({"notes": keeper, "hidden_gates": hidden},
                                              ensure_ascii=False).encode()).decode(),
    }

    html = TEMPLATE.read_text(encoding="utf-8")
    html = html.replace("/*__MAP_DATA__*/null", json.dumps(data, ensure_ascii=False))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    n_ent = sum(len(s["entities"]) for s in out_systems)
    print(f"wrote {out_path}: {len(out_systems)} systems, {len(routes)} lanes, "
          f"{n_ent} placed entities, {len(unplaced)} unplaced, {len(keeper)} notes with Keeper text")
    for r in routes:
        print(f"  lane {r['name']}: {r['gates']}")
    if unplaced:
        print("  unplaced:", ", ".join(e["name"] for e in unplaced))


if __name__ == "__main__":
    main()
