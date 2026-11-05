# -*- coding: utf-8 -*-
"""数值平衡模拟：当前版本（v0.10.0）vs 提案参数，输出预期收益曲线数据。

不加载 game.js，只复刻配置区的经济模型：
  - 玩家固定策略：每秒把能买的最划算的东西买掉（Δ收益/成本 最大）
  - 点击速度 3 次/秒（活跃玩家）
  - 每局在线满 1 小时且能拿到 ≥1 声望时撤退重整
  - 科技解锁后按「最便宜的可研究节点」顺序推进，蓝图 = 点击掉落 + 声望兑换
  - 离线：旧版 24h×50%，新版 8h×25% 且不吃声望乘区（单独算，不混进在线曲线）

用法：
  python tools/balance_sim.py            # 打印对比表 + 写 docs/balance/data.json
"""
import json
import math
import os

# ----------------------------------------------------------------------------
# 配置
# ----------------------------------------------------------------------------

WEAPON_NAMES = ['手枪', '冲锋枪', '霰弹枪', '突击步枪', '狙击步枪',
                '火焰喷射器', '榴弹发射器', '电磁炮', '轨道炮']


def weapons_old():
    """v0.10.0 配置区原样。"""
    rows = [
        (15, 0.1, 1), (150, 1, 2), (1700, 12, 7), (20000, 150, 36),
        (250000, 2000, 180), (3000000, 25000, 900), (40000000, 350000, 4800),
        (500000000, 5000000, 24000), (7000000000, 80000000, 120000),
    ]
    return [dict(name=WEAPON_NAMES[i], baseCost=r[0], costMult=1.15, rate=r[1], dmg=r[2])
            for i, r in enumerate(rows)]


def weapons_new(cm_slope=0.02, fade_end=0.65):
    """提案：成本指数逐档抬高 + 后期 rate/baseCost 缓降（回本时间单调上升）。

    cm_slope：第 i 档的 costMult = 1.15 + i*cm_slope
    fade_end：最后一档的 rate 保留比例（第 0 档永远是 1.0）
    """
    base = weapons_old()
    n = len(base)
    for i, w in enumerate(base):
        w['costMult'] = round(1.15 + i * cm_slope, 3)
        w['rate'] = w['rate'] * (1 - (1 - fade_end) * i / (n - 1))
    return base


def gear_old():
    return [
        dict(name='穿甲弹', cost=25, kind='click', value=1.5),
        dict(name='消音器', cost=500, kind='click', value=2.0),
        dict(name='战术背心', cost=2500, kind='auto', value=1.5),
        dict(name='军用头盔', cost=12000, kind='click', value=2.0),
        dict(name='侦察无人机', cost=60000, kind='auto', value=1.5),
        dict(name='卫星链路', cost=300000, kind='auto', value=2.0),
        dict(name='反器材弹', cost=1500000, kind='click', value=3.0),
    ]


# 提案：战术装备 -> 武器拥有量里程碑
#   阈值按「该武器持有把数」算，效果是**加法桶**：全局自动 +x%、全局单发 +x%，
#   外加该武器自身的产出倍率。加法桶不会和其他乘区叠乘爆炸。
MILESTONES = [
    (10,  dict(auto=0.10, click=0.15, selfRate=1.15, selfDmg=1.10)),
    (25,  dict(auto=0.15, click=0.20, selfRate=1.25, selfDmg=1.15)),
    (50,  dict(auto=0.20, click=0.25, selfRate=1.35, selfDmg=1.25)),
    (100, dict(auto=0.30, click=0.35, selfRate=1.50, selfDmg=1.40)),
]


def milestones(scaled=1.0):
    """scaled 用来做敏感性扫描。"""
    out = []
    for t, eff in MILESTONES:
        e = {}
        for k, v in eff.items():
            if k in ('selfRate', 'selfDmg'):
                e[k] = 1.0 + (v - 1.0) * scaled
            else:
                e[k] = v * scaled
        out.append((t, e))
    return out


