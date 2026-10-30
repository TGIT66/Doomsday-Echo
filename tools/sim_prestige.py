# -*- coding: utf-8 -*-
"""声望获取效率估算（对应游戏 v0.8.0 的数值）。

不加载 game.js，直接复刻配置区的数值跑一个简化模拟：
  - 玩家按"每秒用最划算的购买把赏金花掉"的策略自动买东西
  - 点击速度可配置（活跃 3 次/秒、半挂机 1 次/秒、纯挂机 0 次/秒）
  - 输出：到达各阈值的时间、单局最优转生点、声望/小时

用法：python tools/sim_prestige.py
"""
import math

# ---- 配置区（与 game.js v0.8.0 保持一致） ----
WEAPONS = [
    # (name, baseCost, costMult, rate, dmg)
    ('手枪',       15,          1.15, 0.1,     1),
    ('冲锋枪',     150,         1.15, 1,       2),
    ('霰弹枪',     1700,        1.15, 12,      7),
    ('突击步枪',   20000,       1.15, 150,     36),
    ('狙击步枪',   250000,      1.15, 2000,    180),
    ('火焰喷射器', 3000000,     1.15, 25000,   900),
    ('榴弹发射器', 40000000,    1.15, 350000,  4800),
    ('电磁炮',     500000000,   1.15, 5000000, 24000),
    ('轨道炮',     7000000000,  1.15, 80000000, 120000),
]

# (name, cost, kind, value)  kind: click/auto
GEAR = [
    ('穿甲弹',   25,       'click', 1.5),
    ('消音器',   500,      'click', 2.0),
    ('战术背心', 2500,     'auto',  1.5),
    ('军用头盔', 12000,    'click', 2.0),
    ('侦察无人机', 60000,  'auto',  1.5),
    ('卫星链路', 300000,   'auto',  2.0),
    ('反器材弹', 1500000,  'click', 3.0),
]

PRESTIGE_AT = 1e6
MAX_TIME = 6 * 3600       # 最多模拟 6 小时
DT = 1.0                  # 步长（秒）


class Run:
    def __init__(self, cps, auto_bonus=1.0, click_bonus=1.0, prestige=0):
        self.cps = cps
        self.auto_bonus = auto_bonus
        self.click_bonus = click_bonus
        self.prestige = prestige      # 持有的声望（被动：每点 +0.1% 全局）
        self.n = [0] * len(WEAPONS)
        self.gear = [False] * len(GEAR)
        self.bounty = 0.0
        self.total = 0.0

    def prestige_mult(self):
        return 1.0 + self.prestige * 0.001

    def click_mult(self):
        m = 1.0
        for i, g in enumerate(GEAR):
            if self.gear[i] and g[2] == 'click':
                m *= g[3]
        return m * self.click_bonus

    def auto_mult(self):
        m = 1.0
        for i, g in enumerate(GEAR):
            if self.gear[i] and g[2] == 'auto':
                m *= g[3]
        return m * self.auto_bonus

    def auto_rate(self):
        r = 0.0
        for i, w in enumerate(WEAPONS):
            r += w[3] * self.n[i]
        return r * self.auto_mult() * self.prestige_mult()

    def click_damage(self):
        d = 1.0
        for i, w in enumerate(WEAPONS):
            d += w[4] * self.n[i]
        return d * self.click_mult() * self.prestige_mult()

    def income(self):
        return self.click_damage() * self.cps + self.auto_rate()

    def weapon_cost(self, i):
        return math.ceil(WEAPONS[i][1] * WEAPONS[i][2] ** self.n[i])

    def best_purchase(self):
        inc = self.income()
        best = None  # (ratio, kind, index, cost)
        for i, w in enumerate(WEAPONS):
            cost = self.weapon_cost(i)
            if cost > self.bounty:
                continue
            delta = w[3] * self.auto_mult() + w[4] * self.click_mult() * self.cps
            if delta <= 0:
                continue
            ratio = delta / cost
            if best is None or ratio > best[0]:
                best = (ratio, 'w', i, cost)
        for i, g in enumerate(GEAR):
            if self.gear[i] or g[1] > self.bounty:
                continue
            if g[2] == 'auto':
                delta = self.auto_rate() * (g[3] - 1.0)
            else:
                delta = self.click_damage() * self.cps * (g[3] - 1.0)
            if delta <= 0:
                # 还买不起任何枪时，点伤装备的边际收益可能是 0 收入增量，忽略
                continue
            ratio = delta / g[1]
            if best is None or ratio > best[0]:
                best = (ratio, 'g', i, g[1])
        return best

    def step(self):
        gain = self.income() * DT
        self.bounty += gain
        self.total += gain
        while True:
            pick = self.best_purchase()
            if not pick:
                break
            _, kind, idx, cost = pick
            self.bounty -= cost
            if kind == 'w':
                self.n[idx] += 1
            else:
                self.gear[idx] = True


