# -*- coding: utf-8 -*-
"""把 balance_sim.py 产出的 data.json 画成对比图（Pillow 手绘，无第三方图表库）。

用法：python tools/balance_charts.py
输出：docs/balance/*.png
"""
import json
import math
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'balance')
DATA = os.path.join(OUT, 'data.json')

FONT = r'C:\Windows\Fonts\msyh.ttc'
FONT_BOLD = r'C:\Windows\Fonts\msyhbd.ttc'

BG = (255, 255, 255)
INK = (32, 38, 46)
MUTED = (120, 132, 146)
GRID = (228, 233, 238)
C_OLD = (130, 142, 156)
C_NEW = (214, 74, 60)
C_WARN = (222, 160, 30)


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT, size)


def fmt_short(v):
    if v >= 1e6:
        return '%.0fM' % (v / 1e6)
    if v >= 1e3:
        return '%.0fK' % (v / 1e3)
    return '%g' % v


class Chart:
    def __init__(self, w=1600, h=980, title='', subtitle='',
                 left=120, right=64, top=150, bottom=110):
        self.w, self.h = w, h
        self.img = Image.new('RGB', (w, h), BG)
        self.d = ImageDraw.Draw(self.img)
        self.left, self.right, self.top, self.bottom = left, right, top, bottom
        self.pw = w - left - right
        self.ph = h - top - bottom
        self.title = title
        self.subtitle = subtitle
        self._draw_frame()

    def _draw_frame(self):
        d = self.d
        d.text((self.left, 34), self.title, font=font(40, True), fill=INK)
        if self.subtitle:
            d.text((self.left, 88), self.subtitle, font=font(23), fill=MUTED)
        # 绘图区
        d.rectangle([self.left, self.top, self.left + self.pw, self.top + self.ph],
                    outline=(200, 208, 216), width=2)

    # --- 坐标映射 ---
    def x(self, v, vmin, vmax):
        return self.left + (v - vmin) / (vmax - vmin) * self.pw

    def y(self, v, vmin, vmax):
        return self.top + self.ph - (v - vmin) / (vmax - vmin) * self.ph

    def ylog(self, v, vmin, vmax):
        v = max(v, vmin)
        lv = math.log10(v) - math.log10(vmin)
        lr = math.log10(vmax) - math.log10(vmin)
        return self.top + self.ph - lv / lr * self.ph

    # --- 网格与刻度 ---
    def grid_y_log(self, vmin, vmax, mode='exp'):
        v = math.ceil(math.log10(vmin))
        while 10 ** v <= vmax * 1.0001:
            yy = self.ylog(10 ** v, vmin, vmax)
            self.d.line([self.left, yy, self.left + self.pw, yy], fill=GRID, width=1)
            label = ('1e%d' % v) if mode == 'exp' else fmt_short(10 ** v)
            self.d.text((self.left - 14, yy), label, font=font(21),
                        fill=MUTED, anchor='rm')
            v += 1

    def grid_y_linear(self, vmin, vmax, step):
        v = vmin
        while v <= vmax + 1e-9:
            yy = self.y(v, vmin, vmax)
            self.d.line([self.left, yy, self.left + self.pw, yy], fill=GRID, width=1)
            self.d.text((self.left - 14, yy), '%g' % v, font=font(21),
                        fill=MUTED, anchor='rm')
            v += step

    def grid_x(self, vmin, vmax, step, suffix='', fmt='%g'):
        v = vmin
        while v <= vmax + 1e-9:
            xx = self.x(v, vmin, vmax)
            self.d.line([xx, self.top, xx, self.top + self.ph], fill=GRID, width=1)
            self.d.text((xx, self.top + self.ph + 16), (fmt % v) + suffix,
                        font=font(21), fill=MUTED, anchor='ma')
            v += step

    def axis_titles(self, xt, yt):
        self.d.text((self.left + self.pw / 2, self.h - 46), xt, font=font(23, True),
                    fill=INK, anchor='ma')
        img = Image.new('RGBA', (400, 40), (0, 0, 0, 0))
        dd = ImageDraw.Draw(img)
        dd.text((200, 20), yt, font=font(23, True), fill=INK, anchor='mm')
        img = img.rotate(90, expand=True)
        self.img.paste(img, (10, int(self.top + self.ph / 2 - 200)), img)

    def legend(self, items, x=None, y=None):
        pad = 14
        f = font(22, True)
        widths = [self.d.textlength(t, font=f) for t, _ in items]
        boxw = max(widths) + 90
        boxh = len(items) * 34 + pad * 2
        x = x if x is not None else self.left + self.pw - boxw - 24
        y = y if y is not None else self.top + 22
        self.d.rounded_rectangle([x, y, x + boxw, y + boxh], radius=10,
                                 fill=(255, 255, 255), outline=(214, 220, 228), width=2)
        for i, (t, c) in enumerate(items):
            yy = y + pad + i * 34 + 14
            self.d.line([x + 18, yy, x + 58, yy], fill=c, width=5)
            self.d.text((x + 70, yy), t, font=f, fill=INK, anchor='lm')

    def line(self, pts, color, width=5):
        if len(pts) > 1:
            self.d.line(pts, fill=color, width=width, joint='curve')

    def vline(self, x, y0, y1, color, dash=12, width=3):
        y = y0
        while y < y1:
            self.d.line([x, y, x, min(y + dash, y1)], fill=color, width=width)
            y += dash * 2

    def note(self, xy, text, color=INK, size=21, anchor='lm'):
        self.d.text(xy, text, font=font(size), fill=color, anchor=anchor)

    def save(self, name):
        path = os.path.join(OUT, name)
        self.img.save(path)
        print('saved', path)


