"""Rebuild the editable flyer assets from the original Illustrator PDF.

Usage:  python3 tools/extract_from_pdf.py path/to/flyer.pdf

Writes:
  assets/vectors/*.svg   vector artwork lifted from the PDF (logo, badges, icons)
  assets/photos/*.jpg    photo crops from the flattened background image
  assets/badges/*.png    QR codes and store badges

Requires: pymupdf, pillow
"""
import io
import os
import sys

import pymupdf
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_VEC = os.path.join(ROOT, "assets", "vectors")
OUT_PHOTO = os.path.join(ROOT, "assets", "photos")
OUT_BADGE = os.path.join(ROOT, "assets", "badges")

SAMPLE_DPI = 288
S = SAMPLE_DPI / 72.0

# Vector groups: name -> (x0, y0, x1, y1) in PDF points, plus boxes to exclude.
VECTOR_GROUPS = {
    "logo": ((14, 7, 300, 92), [(196, 6, 293, 36)]),
    "flags": ((196, 6, 293, 36), []),
    "pin": ((320, 18, 373, 86), []),
    "skyline": ((492, 20, 582, 94), []),
    "halal-badge": ((43, 222, 103, 282), []),
    "clock-24": ((129, 226, 186, 281), []),
    "truck": ((217, 228, 286, 277), []),
    "gift": ((19, 717, 77, 777), []),
    "check-badge": ((48, 797, 89, 837), []),
    "globe": ((448, 805, 472, 829), []),
}

# Photo crops from the background raster, in PDF points: (x0, y0, x1, y1).
PHOTO_CROPS = {
    "hero-meat": (336, 98, 586, 293),
    "beef": (14, 338, 156, 411),
    "lamb": (162, 338, 296, 411),
    "chicken": (302, 338, 439, 411),
    "seafood": (445, 338, 584, 411),
    "rice-grains": (14, 455, 159, 553),
    "spices": (164, 455, 314, 553),
    "dairy-eggs": (319, 455, 442, 553),
    "frozen": (448, 455, 584, 553),
    "pantry": (14, 600, 166, 696),
    "baking": (171, 600, 321, 696),
    "app-phone-city": (281, 553, 595.276, 798),
    "bottom-band": (0, 690, 595.276, 841.89),
}

# Areas inside a crop that were old baked-in artwork, painted flat so nothing
# stale shows through if an element on top is moved. Coordinates in points.
PAINT_OVER = {
    "app-phone-city": [((325, 555, 460, 716), (11, 67, 49)),
                       ((281, 553, 325, 716), (255, 252, 246)),
                       ((281, 553, 460, 555), (255, 252, 246))],
    "bottom-band": [((13, 699, 283, 795), (9, 52, 34)),
                    ((23, 795, 368, 841.89), (9, 52, 34)),
                    ((436, 795, 592, 841.89), (9, 52, 34))],
}