def tech_nodes(cost_scale=1.0):
    """18 个节点，kind: click/auto/all/off/crit/eliteReduce/eliteMult/dropRate"""
    base = [
        ('f', 'click', 1.15, 4), ('f', 'click', 1.20, 10), ('f', 'click', 1.20, 22),
        ('f', 'crit', 0.15, 48), ('f', 'click', 1.25, 108), ('f', 'click', 1.50, 240),
        ('l', 'auto', 1.15, 4), ('l', 'auto', 1.20, 10), ('l', 'off', 0.10, 22),
        ('l', 'auto', 1.25, 48), ('l', 'auto', 1.30, 108), ('l', 'auto', 1.50, 240),
        ('b', 'eliteReduce', 10, 4), ('b', 'dropRate', 0.004, 10),
        ('b', 'eliteMult', 2.0, 22), ('b', 'off', 0.10, 48),
        ('b', 'click', 1.30, 108), ('b', 'all', 1.50, 240),
    ]
    out = []
    for i, (br, kind, value, cost) in enumerate(base):
        out.append(dict(branch=br, idx=i, kind=kind, value=value,
                        cost=max(1, round(cost * cost_scale))))
    return out


class Cfg:
    def __init__(self, kind, **over):
        self.kind = kind
        if kind == 'old':
            self.weapons = weapons_old()
            self.gear = gear_old()
            self.milestones = None
            self.tech = tech_nodes(1.0)
            self.pre_bonus_per = 0.001          # 线性 0.1%/点
            self.pre_curve = None
            self.pre_exponent = 0.5             # gain = (run/at)^0.5
            self.pre_at_base = 1e6
            self.pre_at_growth = 1.0            # 不随次数涨
            self.bp_per_prestige = 10
            self.bp_price_growth = 0.0
            self.bp_click = 0.002
            self.bp_horde_mult = 5.0
            self.offline_cap_h = 24
            self.offline_eff = 0.50
            self.offline_use_prestige = True
            self.tech_unlock = 300
        else:
            self.cm_slope = over.get('cm_slope', 0.02)
            self.fade_end = over.get('fade_end', 0.65)
            self.weapons = weapons_new(self.cm_slope, self.fade_end)
            self.gear = []
            self.milestones = milestones(over.get('ms_scale', 1.0))
            self.tech = tech_nodes(over.get('tech_scale', 3.0))
            self.pre_bonus_per = None
            self.pre_curve = over.get('pre_curve',
                                      [(500, 0.001), (2000, 0.0003), (1e9, 0.0001)])
            self.pre_exponent = 0.5
            self.pre_at_base = 1e6
            self.pre_at_growth = 1.0
            self.bp_per_prestige = over.get('bp_price', 25)
            self.bp_price_growth = over.get('bp_growth', 0.15)
            self.bp_click = over.get('bp_click', 0.001)
            self.bp_horde_mult = 3.0
            self.offline_cap_h = over.get('off_h', 8)
            self.offline_eff = over.get('off_eff', 0.25)
            self.offline_use_prestige = False
            self.tech_unlock = 300

    # ---- 声望 ----
    def prestige_mult(self, p):
        if self.pre_curve is None:
            return 1.0 + p * self.pre_bonus_per
        m = 1.0
        prev = 0
        for cap, rate in self.pre_curve:
            seg = min(p, cap) - prev
            if seg > 0:
                m += seg * rate
            prev = cap
            if p <= cap:
                break
        return m

    def prestige_at(self, count):
        return self.pre_at_base * (self.pre_at_growth ** count)

    def prestige_gain(self, run_total, count):
        at = self.prestige_at(count)
        if run_total < at:
            return 0
        return int(math.floor((run_total / at) ** self.pre_exponent))


# ----------------------------------------------------------------------------
# 模拟
# ----------------------------------------------------------------------------

