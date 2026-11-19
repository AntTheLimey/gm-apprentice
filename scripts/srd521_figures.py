#!/usr/bin/env python3
"""Read each creature's size, Initiative and Speed from the official SRD 5.2.1.

A dev script. It runs `pdftotext -bbox-layout` on the WotC SRD 5.2.1 PDF
(CC-BY 4.0; the PDF is not part of this repo) and writes
`scripts/srd521-figures.json`: name -> {size, init, init_score, speed}.
`srd-monster-enricher.py` reads that file. Run it when the SRD changes:

    python3 scripts/srd521_figures.py SRD_CC_v5.2.1.pdf

The stat blocks sit in two columns and the text flow interleaves them, so the
blocks are found by position: a size line ("Huge Dragon (Metallic), Chaotic
Good") starts a block, the line above it is the name, and the AC, Initiative,
HP and Speed lines sit under it in the same column.

It prints every shipped creature it could not find, by name.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "srd521-figures.json"
SHIPPED = HERE.parent / "skills" / "ttrpg-expert" / "systems" / "dnd-5e-2024"

SIZES = "Tiny|Small|Medium|Large|Huge|Gargantuan"
SIZE_LINE = re.compile(
    rf"^(?P<size>(?:{SIZES})(?: or (?:{SIZES}))?) (?P<rest>[A-Z].*,.*"
    r"(?:Lawful|Chaotic|Neutral|Unaligned|Evil|Good|Any).*)$")
INIT_RE = re.compile(r"\bInitiative\s+([+-]\d+)\s*\((\d+)\)")
LABELS = ("AC ", "Initiative", "HP ", "Speed ")
LINE_RE = re.compile(
    r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">'
    r"(.*?)</line>", re.S)
WORD_RE = re.compile(r">([^<]*)</word>")
PAGE_RE = re.compile(r"<page ")
COLUMN_SLACK = 4.0
FRAME_DEPTH = 80.0
FRAME_WIDTH = 180.0
NAME_GAP = 40.0


def clean(text):
    text = text.replace("−", "-").replace("–", "-")
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&#39;", "'").replace("&quot;", '"')
    text = text.replace("\u2019", "'")
    return re.sub(r"\s+", " ", text).strip()


def read_lines(pdf):
    """Every text line of the PDF as (page, x, ytop, ybottom, text)."""
    xml = subprocess.run(["pdftotext", "-bbox-layout", str(pdf), "-"],
                         check=True, capture_output=True, text=True).stdout
    out = []
    page = 0
    pos = 0
    for m in LINE_RE.finditer(xml):
        page += len(PAGE_RE.findall(xml, pos, m.start()))
        pos = m.start()
        text = clean(" ".join(WORD_RE.findall(m.group(5))))
        if text:
            out.append((page, float(m.group(1)), float(m.group(2)),
                        float(m.group(4)), text))
    return out


def parse_blocks(lines):
    by_page = {}
    for ln in lines:
        by_page.setdefault(ln[0], []).append(ln)
    found = {}
    for page_lines in by_page.values():
        for head in page_lines:
            page, hx, hy, hb, htext = head
            sm = SIZE_LINE.match(htext)
            if not sm:
                continue
            col = [ln for ln in page_lines if abs(ln[1] - hx) <= COLUMN_SLACK]
            above = [ln for ln in col if ln[3] <= hy + 2 and hy - ln[3] < NAME_GAP]
            name = max(above, key=lambda ln: ln[3])[4] if above else None
            wide = [ln for ln in page_lines
                    if hx - COLUMN_SLACK <= ln[1] < hx + FRAME_WIDTH]
            stops = [ln[2] for ln in wide
                     if ln[2] > hy + 1 and SIZE_LINE.match(ln[4])]
            limit = min([hy + FRAME_DEPTH, *stops])
            frame = sorted((ln for ln in wide if hy - 1 <= ln[2] < limit),
                           key=lambda ln: (round(ln[2]), ln[1]))
            fig = {"size": sm["size"], "init": None, "init_score": None,
                   "speed": None}
            for i, ln in enumerate(frame):
                text = ln[4]
                im = INIT_RE.search(text)
                if im and fig["init"] is None:
                    fig["init"], fig["init_score"] = im[1], int(im[2])
                elif text.startswith("Speed ") and fig["speed"] is None:
                    speed = text[6:]
                    for nxt in frame[i + 1:]:
                        if nxt[2] - ln[3] > 3 or nxt[4].startswith(LABELS) \
                                or not re.match(r"[a-z0-9(]", nxt[4]):
                            break
                        speed += " " + nxt[4]
                        ln = nxt
                    fig["speed"] = speed.strip()
            found.setdefault(name, []).append((page, hy, fig))
    return found


def shipped_names():
    names = []
    for path in [*sorted(SHIPPED.glob("monsters-cr*.md")),
                 SHIPPED / "animals.md"]:
        names += re.findall(r"^\*\*([^*]+)\*\* \| ", path.read_text("utf-8"), re.M)
    return names


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pdf", type=Path, help="SRD_CC_v5.2.1.pdf")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    found = parse_blocks(read_lines(args.pdf))
    figures = {}
    for name, hits in found.items():
        if name is None:
            continue
        for _, _, fig in hits:
            figures.setdefault(name, fig)
    ship = shipped_names()
    folded = {n.casefold(): n for n in figures}
    missing, incomplete = [], []
    for n in ship:
        key = folded.get(n.casefold())
        if key is None:
            missing.append(n)
        elif not all(figures[key].values()) and figures[key]["init"] is None:
            incomplete.append(n)
    args.out.write_text(json.dumps(dict(sorted(figures.items())), indent=1,
                                   ensure_ascii=False) + "\n", "utf-8")
    print(f"{len(figures)} SRD blocks read; {len(ship) - len(missing)} of "
          f"{len(ship)} shipped creatures found", file=sys.stderr)
    for n in missing:
        print(f"NOT FOUND: {n}", file=sys.stderr)
    for n in incomplete:
        print(f"NO INITIATIVE: {n}", file=sys.stderr)


if __name__ == "__main__":
    main()
