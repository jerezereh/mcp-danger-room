#!/usr/bin/env python3
"""
Build the symbol key handed to the OCR extractor.

Every glyph is cropped from a real card scan rather than drawn, so the model
matches against the exact rendering it will meet on the cards it transcribes.
That is the point: describing these icons in prose produced a string of wrong
readings — "filled star", "yellow vs white" — because the descriptions were
mine and the icons are not describable in a sentence.

Crop coordinates were found by locating each badge's circle in the scan and
were checked by eye. Re-run after changing them:

    python3 scripts/build-symbol-key.py
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CARDS = ROOT / '.import' / 'card-images'
OUT = ROOT / 'assets' / 'symbol-key.png'

B, D = 'BASTION_healthy.png', 'DORMAMMU_healthy.png'
G, R, E = 'GLADIATOR_healthy.png', 'RONIN_healthy.png', 'ECHO_healthy.png'

# (label, source card, crop box). Order groups related glyphs together.
ITEMS = [
    ('{PHYS}',     B, (28, 121, 83, 174)),
    ('{ENRG}',     B, (138, 121, 193, 174)),
    ('{MYST}',     B, (248, 121, 301, 174)),
    ('{DMG}',      D, (795, 104, 825, 136)),
    ('{PWR}',      B, (1298, 43, 1339, 84)),
    ('{RNG}',      B, (1146, 43, 1189, 84)),
    ('{THREAT}',   B, (200, 179, 255, 232)),
    ('{SIZE}',     B, (74, 242, 129, 295)),
    ('{CRIT}',     D, (546, 280, 576, 312)),
    ('{WILD}',     D, (586, 280, 616, 312)),
    ('{HIT}',      D, (626, 280, 656, 312)),
    ('{BLOCK}',    R, (1110, 154, 1142, 186)),
    ('{FAIL}',     D, (666, 280, 696, 312)),
    ('{S}',        G, (1456, 415, 1487, 447)),
    ('{L}',        G, (1644, 675, 1675, 707)),
    ('{ACTIVE}',   B, (392, 489, 443, 539)),
    ('{REACTIVE}', B, (394, 602, 445, 652)),
    ('{INNATE}',   B, (392, 740, 443, 790)),
    ('Leadership', B, (392, 349, 443, 399)),
]

CELL, ICON, COLS = 160, 108, 4
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'


def main() -> None:
    rows = (len(ITEMS) + COLS - 1) // COLS
    out = Image.new('RGB', (CELL * COLS + 16, (CELL + 30) * rows + 16), 'white')
    draw = ImageDraw.Draw(out)
    font = ImageFont.truetype(FONT, 21)
    cache: dict[str, Image.Image] = {}

    for i, (label, card, box) in enumerate(ITEMS):
        if card not in cache:
            cache[card] = Image.open(CARDS / card).convert('RGB')
        glyph = cache[card].crop(box)
        scale = ICON / max(glyph.size)
        glyph = glyph.resize(
            (max(1, round(glyph.width * scale)), max(1, round(glyph.height * scale))),
            Image.LANCZOS,
        )

        r, c = divmod(i, COLS)
        x, y = 8 + c * CELL, 8 + r * (CELL + 30)
        out.paste(glyph, (x + (CELL - glyph.width) // 2, y + (ICON - glyph.height) // 2 + 10))
        w = draw.textlength(label, font=font)
        draw.text((x + (CELL - w) // 2, y + ICON + 22), label, fill='black', font=font)
        draw.rectangle([x + 4, y + 2, x + CELL - 4, y + ICON + 50], outline=(205, 205, 205))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT)
    print(f'{OUT.relative_to(ROOT)}  {out.size[0]}x{out.size[1]}  {len(ITEMS)} glyphs')


if __name__ == '__main__':
    main()