class Sim:
    def __init__(self, cfg, cps=3.0, seed_horde=True):
        self.cfg = cfg
        self.cps = cps
        # 尸潮覆盖率 ~26%（120s 增益 / (33s 蓄力 + 120s + 300s 冷却)），折算成掉率期望
        self.drop_per_click = cfg.bp_click * (1 + 0.26 * (cfg.bp_horde_mult - 1)) if seed_horde else cfg.bp_click
        self.reset_run()

    def reset_run(self):
        self.n = [0] * len(self.cfg.weapons)
        self.gear_owned = set()
        self.bounty = 0.0
        self.run_start_total = self.total if hasattr(self, 'total') else 0.0
        if not hasattr(self, 'total'):
            self.total = 0.0
        self.bp_bought = 0
        self.tier_hits = [set() for _ in range(len(self.cfg.weapons))]

    # ---- 乘区 ----
    def gear_auto(self):
        m = 1.0
        for i, g in enumerate(self.cfg.gear):
            if i in self.gear_owned and g['kind'] == 'auto':
                m *= g['value']
        return m

    def gear_click(self):
        m = 1.0
        for i, g in enumerate(self.cfg.gear):
            if i in self.gear_owned and g['kind'] == 'click':
                m *= g['value']
        return m

    def milestone_bonus(self):
        auto = 0.0
        click = 0.0
        for i, hits in enumerate(self.tier_hits):
            for t, eff in self.cfg.milestones or []:
                if t in hits:
                    auto += eff.get('auto', 0.0)
                    click += eff.get('click', 0.0)
        return auto, click

    def self_rate(self, i):
        mult = 1.0
        if self.cfg.milestones:
            for t, eff in self.cfg.milestones:
                if t in self.tier_hits[i]:
                    mult *= eff.get('selfRate', 1.0)
        return mult

    def self_dmg(self, i):
        mult = 1.0
        if self.cfg.milestones:
            for t, eff in self.cfg.milestones:
                if t in self.tier_hits[i]:
                    mult *= eff.get('selfDmg', 1.0)
        return mult

    def tech_product(self, kind):
        m = 1.0
        for i in self.tech_owned:
            node = self.cfg.tech[i]
            if node['kind'] == kind or node['kind'] == 'all':
                m *= node['value']
        return m

    def tech_sum(self, kind):
        return sum(self.cfg.tech[i]['value'] for i in self.tech_owned if self.cfg.tech[i]['kind'] == kind)

    def crit_ev(self):
        return 1.0 + self.tech_sum('crit') * 2.0   # 暴击 ×3 → 额外 2 倍

    def p_mult(self):
        return self.cfg.prestige_mult(self.prestige)

    def auto_rate(self, with_prestige=True):
        raw = sum(self.cfg.weapons[i]['rate'] * self.n[i] * self.self_rate(i)
                  for i in range(len(self.n)))
        auto_bonus, _ = self.milestone_bonus()
        m = self.gear_auto() * (1 + auto_bonus) * self.tech_product('auto')
        if with_prestige:
            m *= self.p_mult()
        return raw * m

    def click_damage(self):
        d = 1.0 + sum(self.cfg.weapons[i]['dmg'] * self.n[i] * self.self_dmg(i)
                      for i in range(len(self.n)))
        _, click_bonus = self.milestone_bonus()
        return d * self.gear_click() * (1 + click_bonus) * self.tech_product('click') * self.crit_ev() * self.p_mult()

    def click_dps(self):
        return self.click_damage() * self.cps

    def income(self):
        return self.auto_rate() + self.click_dps()

    # ---- 购买 ----
    def weapon_cost(self, i):
        w = self.cfg.weapons[i]
        return w['baseCost'] * (w['costMult'] ** self.n[i])

    def best_buy(self):
        base = self.income_partial()
        best = None
        for i in range(len(self.n)):
            cost = self.weapon_cost(i)
            if cost > self.bounty:
                continue
            w = self.cfg.weapons[i]
            d_auto = w['rate'] * self.self_rate(i) * self.gear_auto() * self.tech_product('auto') * self.p_mult()
            _, click_bonus = self.milestone_bonus()
            d_click = w['dmg'] * self.self_dmg(i) * self.gear_click() * (1 + click_bonus) * self.tech_product('click') * self.crit_ev() * self.p_mult() * self.cps
            gain = d_auto + d_click
            if gain <= 0:
                continue
            ratio = gain / cost
            if best is None or ratio > best[0]:
                best = (ratio, 'w', i, cost)
        for i, g in enumerate(self.cfg.gear):
            if i in self.gear_owned or g['cost'] > self.bounty:
                continue
            if g['kind'] == 'auto':
                gain = self.auto_rate() * (g['value'] - 1)
            else:
                gain = self.click_dps() * (g['value'] - 1)
            if gain <= 0:
                continue
            ratio = gain / g['cost']
            if best is None or ratio > best[0]:
                best = (ratio, 'g', i, g['cost'])
        return best

    def income_partial(self):
        return self.income()

    def buy_loop(self):
        while True:
            pick = self.best_buy()
            if not pick:
                return
            _, kind, idx, cost = pick
            self.bounty -= cost
            if kind == 'w':
                self.n[idx] += 1
                for t, _eff in self.cfg.milestones or []:
                    if self.n[idx] >= t:
                        self.tier_hits[idx].add(t)
            else:
                self.gear_owned.add(idx)

    # ---- 科技 ----
    def next_tech(self):
        """返回可研究的最便宜节点索引，前置未满足的跳过。"""
        best = None
        for i, node in enumerate(self.cfg.tech):
            if i in self.tech_owned:
                continue
            # 同分支前置
            prev_ok = True
            for j, other in enumerate(self.cfg.tech):
                if other['branch'] == node['branch'] and j < i and j not in self.tech_owned:
                    prev_ok = False
            if not prev_ok:
                continue
            if best is None or node['cost'] < self.cfg.tech[best]['cost']:
                best = i
        return best

    def bp_price(self):
        c = self.cfg
        return c.bp_per_prestige * (1 + c.bp_price_growth * (self.bp_bought // 10))

    def try_tech(self):
        if self.prestige_total < self.cfg.tech_unlock:
            return False
        idx = self.next_tech()
        if idx is None:
            return False
        cost = self.cfg.tech[idx]['cost']
        if self.blueprints >= cost:
            self.blueprints -= cost
            self.tech_owned.add(idx)
            return True
        # 声望兑换
        need = cost - self.blueprints
        price = self.bp_price()
        total = need * price
        if self.prestige >= max(total * 3, 30):
            self.prestige -= total
            self.bp_bought += need
            self.blueprints += need
            return True
        return False

    # ---- 单步 ----
    def step(self, dt=1.0):
        inc = self.income() * dt
        self.bounty += inc
        self.total += inc
        self.blueprints += self.drop_per_click * self.cps * dt
        self.buy_loop()
        while self.try_tech():
            pass
        self.play_time += dt

    def try_prestige(self, min_run=3600.0):
        run_total = self.total - self.run_start_total
        gain = self.cfg.prestige_gain(run_total, self.prestige_count)
        if gain < 1 or self.run_time < min_run:
            return False
        self.prestige += gain
        self.prestige_total += gain
        self.prestige_count += 1
        self.run_start_total = self.total
        self.bounty = 0.0
        self.n = [0] * len(self.n)
        self.gear_owned = set()
        self.tier_hits = [set() for _ in range(len(self.n))]
        self.run_time = 0.0
        return True


def new_sim_state(sim):
    sim.total = 0.0
    sim.prestige = 0.0
    sim.prestige_total = 0.0
    sim.prestige_count = 0
    sim.blueprints = 0.0
    sim.tech_owned = set()
    sim.play_time = 0.0
    sim.run_time = 0.0


def run(cfg, hours=30.0, cps=3.0, sample_every=60.0):
    sim = Sim(cfg, cps=cps)
    new_sim_state(sim)
    sim.run_start_total = 0.0
    t = 0.0
    series = []  # (t_seconds, total, auto_rate, click_dps, prestige, prestige_total, tech_count, blueprints)
    while t < hours * 3600:
        sim.step(1.0)
        t += 1.0
        sim.run_time += 1.0
        if sim.run_time >= 3600.0:
            sim.try_prestige()
        if abs(t % sample_every) < 1e-9:
            series.append(dict(t=t, total=sim.total, auto=sim.auto_rate(),
                               click=sim.click_dps(), prestige=sim.prestige,
                               prestige_total=sim.prestige_total,
                               tech=len(sim.tech_owned), bp=sim.blueprints,
                               resets=sim.prestige_count,
                               income=sim.income()))
    return sim, series


def first_time(series, key, value):
    for row in series:
        if row[key] >= value:
            return row['t']
    return None


NEW_PARAMS = dict(
    cm_slope=0.01,      # costMult 1.15 -> 1.23 逐档抬高
    fade_end=0.90,      # 末档 rate 保留 90%
    ms_scale=2.0,       # 里程碑强度（相对基准表）
    tech_scale=3.0,     # 科技总花费 x3（1296 -> 3888 蓝图）
    bp_price=25,        # 兑换价 10 -> 25 起
    bp_growth=0.15,     # 每兑换 10 张再涨 15%
    bp_click=0.001,     # 掉落 0.2% -> 0.1%
    off_h=8,            # 离线上限 24h -> 8h
    off_eff=0.25,       # 离线效率 50% -> 25%
)

# 离线性价比估算用的边际产能系数：每 1 点赏金投入约带来 1% 的每秒自动产出
ALPHA = 0.01


def offline_curve(hours_list, cap_h, eff, use_prestige_mult, prestige_mult=1.0):
    """离线 D 小时后的产能倍数 = 1 + alpha * (D*3600*eff) * (乘区系数)"""
    out = []
    for h in hours_list:
        d = min(h, cap_h) * 3600.0 * eff
        if not use_prestige_mult:
            # 新方案：离线不吃声望乘区，只吃基础产出
            mult = 1.0 + ALPHA * d
        else:
            mult = 1.0 + ALPHA * d * prestige_mult
        out.append(mult)
    return out


def run_case(kind, hours=30.0, sample_every=300.0, **over):
    cfg = Cfg(kind, **over)
    sim, series = run(cfg, hours=hours, sample_every=sample_every)
    return cfg, sim, series


def summarize(series):
    def first(key, val):
        for r in series:
            if r[key] >= val:
                return r['t']
        return None

    marks = [1e4, 1e6, 1e9, 1e12, 1e15, 1e18, 1e20]
    return {
        'to_total': {str(m): first('total', m) for m in marks},
        'tech_max': first('tech', 18),
        'tech_unlock': first('prestige_total', 300),
    }


if __name__ == '__main__':
    data = {}
    for kind, over in (('old', {}), ('new', NEW_PARAMS)):
        cfg, sim, series = run_case(kind, hours=36.0, **over)
        data[kind] = dict(
            series=series,
            tech_total=len(cfg.tech),
            bp_total=sum(n['cost'] for n in cfg.tech),
            weapons=[dict(name=w['name'], baseCost=w['baseCost'], costMult=w['costMult'],
                          rate=w['rate'], dmg=w['dmg']) for w in cfg.weapons],
        )
        s = summarize(series)
        data[kind]['summary'] = s
        print('== %s ==  科技 %d 点 / %d 蓝图' % (kind, len(cfg.tech), data[kind]['bp_total']))
        for m, t in s['to_total'].items():
            print('   累计 %8s : %s' % (m, ('%.1fh' % (t / 3600)) if t else '—'))
        print('   科技解锁(300 声望):', s['tech_unlock'] and '%.1fh' % (s['tech_unlock'] / 3600))
        print('   科技点满 18/18   :', s['tech_max'] and '%.1fh' % (s['tech_max'] / 3600))

    hours_list = [1, 2, 4, 8, 12, 16, 24, 36, 48]
    data['offline'] = dict(
        hours=hours_list,
        old=[1 + ALPHA * (min(h, 24) * 3600) * 0.5 for h in hours_list],
        new=[1 + ALPHA * (min(h, 8) * 3600) * 0.25 for h in hours_list],
    )
    pre_list = [1, 2, 5, 10, 20, 50, 100, 200, 300, 500, 1000, 2000, 5000, 10000, 20000, 50000]
    data['prestige'] = dict(
        prestige=pre_list,
        old=[1 + p * 0.001 for p in pre_list],
        new=[Cfg('new', **NEW_PARAMS).prestige_mult(p) for p in pre_list],
    )
    data['payback'] = dict(
        names=[w['name'] for w in weapons_old()],
        old=[w['baseCost'] / w['rate'] for w in weapons_old()],
        new=[w['baseCost'] / w['rate'] for w in weapons_new(NEW_PARAMS['cm_slope'], NEW_PARAMS['fade_end'])],
    )
    os.makedirs(r'D:\MyProject\docs\balance', exist_ok=True)
    with open(r'D:\MyProject\docs\balance\data.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    print('data written ->', r'D:\MyProject\docs\balance\data.json')
