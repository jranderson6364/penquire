"""Draws the toolbar line icons (24-unit grid, 1.75 stroke, round caps) as white-on-transparent PNGs; the app tints them."""
import math, os
from PIL import Image, ImageDraw

SS = 16          # supersample
G = 24
OUT = 96         # px (24pt @4x)
W = 1.8

def new():
    return Image.new("L", (G * SS, G * SS), 0)

def P(p):
    return (p[0] * SS, p[1] * SS)

def line(d, a, b, w=W):
    d.line([P(a), P(b)], fill=255, width=int(w * SS))
    r = w * SS / 2
    for q in (a, b):
        x, y = P(q)
        d.ellipse([x - r, y - r, x + r, y + r], fill=255)

def poly(d, pts, closed=False, w=W):
    for i in range(len(pts) - 1):
        line(d, pts[i], pts[i + 1], w)
    if closed:
        line(d, pts[-1], pts[0], w)

def arc(d, c, r, a0, a1, w=W, n=40):
    pts = [(c[0] + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), c[1] + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]
    poly(d, pts, False, w)

def circle(d, c, r, w=W, fill=False):
    if fill:
        x, y = P(c); rr = r * SS
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=255)
    else:
        arc(d, c, r, 0, 360, w, 48)

def add(a, b): return (a[0] + b[0], a[1] + b[1])
def mul(a, k): return (a[0] * k, a[1] * k)

D = (math.sqrt(.5), -math.sqrt(.5))   # up-right
N = (math.sqrt(.5), math.sqrt(.5))    # perpendicular

def rod(d, tip, s_len, e_len, hw, collar=True, clip=False):
    S = add(tip, mul(D, s_len)); E = add(tip, mul(D, e_len))
    poly(d, [tip, add(S, mul(N, hw)), add(E, mul(N, hw)), add(E, mul(N, -hw)), add(S, mul(N, -hw))], True)
    if collar:
        line(d, add(S, mul(N, hw)), add(S, mul(N, -hw)))
    return S, E

icons = {}

def icon(name):
    def deco(fn):
        im = new(); d = ImageDraw.Draw(im); fn(d); icons[name] = im
        return fn
    return deco

@icon("pen")
def _(d):
    S, E = rod(d, (3.6, 20.4), 4.2, 19.5, 2.1)
    line(d, add(E, mul(N, 2.1 + 0.0)), add(add(E, mul(N, 2.1)), mul(D, -4.5)), 1.4)

@icon("fountain")
def _(d):
    tip = (3.6, 20.4)
    S = add(tip, mul(D, 6.5)); E = add(tip, mul(D, 19.5))
    poly(d, [tip, add(S, mul(N, 2.6)), add(E, mul(N, 2.1)), add(E, mul(N, -2.1)), add(S, mul(N, -2.6))], True)
    line(d, tip, add(tip, mul(D, 3.4)), 1.4)
    circle(d, add(tip, mul(D, 5.4)), 0.7, 1.4)
    line(d, add(S, mul(N, 2.6)), add(S, mul(N, -2.6)))

@icon("pencil")
def _(d):
    tip = (3.4, 20.6)
    S = add(tip, mul(D, 4.6)); E = add(tip, mul(D, 19.0)); M = add(tip, mul(D, 16.0))
    poly(d, [tip, add(S, mul(N, 2.3)), add(E, mul(N, 2.3)), add(E, mul(N, -2.3)), add(S, mul(N, -2.3))], True)
    line(d, add(S, mul(N, 2.3)), add(S, mul(N, -2.3)))
    line(d, add(M, mul(N, 2.3)), add(M, mul(N, -2.3)))
    circle(d, add(tip, mul(D, 1.3)), 0.6, 1.2, True)

@icon("highlighter")
def _(d):
    base = (4.0, 17.2)
    S = add(base, mul(D, 1.0)); E = add(base, mul(D, 15.5))
    hw = 3.2
    poly(d, [add(base, mul(N, hw * .55)), add(S, mul(N, hw)), add(E, mul(N, hw)), add(E, mul(N, -hw)), add(S, mul(N, -hw)), add(base, mul(N, -hw * .55))], True)
    line(d, add(base, mul(N, hw * .55)), add(base, mul(N, -hw * .55)))
    line(d, add(S, mul(N, hw)), add(S, mul(N, -hw)))
    line(d, (3, 21.5), (11.5, 21.5), 2.2)

@icon("eraser")
def _(d):
    c = (12, 12)
    def R(p, ang):
        a = math.radians(ang); x, y = p[0] - c[0], p[1] - c[1]
        return (c[0] + x * math.cos(a) - y * math.sin(a), c[1] + x * math.sin(a) + y * math.cos(a))
    body = [(4, 9), (20, 9), (20, 16), (4, 16)]
    pts = [R(p, -42) for p in body]
    poly(d, pts, True)
    line(d, R((11, 9), -42), R((11, 16), -42))
    line(d, (6, 21), (19, 21))