def load():
    with open(DATA, encoding='utf-8') as f:
        return json.load(f)


def chart_income(data):
    c = Chart(title='累计赏金：前 4 小时几乎重合，之后新方案越来越慢',
              subtitle='假设：3 次/秒点击、每秒买最划算的东西、每 1 小时能拿到声望就撤退重整；不含离线')
    vmax = 1e22
    vmin = 1e6
    c.grid_y_log(vmin, vmax)
    c.grid_x(0, 36, 4, 'h')
    c.axis_titles('在线游玩时间（小时）', '累计赏金（对数轴）')
    for kind, color, name, wid in (('old', C_OLD, '现状 v0.10.0', 7), ('new', C_NEW, '提案参数', 7)):
        pts = [(c.x(r['t'] / 3600, 0, 36), c.ylog(r['total'], vmin, vmax))
               for r in data[kind]['series'] if r['total'] > 0]
        c.line(pts, color, wid)
        last = data[kind]['series'][-1]
        c.d.ellipse([pts[-1][0] - 8, pts[-1][1] - 8, pts[-1][0] + 8, pts[-1][1] + 8], fill=color)
        c.note((pts[-1][0] - 16, pts[-1][1] - 30), '%.1e' % last['total'], color, 23, anchor='rm')
    # 关键阶段参考线（标签放右侧，避开曲线）
    for val, label in ((1e6, 'v0.4 内容 ≈ 1e6'), (1e12, 'v0.6 科技 ≈ 1e12'), (1e18, '后期 1e18')):
        yy = c.ylog(val, vmin, vmax)
        c.d.line([c.left, yy, c.left + c.pw, yy], fill=(243, 238, 228), width=2)
        c.d.text((c.left + c.pw - 14, yy - 8), label, font=font(20), fill=(176, 158, 120), anchor='rb')
    # 科技点满标记
    for kind, color in (('old', C_OLD), ('new', C_NEW)):
        t = data[kind]['summary']['tech_max']
        if t:
            xx = c.x(t / 3600, 0, 36)
            c.vline(xx, c.top + 10, c.top + c.ph - 10, color, dash=10, width=3)
            c.note((xx + 10, c.top + 26), '科技点满 %.1fh' % (t / 3600), color, 21)
    c.legend([('现状 v0.10.0', C_OLD), ('提案参数', C_NEW)],
             x=c.left + 40, y=c.top + c.ph - 120)
    c.save('01-income.png')


def chart_tech(data):
    c = Chart(title='科技完成度：3.1 小时 → 19.1 小时',
              subtitle='纵轴 = 已研究科技节点（共 18 个，三分支各 6 个）')
    c.grid_y_linear(0, 18, 3)
    c.grid_x(0, 36, 4, 'h')
    c.axis_titles('在线游玩时间（小时）', '已研究节点数')
    for kind, color, name in (('old', C_OLD, '现状 v0.10.0'), ('new', C_NEW, '提案参数')):
        pts = [(c.x(r['t'] / 3600, 0, 36), c.y(r['tech'], 0, 18))
               for r in data[kind]['series']]
        c.line(pts, color, 7)
        t = data[kind]['summary']['tech_max']
        if t:
            xx = c.x(t / 3600, 0, 36)
            c.d.ellipse([xx - 9, c.y(18, 0, 18) - 9, xx + 9, c.y(18, 0, 18) + 9],
                        fill=color)
            c.note((xx + 14, c.y(18, 0, 18) + 26), '%.1fh 点满' % (t / 3600), color, 22)
    c.legend([('现状：3.1h', C_OLD), ('提案：19.1h', C_NEW)])
    c.save('02-tech.png')