def prestige_gain(total_run):
    if total_run < PRESTIGE_AT:
        return 0
    return int(math.floor(math.sqrt(total_run / PRESTIGE_AT)))


def simulate(cps, auto_bonus=1.0, click_bonus=1.0, max_time=MAX_TIME, prestige=0):
    run = Run(cps, auto_bonus, click_bonus, prestige)
    t = 0.0
    marks = [1e6, 1e7, 1e8, 1e9, 1e10, 1e11]
    hit = {}
    series = []  # (t, total)
    while t < max_time:
        run.step()
        t += DT
        if int(t) % 5 == 0:
            series.append((t, run.total))
        for m in marks:
            if m not in hit and run.total >= m:
                hit[m] = t
        if run.total >= marks[-1]:
            break
    return run, t, hit, series


def best_reset(series, max_hours=6.0):
    """在一局的 time-total 序列里，找 gain/t 最大的转生时机。"""
    best = (0.0, 0.0, 0)  # prestige/hour, t, gain
    for t, total in series:
        g = prestige_gain(total)
        if g <= 0:
            continue
        per_hour = g / (t / 3600.0)
        if per_hour > best[0]:
            best = (per_hour, t, g)
    return best


if __name__ == '__main__':
    out = []
    def w(line=''):
        out.append(line)

    marks = (1e6, 1e8, 1e9, 1e10, 1e11)
    w('到达各累计阈值所需时间（分钟，cps=3）：')
    w('持有声望 | ' + ' | '.join('%9s' % ('%.0e' % m) for m in marks))
    w('-' * 72)
    for pv in (0, 300, 1000):
        run, t_end, hit, series = simulate(3.0, prestige=pv)
        cells = ['%9.1f' % (hit[m] / 60.0) if m in hit else '%9s' % '-' for m in marks]
        w('%8d | ' % pv + ' | '.join(cells))

    w()
    w('cps=3、持有声望 0 时各停手点：')
    w('截止累计 | 用时(分) | 声望/局 | 声望/小时')
    run, t_end, hit, series = simulate(3.0, prestige=0)
    for m in marks:
        if m in hit:
            g = prestige_gain(m)
            w('%9s | %8.1f | %7d | %9.1f' % ('%.0e' % m, hit[m] / 60.0, g, g / (hit[m] / 3600.0)))

    w()
    w('cps=1、持有声望 0 时各停手点：')
    w('截止累计 | 用时(分) | 声望/局 | 声望/小时')
    run, t_end, hit, series = simulate(1.0, prestige=0)
    for m in marks:
        if m in hit:
            g = prestige_gain(m)
            w('%9s | %8.1f | %7d | %9.1f' % ('%.0e' % m, hit[m] / 60.0, g, g / (hit[m] / 3600.0)))

    w()
    w('科技解锁（累计声望 300 → 单局打满 9e10）：')
    for cps in (3.0, 1.0):
        for pv in (0, 300):
            run, t_end, hit, series = simulate(cps, prestige=pv)
            t = None
            for tt, total in series:
                if total >= 9e10:
                    t = tt
                    break
            if t:
                w('  cps=%.1f、持有 %4d 声望：约 %.0f 分钟（单局）' % (cps, pv, t / 60.0))
            else:
                w('  cps=%.1f、持有 %4d 声望：6 小时内单局打不到 9e10' % (cps, pv))

    open(r'D:\MyProject\docs\prestige-efficiency.md', 'w', encoding='utf-8').write('\n'.join(out))
    print('report written, %d lines' % len(out))
