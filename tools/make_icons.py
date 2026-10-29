# -*- coding: utf-8 -*-
"""生成 PWA 图标：192 / 512。

设计：末日残响 —— 冷灰底 + 血色环 + 警报黄准星，中心一个「残」字。
所有关键元素都落在画面中央 80% 内，满足 maskable 图标的裁切安全区。
4 倍超采样后缩放，边缘更干净。
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'icons')
os.makedirs(OUT, exist_ok=True)

FONT_CANDIDATES = [
    r'C:\Windows\Fonts\msyhbd.ttc',
    r'C:\Windows\Fonts\msyh.ttc',
    r'C:\Windows\Fonts\simhei.ttf',
]

SS = 4  # 超采样倍数


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size, index=0)
            except Exception:
                continue
    return ImageFont.load_default()


def vertical_gradient(size, top, bottom):
    img = Image.new('RGB', (1, size))
    px = img.load()
    for y in range(size):
        t = y / float(max(1, size - 1))
        px[0, y] = (
            int(top[0] + (bottom[0] - top[0]) * t),
            int(top[1] + (bottom[1] - top[1]) * t),
            int(top[2] + (bottom[2] - top[2]) * t),
        )
    return img.resize((size, size), Image.NEAREST)


def radial_glow(size, color, max_alpha, radius_ratio):
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx = cy = size / 2.0
    steps = 56
    for i in range(steps, 0, -1):
        t = i / float(steps)
        r = size * radius_ratio * t
        a = int(max_alpha * (1 - t) ** 1.8)
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (a,))
    return glow


def make(size, path):
    S = size * SS
    cx = cy = S / 2.0

    # 1. 底色：上暖下冷，模拟废墟上方的天光
    img = vertical_gradient(S, (30, 20, 17), (9, 10, 12)).convert('RGBA')

    # 2. 中央血色辉光 + 左上角一点冷光
    img = Image.alpha_composite(img, radial_glow(S, (211, 63, 73), 66, 0.62))
    corner = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    cd = ImageDraw.Draw(corner)
    cd.ellipse([-S * 0.30, -S * 0.40, S * 0.26, S * 0.16], fill=(242, 193, 78, 16))
    img = Image.alpha_composite(img, corner)

    d = ImageDraw.Draw(img, 'RGBA')

    # 3. 准星十字线（先画淡的，被环压住一部分）
    line_col = (242, 193, 78, 70)
    lw = max(1, int(S * 0.006))
    gap = S * 0.075
    d.line([cx, gap, cx, S - gap], fill=line_col, width=lw)
    d.line([gap, cy, S - gap, cy], fill=line_col, width=lw)

    # 4. 主环：血色
    r_out = S * 0.335
    ring_w = max(2, int(S * 0.028))
    d.ellipse([cx - r_out, cy - r_out, cx + r_out, cy + r_out],
              outline=(211, 63, 73, 255), width=ring_w)

    # 5. 内环：警报黄细线
    r_in = S * 0.286
    d.ellipse([cx - r_in, cy - r_in, cx + r_in, cy + r_in],
              outline=(242, 193, 78, 170), width=max(1, int(S * 0.008)))

    # 6. 四向刻度（环外的短粗线）
    tick_len = S * 0.040
    tick_w = max(2, int(S * 0.024))
    for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
        x1 = cx + dx * (r_out + S * 0.012)
        y1 = cy + dy * (r_out + S * 0.012)
        x2 = cx + dx * (r_out + S * 0.012 + tick_len)
        y2 = cy + dy * (r_out + S * 0.012 + tick_len)
        d.line([x1, y1, x2, y2], fill=(242, 193, 78, 220), width=tick_w)

    # 7. 「残」字
    font = load_font(int(S * 0.30))
    try:
        d.text((cx, cy + S * 0.004), '残', font=font, fill=(242, 193, 78, 255), anchor='mm',
               stroke_width=max(1, int(S * 0.006)), stroke_fill=(90, 18, 22, 255))
    except Exception:
        d.text((cx, cy), '残', font=font, fill=(242, 193, 78, 255))

    img = img.convert('RGB').resize((size, size), Image.LANCZOS)
    img.save(path, 'PNG', optimize=True)
    return path


for s in (192, 512):
    p = make(s, os.path.join(OUT, 'icon-%d.png' % s))
    print('written', p, os.path.getsize(p), 'bytes')
