"""Genera img/hotel.jpg (ilustración provisional) e icons/*.png.
Si existe img/hotel-foto.jpg (tu foto real), los íconos se hacen con ella.
Uso: python3 tools/generar_imagenes.py"""
import os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
random.seed(7)

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def hotel(W=1600, H=900):
    im = Image.new('RGB', (W, H)); d = ImageDraw.Draw(im)
    for y in range(H):  # cielo de atardecer
        t = y / H
        d.line([(0, y), (W, y)], fill=lerp((198, 222, 234), (247, 226, 196), t ** 1.4))
    def tower(x0, x1, top, base, skew, cols, rows, tint):
        d.polygon([(x0 + skew, top), (x1 - skew, top), (x1, base), (x0, base)], fill=(238, 236, 230))
        d.polygon([(x1 - skew, top), (x1 - skew + 40, top + 30), (x1 + 40, base), (x1, base)], fill=(205, 203, 198))
        for r in range(rows):
            ty = top + 30 + r * (base - top - 60) / rows
            t = (ty - top) / (base - top)
            l = x0 + skew * (1 - t); rr = x1 - skew * (1 - t)
            cw = (rr - l - 30) / cols
            for c in range(cols):
                wx = l + 15 + c * cw
                g = random.randint(-18, 18)
                col = (max(0, tint[0] + g), max(0, tint[1] + g), max(0, tint[2] + g))
                if random.random() < 0.07: col = (255, 214, 140)
                d.rectangle([wx + 4, ty + 4, wx + cw - 4, ty + (base - top - 60) / rows - 6], fill=col)
    tower(260, 900, 70, 700, 120, 9, 15, (28, 140, 140))
    tower(980, 1420, 150, 720, 60, 8, 16, (22, 120, 105))
    d.rectangle([980, 690, 1600, 730], fill=(34, 150, 70))
    d.rectangle([0, 690, W, 900], fill=(150, 120, 90))
    for i in range(6):  # arcos de piedra iluminados
        x = 80 + i * 150
        d.rectangle([x, 720, x + 120, 880], fill=(255, 190, 110))
        d.ellipse([x, 680, x + 120, 780], fill=(255, 190, 110))
    d.rectangle([0, 870, W, 900], fill=(90, 90, 95))
    return im.filter(ImageFilter.GaussianBlur(1.2))

photo = os.path.join(ROOT, 'img', 'hotel-foto.jpg')
dest = os.path.join(ROOT, 'img', 'hotel.jpg')
if os.path.exists(photo):
    base = Image.open(photo).convert('RGB'); base.save(dest, quality=85)
elif not os.path.exists(dest):
    base = hotel(); base.save(dest, quality=82)
else:
    base = Image.open(dest).convert('RGB')

def icon(size, maskable=False):
    s = min(base.size); crop = base.crop(((base.width - s) // 2 - s // 6 if base.width > s else 0, 0, ((base.width - s) // 2 - s // 6 if base.width > s else 0) + s, s))
    crop = crop.resize((size, size), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=0 if maskable else size // 5, fill=255)
    out.paste(crop, (0, 0), mask)
    d = ImageDraw.Draw(out); b = int(size * 0.46); p = size - b - (int(size * .12) if maskable else int(size * .04))
    d.rounded_rectangle([p, p, p + b, p + b], radius=b // 6, fill=(33, 115, 70), outline=(255, 255, 255), width=max(2, size // 64))
    try: f = ImageFont.truetype('DejaVuSans-Bold.ttf', int(b * .62))
    except OSError: f = ImageFont.load_default()
    d.text((p + b / 2, p + b / 2), 'X', font=f, fill='white', anchor='mm')
    return out

for n in (192, 512): icon(n).save(os.path.join(ROOT, 'icons', f'icon-{n}.png'))
icon(512, True).save(os.path.join(ROOT, 'icons', 'icon-maskable-512.png'))
print('listo')