@icon("lasso")
def _(d):
    n = 14
    for i in range(n):
        a0 = i * 360 / n + 4; a1 = a0 + 360 / n - 14
        pts = [(11.5 + 8.2 * math.cos(math.radians(a0 + (a1 - a0) * t / 6)), 10 + 6.2 * math.sin(math.radians(a0 + (a1 - a0) * t / 6))) for t in range(7)]
        poly(d, pts, False, 1.9)
    poly(d, [(8.6, 15.6), (7.4, 19), (9.4, 21), (12.2, 20.2)], False, 1.7)

@icon("ruler")
def _(d):
    S = (3.5, 17.5); E = (17.5, 3.5)
    a = (S[0] - 1.6, S[1] - 1.6); b = (S[0] + 1.6, S[1] + 1.6)
    poly(d, [(3.2, 15.8), (15.8, 3.2), (20.8, 8.2), (8.2, 20.8)], True)
    for i, t in enumerate([.22, .4, .58, .76]):
        p = (3.2 + (20.8 - 3.2) * 0 + (8.2 - 3.2) * 0, 0)
    for k in range(1, 5):
        t = k / 5
        p0 = (3.2 + (15.8 - 3.2) * t, 15.8 + (3.2 - 15.8) * t)
        ln = 2.6 if k % 2 else 1.6
        line(d, p0, (p0[0] + ln * math.sqrt(.5), p0[1] + ln * math.sqrt(.5)), 1.4)

@icon("undo")
def _(d):
    arc(d, (13.2, 14.5), 6.6, 200, 360 + 20, W)
    poly(d, [(8.4, 5.2), (5.4, 8.8), (9.6, 10.6)][:2], False)
    line(d, (5.4, 8.8), (10.2, 9.4))
    line(d, (5.4, 8.8), (5.8, 4.4))

@icon("redo")
def _(d):
    arc(d, (10.8, 14.5), 6.6, -20, 160 - 360 + 360 + 0 if False else -20 - 180 - 0 , W) if False else None
    arc(d, (10.8, 14.5), 6.6, 340, 520 - 360 + 360 - 180 if False else 160 + 360 - 360, W) if False else None
    # mirror of undo
    pass

@icon("question")
def _(d):
    poly(d, [(5.5, 3.5), (18.5, 3.5), (18.5, 20.5), (5.5, 20.5)], True)
    for y in (8.5, 12, 15.5):
        line(d, (8.6, y), (15.4, y), 1.5)

@icon("chevron-left")
def _(d): poly(d, [(14.5, 5), (7.5, 12), (14.5, 19)], False, 2.1)

@icon("chevron-right")
def _(d): poly(d, [(9.5, 5), (16.5, 12), (9.5, 19)], False, 2.1)

@icon("chevron-down")
def _(d): poly(d, [(5.5, 9.5), (12, 16), (18.5, 9.5)], False, 2.1)

@icon("chevron-up")
def _(d): poly(d, [(5.5, 14.5), (12, 8), (18.5, 14.5)], False, 2.1)

@icon("plus")
def _(d):
    line(d, (12, 5), (12, 19), 2.0); line(d, (5, 12), (19, 12), 2.0)

@icon("close")
def _(d):
    line(d, (6, 6), (18, 18), 2.0); line(d, (18, 6), (6, 18), 2.0)

@icon("check")
def _(d): poly(d, [(5, 12.5), (10, 17.5), (19, 7)], False, 2.2)

@icon("image")
def _(d):
    poly(d, [(3.5, 5), (20.5, 5), (20.5, 19), (3.5, 19)], True)
    poly(d, [(3.5, 16), (9, 10.5), (13, 14.5), (15.5, 12), (20.5, 17)], False, 1.6)
    circle(d, (16, 8.6), 1.3, 1.5)

@icon("pin")
def _(d):
    poly(d, [(4, 6), (20, 6), (20, 14), (4, 14)], True)
    line(d, (7, 9.2), (17, 9.2), 1.5); line(d, (7, 11.8), (13, 11.8), 1.5)
    poly(d, [(12, 14), (12, 20)], False)
    poly(d, [(9.6, 17.6), (12, 20.2), (14.4, 17.6)], False, 1.8)

# redo = horizontal mirror of undo
icons["redo"] = icons["undo"].transpose(Image.FLIP_LEFT_RIGHT)

os.makedirs("assets/icons", exist_ok=True)
sheet = Image.new("RGB", (OUT * 6 + 70, OUT * 4 + 50), (255, 255, 255))
for i, (name, im) in enumerate(icons.items()):
    small = im.resize((OUT, OUT), Image.LANCZOS)
    rgba = Image.new("RGBA", (OUT, OUT), (255, 255, 255, 0))
    rgba.putalpha(small)
    white = Image.new("RGBA", (OUT, OUT), (255, 255, 255, 255))
    white.putalpha(small)
    white.save(f"assets/icons/{name}.png")
    dark = Image.new("RGB", (OUT, OUT), (20, 24, 30))
    sheet.paste(Image.new("RGB", (OUT, OUT), (15, 20, 25)), (10 + (i % 6) * (OUT + 10), 10 + (i // 6) * (OUT + 10)), small)
sheet.save("../icons_preview.png")
print(len(icons), "icons")