def chart_offline(data):
    c = Chart(title='一次离线能把产能放大多少倍',
              subtitle='按「每点赏金投入 ≈ 1% 每秒产能」估算；现状 24h×50%，提案 8h×25% 且不吃声望乘区')
    hr = data['offline']['hours']
    vmax = 600.0
    vmin = 1.0
    c.grid_y_log(vmin, vmax, mode='num')
    c.grid_x(0, 48, 4, 'h')
    c.axis_titles('一次性离线时长（小时）', '离线后的产能倍数')
    for key, color, name in (('old', C_OLD, '现状：24h 上限 × 50%'), ('new', C_NEW, '提案：8h 上限 × 25%')):
        vals = data['offline'][key]
        pts = [(c.x(h, 0, 48), c.ylog(v, vmin, vmax)) for h, v in zip(hr, vals)]
        c.line(pts, color, 6)
        last = pts[-1]
        c.d.ellipse([last[0] - 8, last[1] - 8, last[0] + 8, last[1] + 8], fill=color)
        c.note((last[0] - 12, last[1] - 26), '×%.0f' % vals[-1], color, 24, anchor='rm')
    for h, txt in ((24, '现状封顶'), (8, '提案封顶')):
        xx = c.x(h, 0, 48)
        c.vline(xx, c.top + 10, c.top + c.ph - 10, C_WARN, dash=8, width=3)
        c.note((xx + 8, c.top + 20), txt, C_WARN, 21)
    c.legend([('现状 24h×50%', C_OLD), ('提案 8h×25%', C_NEW)])
    c.save('03-offline.png')


def chart_prestige(data):
    c = Chart(title='声望被动加成：从「无上限线性」改成「软顶」',
              subtitle='现状 = 1 + 声望 × 0.1%（不封顶）；提案 = 前 500 点 0.1%、500~2000 点 0.03%、之后 0.01%')
    ps = data['prestige']['prestige']
    vmax = 100.0
    vmin = 1.0
    c.grid_y_log(vmin, vmax, mode='num')
    for p in (1, 10, 100, 1000, 10000, 50000):
        xx = c.left + math.log10(p) / 5.2 * c.pw
        c.d.line([xx, c.top, xx, c.top + c.ph], fill=GRID)
        c.d.text((xx, c.top + c.ph + 16), ('%d' % p), font=font(21), fill=MUTED, anchor='ma')
    c.axis_titles('持有声望（对数轴）', '全局产出倍率')
    for key, color in (('old', C_OLD), ('new', C_NEW)):
        vals = data['prestige'][key]
        pts = [(c.left + math.log10(p) / 5.2 * c.pw, c.ylog(v, vmin, vmax))
               for p, v in zip(ps, vals)]
        c.line(pts, color, 6)
        c.note((pts[-1][0] - 10, pts[-1][1] - 24), '×%.1f' % vals[-1], color, 23, anchor='rm')
    c.legend([('现状：线性无上限', C_OLD), ('提案：分段软顶', C_NEW)])
    c.save('04-prestige.png')


def chart_milestones(data):
    c = Chart(title='到达每个阶段要多久：前期几乎一样，后期翻倍',
              subtitle='横条 = 在线游玩小时数；同一行上下两条分别是现状与提案', left=320)
    marks = [('1e6  （v0.4 内容）', '1000000.0'),
             ('1e9  （v0.5 军队）', '1000000000.0'),
             ('1e12 （v0.6 科技）', '1000000000000.0'),
             ('1e15 （中期）', '1000000000000000.0'),
             ('1e18 （后期）', '1e+18'),
             ('1e20 （当前终点）', '1e+20')]
    vmax = 36.0
    # 纵向网格（时间轴）
    v = 0
    while v <= vmax:
        xx = c.x(v, 0, vmax)
        c.d.line([xx, c.top, xx, c.top + c.ph], fill=GRID, width=1)
        c.d.text((xx, c.top + c.ph + 16), '%gh' % v, font=font(21), fill=MUTED, anchor='ma')
        v += 4
    row_h = c.ph / len(marks)
    for i, (label, key) in enumerate(marks):
        y0 = c.top + i * row_h
        c.d.text((c.left - 16, y0 + row_h / 2), label, font=font(21), fill=INK, anchor='rm')
        for j, (kind, color) in enumerate((('old', C_OLD), ('new', C_NEW))):
            t = data[kind]['summary']['to_total'].get(key)
            yy = y0 + row_h * (0.30 + 0.42 * j)
            if t:
                h = t / 3600
                c.d.rounded_rectangle([c.x(0, 0, vmax) + 2, yy - 13,
                                       c.x(h, 0, vmax), yy + 13], radius=7, fill=color)
                c.d.text((c.x(h, 0, vmax) + 12, yy), '%.1fh' % h, font=font(20),
                         fill=color, anchor='lm')
            else:
                c.d.text((c.x(0, 0, vmax) + 12, yy), '36h 内未达到', font=font(20),
                         fill=color, anchor='lm')
    c.axis_titles('在线游玩时间（小时）', '')
    c.legend([('现状 v0.10.0', C_OLD), ('提案参数', C_NEW)])
    c.save('05-milestones.png')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    data = load()
    chart_income(data)
    chart_tech(data)
    chart_offline(data)
    chart_prestige(data)
    chart_milestones(data)