def fmt(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def path_d(items, ox, oy):
    d, cur = [], None

    def pt(p):
        return f"{fmt(p.x - ox)} {fmt(p.y - oy)}"

    for it in items:
        kind = it[0]
        if kind == "re":
            r = it[1]
            d.append(f"M{fmt(r.x0-ox)} {fmt(r.y0-oy)}H{fmt(r.x1-ox)}V{fmt(r.y1-oy)}H{fmt(r.x0-ox)}Z")
            cur = None
            continue
        if kind == "qu":
            q = it[1]
            d.append(f"M{pt(q.ul)}L{pt(q.ur)}L{pt(q.lr)}L{pt(q.ll)}Z")
            cur = None
            continue
        start = it[1]
        if cur is None or abs(start.x - cur.x) > 0.01 or abs(start.y - cur.y) > 0.01:
            if d and cur is not None:
                d.append("Z")
            d.append(f"M{pt(start)}")
        if kind == "l":
            d.append(f"L{pt(it[2])}")
            cur = it[2]
        elif kind == "c":
            d.append(f"C{pt(it[2])} {pt(it[3])} {pt(it[4])}")
            cur = it[4]
    d.append("Z")
    return "".join(d)


def items_rect(items):
    pts = []
    for it in items:
        if it[0] == "re":
            pts += [it[1].tl, it[1].br]
        elif it[0] == "qu":
            pts += [it[1].ul, it[1].lr]
        else:
            pts += list(it[1:])
    xs = [p.x for p in pts if hasattr(p, "x")]
    ys = [p.y for p in pts if hasattr(p, "y")]
    return pymupdf.Rect(min(xs), min(ys), max(xs), max(ys))


def hexcol(rgb):
    return "#" + "".join(f"{max(0, min(255, round(c * 255))):02x}" for c in rgb)


def inside(r, box):
    x0, y0, x1, y1 = box
    return r.x0 >= x0 - 0.5 and r.y0 >= y0 - 0.5 and r.x1 <= x1 + 0.5 and r.y1 <= y1 + 0.5


def sample_gradient(ref, items, even_odd):
    """Rasterise the clip shape and sample the rendered colour at its top and bottom."""
    mask = Image.new("L", ref.size, 0)
    dr = ImageDraw.Draw(mask)
    polys, cur = [], []
    for it in items:
        if it[0] == "re":
            r = it[1]
            polys.append([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)])
            continue
        if it[0] == "qu":
            q = it[1]
            polys.append([q.ul, q.ur, q.lr, q.ll])
            continue
        if cur and (abs(it[1].x - cur[-1][0]) > 0.01 or abs(it[1].y - cur[-1][1]) > 0.01):
            polys.append(cur)
            cur = []
        if not cur:
            cur.append((it[1].x, it[1].y))
        if it[0] == "l":
            cur.append((it[2].x, it[2].y))
        else:
            p0, c1, c2, p3 = it[1], it[2], it[3], it[4]
            for i in range(1, 9):
                t = i / 8
                mt = 1 - t
                x = mt**3*p0.x + 3*mt*mt*t*c1.x + 3*mt*t*t*c2.x + t**3*p3.x
                y = mt**3*p0.y + 3*mt*mt*t*c1.y + 3*mt*t*t*c2.y + t**3*p3.y
                cur.append((x, y))
    if cur:
        polys.append(cur)
    for poly in polys:
        if len(poly) > 2:
            dr.polygon([(x * S, y * S) for x, y in poly], fill=255)
    bbox = mask.getbbox()
    if not bbox:
        return None
    x0, y0, x1, y1 = bbox
    h = y1 - y0
    px, mp = ref.load(), mask.load()

    def avg(ya, yb):
        tot, n = [0, 0, 0], 0
        for y in range(ya, yb):
            for x in range(x0, x1):
                if mp[x, y]:
                    c = px[x, y]
                    tot[0] += c[0]; tot[1] += c[1]; tot[2] += c[2]; n += 1
        return tuple(t / n / 255 for t in tot) if n else None

    top = avg(y0, y0 + max(1, h // 5))
    bot = avg(y1 - max(1, h // 5), y1)
    return top, bot


def extract_vectors(page, ref):
    os.makedirs(OUT_VEC, exist_ok=True)
    drawings = page.get_drawings(extended=True)
    for name, (box, excludes) in VECTOR_GROUPS.items():
        x0, y0, x1, y1 = box
        parts, defs, grad_n = [], [], 0
        for dwg in drawings:
            if dwg["type"] not in ("f", "clip"):
                continue
            r = dwg.get("rect") if dwg["type"] == "f" else dwg.get("scissor")
            if r is None or not inside(r, box) or r.width < 0.3 and r.height < 0.3:
                continue
            if any(inside(r, ex) for ex in excludes):
                continue
            if r.width > (x1 - x0) * 0.97 and r.height > (y1 - y0) * 0.97 and name not in ("flags", "halal-badge", "check-badge", "globe"):
                continue
            if not inside(items_rect(dwg["items"]), box):
                continue
            even_odd = dwg.get("even_odd", False)
            d = path_d(dwg["items"], x0, y0)
            rule = ' fill-rule="evenodd"' if even_odd else ""
            if dwg["type"] == "f":
                parts.append(f'<path d="{d}" fill="{hexcol(dwg["fill"])}"{rule}/>')
            else:
                g = sample_gradient(ref, dwg["items"], even_odd)
                if not g or not g[0]:
                    continue
                top, bot = g
                if max(abs(a - b) for a, b in zip(top, bot)) < 0.03:
                    parts.append(f'<path d="{d}" fill="{hexcol(top)}"{rule}/>')
                else:
                    gid = f"{name}-g{grad_n}"
                    grad_n += 1
                    defs.append(f'<linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1">'
                                f'<stop offset="0" stop-color="{hexcol(top)}"/>'
                                f'<stop offset="1" stop-color="{hexcol(bot)}"/></linearGradient>')
                    parts.append(f'<path d="{d}" fill="url(#{gid})"{rule}/>')
        w, h = x1 - x0, y1 - y0
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(w)} {fmt(h)}">'
               + (f"<defs>{''.join(defs)}</defs>" if defs else "") + "".join(parts) + "</svg>\n")
        with open(os.path.join(OUT_VEC, f"{name}.svg"), "w") as fh:
            fh.write(svg)
        print(f"vector {name}: {len(parts)} paths")


def load_image(doc, xref):
    pix = pymupdf.Pixmap(doc, xref)
    if pix.alpha:
        pix = pymupdf.Pixmap(pix, 0)
    if pix.colorspace and pix.colorspace.n != 3:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    return Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")


def extract_photos(doc, page):
    os.makedirs(OUT_PHOTO, exist_ok=True)
    os.makedirs(OUT_BADGE, exist_ok=True)
    infos = {i["xref"]: i["bbox"] for i in page.get_image_info(xrefs=True) if i["xref"]}
    bg_xref = max(infos, key=lambda x: (infos[x][2] - infos[x][0]) * (infos[x][3] - infos[x][1]))
    bg = load_image(doc, bg_xref)
    bb = infos[bg_xref]
    sx = bg.width / (bb[2] - bb[0])
    sy = bg.height / (bb[3] - bb[1])
    for name, (x0, y0, x1, y1) in PHOTO_CROPS.items():
        crop = bg.crop((round((x0 - bb[0]) * sx), round((y0 - bb[1]) * sy),
                        round((x1 - bb[0]) * sx), round((y1 - bb[1]) * sy)))
        dr = ImageDraw.Draw(crop)
        for (px0, py0, px1, py1), col in PAINT_OVER.get(name, []):
            dr.rectangle((round((px0 - x0) * sx), round((py0 - y0) * sy),
                          round((px1 - x0) * sx), round((py1 - y0) * sy)), fill=col)
        crop.save(os.path.join(OUT_PHOTO, f"{name}.jpg"), quality=90)
        print(f"photo {name}: {crop.size}")
    # The remaining small images are the QR codes and store badges.
    small = sorted((x for x in infos if x != bg_xref and (infos[x][2] - infos[x][0]) < 80),
                   key=lambda x: (round(infos[x][1] / 20), infos[x][0]))
    names = ["qr-app-store", "qr-google-play", "badge-app-store", "badge-google-play"]
    by_pos = {}
    for x in small:
        r = infos[x]
        kind = "qr" if (r[3] - r[1]) > 30 else "badge"
        side = "app-store" if r[0] < 395 else "google-play"
        by_pos[f"{kind}-{side}"] = x
    for name in names:
        x = by_pos.get(name)
        if not x:
            continue
        img = load_image(doc, x)
        img.save(os.path.join(OUT_BADGE, f"{name}.png"))
        print(f"badge {name}: {img.size}")


def main():
    src = sys.argv[1]
    doc = pymupdf.open(src)
    page = doc[0]
    extract_photos(doc, page)
    # Reference render of the vector layer only, for sampling gradient colours.
    blank = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 2, 2), 1)
    blank.clear_with(0)
    for info in page.get_image_info(xrefs=True):
        if info["xref"]:
            try:
                page.replace_image(info["xref"], pixmap=blank)
            except Exception:
                pass
    pix = page.get_pixmap(dpi=SAMPLE_DPI)
    ref = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    extract_vectors(page, ref)


if __name__ == "__main__":
    main()
