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
# Individual glyphs for the web client, so the app renders the real icons
# rather than the unicode lookalikes it had been standing in with.
GLYPH_DIR = ROOT.parent.parent / 'apps' / 'web' / 'src' / 'assets' / 'symbols'
GLYPH_PX = 64

B, D = 'BASTION_healthy.png', 'DORMAMMU_healthy.png'
G, R, I = 'GLADIATOR_healthy.png', 'RONIN_healthy.png', 'IRON_LAD_healthy.png'

# (symbol key, printed token, source card, crop box).
#
# The key is the identity the code uses (`SymbolKey` in symbols.ts); the token
# is what gets written into card text. They differ for half the symbols —
# `power` is written `{PWR}` — and naming the emitted files after the token
# meant the app looked up `power.png` and found `pwr.png`, so ten of nineteen
# icons silently fell back to text. Files are named by key.
ITEMS = [
    ('physical',   '{PHYS}',     B, (28, 121, 83, 174)),
    ('energy',     '{ENRG}',     B, (138, 121, 193, 174)),
    ('mystic',     '{MYST}',     B, (248, 121, 301, 174)),
    ('damage',     '{DMG}',      D, (795, 104, 825, 136)),
    ('power',      '{PWR}',      B, (1298, 43, 1339, 84)),
    ('range',      '{RNG}',      B, (1146, 43, 1189, 84)),
    ('threat',     '{THREAT}',   B, (200, 179, 255, 232)),
    ('size',       '{SIZE}',     B, (74, 242, 129, 295)),
    ('critical',   '{CRIT}',     D, (546, 280, 576, 312)),
    ('wild',       '{WILD}',     D, (586, 280, 616, 312)),
    ('hit',        '{HIT}',      D, (626, 280, 656, 312)),
    ('block',      '{BLOCK}',    R, (1110, 154, 1142, 186)),
    ('fail',       '{FAIL}',     D, (666, 280, 696, 312)),
    # Blank is a die result with no icon — the cards spell it out.
    ('blank',      '{BLANK}',    R, (1274, 152, 1342, 190)),
    ('short',      '{S}',        G, (1456, 415, 1487, 447)),
    ('medium',     '{M}',        I, (1442, 757, 1474, 789)),
    ('long',       '{L}',        G, (1644, 675, 1675, 707)),
    ('active',     '{ACTIVE}',   B, (392, 489, 443, 539)),
    ('reactive',   '{REACTIVE}', B, (394, 602, 445, 652)),
    ('innate',     '{INNATE}',   B, (392, 740, 443, 790)),
    ('strength',   '{STRENGTH}', B, (1222, 43, 1263, 84)),
    ('leadership', '{LEADERSHIP}', B, (392, 349, 443, 399)),
]

# Stat-box icons the tokenizer has no token for — they never appear inline, so
# they are not SymbolKeys and are not in the key sheet the extractor is shown.
# The app needs them to draw a stat box that looks like the printed one.
EXTRAS = [
    ('stamina',  B, (74, 179, 129, 232)),
    ('movement', B, (200, 241, 255, 295)),
]

CELL, COLS = 96, 4
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'


def _corner(img: Image.Image) -> tuple[int, int, int]:
    """The card background behind this glyph, sampled from its corners.

    Squaring a crop needs a fill, and the badges sit on a pale card stock that
    varies by card. Averaging the corners keeps the padding invisible instead
    of ringing the icon in white.
    """
    w, h = img.size
    pts = [img.getpixel(p) for p in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    return tuple(sum(c[i] for c in pts) // len(pts) for i in range(3))  # type: ignore[return-value]


def main() -> None:
    rows = (len(ITEMS) + COLS - 1) // COLS
    band = CELL + 26
    out = Image.new('RGB', (CELL * COLS + 12, band * rows + 12), 'white')
    draw = ImageDraw.Draw(out)
    font = ImageFont.truetype(FONT, 13)
    cache: dict[str, Image.Image] = {}

    for i, (_key, label, card, box) in enumerate(ITEMS):
        if card not in cache:
            cache[card] = Image.open(CARDS / card).convert('RGB')
        glyph = cache[card].crop(box)

        r, c = divmod(i, COLS)
        x, y = 6 + c * CELL, 6 + r * band
        out.paste(glyph, (x + (CELL - glyph.width) // 2, y + (CELL - glyph.height) // 2))
        w = draw.textlength(label, font=font)
        draw.text((x + (CELL - w) // 2, y + CELL + 4), label, fill='black', font=font)
        draw.rectangle([x + 2, y + 2, x + CELL - 2, y + CELL + 22], outline=(205, 205, 205))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT)
    print(f'{OUT.relative_to(ROOT)}  {out.size[0]}x{out.size[1]}  {len(ITEMS)} glyphs')

    # One file per token, squared and normalised so they sit on a text line at
    # a consistent weight. Blank is skipped: it has no icon, and the app
    # renders the word, which is what the cards do.
    GLYPH_DIR.mkdir(parents=True, exist_ok=True)
    written = 0
    for key, label, card, box in ITEMS:
        if key == 'blank':
            continue
        name = f'{key}.png'
        glyph = cache[card].crop(box)
        side = max(glyph.size)
        square = Image.new('RGB', (side, side), _corner(glyph))
        square.paste(glyph, ((side - glyph.width) // 2, (side - glyph.height) // 2))
        square.resize((GLYPH_PX, GLYPH_PX), Image.LANCZOS).save(GLYPH_DIR / name)
        written += 1
    for key, card, box in EXTRAS:
        glyph = cache[card].crop(box)
        side = max(glyph.size)
        square = Image.new('RGB', (side, side), _corner(glyph))
        square.paste(glyph, ((side - glyph.width) // 2, (side - glyph.height) // 2))
        square.resize((GLYPH_PX, GLYPH_PX), Image.LANCZOS).save(GLYPH_DIR / f'{key}.png')
        written += 1

    print(f'{GLYPH_DIR.relative_to(ROOT.parent.parent)}  {written} glyphs at {GLYPH_PX}px')


if __name__ == '__main__':
    main()
