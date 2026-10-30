/* 《末日残响 / Doomsday Echo》v0.4.2 —— 纯前端离线增量游戏（原创末日丧尸题材）
 *
 * 无依赖、无构建工具。想调数值，只改下面「配置区」即可。
 * 部署：整个文件夹丢给任意静态托管（如 Netlify Drop），
 *       手机 Chrome 打开网址 →「安装应用 / 添加到主屏幕」。
 *
 * 版本规矩（见 README / CHANGELOG）：
 *   改完代码 → CHANGELOG 记一条 + sw.js 里 CACHE 版本号 +1
 */
(function () {
  'use strict';

  /* ==================================================================
   *  配置区
   * ================================================================== */

  var VERSION = 'v0.6.1';
  var SAVE_KEY = 'dse_save_v2';   // 键名不变：旧档缺新字段时按 0 补齐，不丢进度
  var AUTOSAVE_MS = 10000;        // 自动存档间隔
  var RENDER_MS = 100;            // 界面刷新节流（毫秒）
  var PRESTIGE_AT = 1e6;          // 单局累计赏金达到该值才能撤退重整
  var ELITE_EVERY = 25;           // 每 N 次开火来一只精英
  var ELITE_MULT = 5;             // 精英赏金倍率

  // 离线收益：v0.5.0 起必须先完成一次撤退重整才解锁
  var OFFLINE_LOCKED_UNTIL_PRESTIGE = true;
  var OFFLINE_BASE_EFF = 0.5;     // 解锁后的基础效率（军医往上加）
  var OFFLINE_MAX_EFF = 1.5;      // 效率上限
  var OFFLINE_MAX_HOURS = 24;     // 时长上限
  var ARMY_LEVEL_SIZE = 10;       // 每多少名士兵升 1 级军队等级

  // 补给时长档位（随撤退重整重置）。第 0 档是默认，之后每档花掉「当前赏金的固定百分比」。
  //   unlock  = 开启该档所需的当前赏金（逐档抬高）
  //   costPct = 消耗当前赏金的比例
  var OFFLINE_TIERS = [
    { hours:2,  unlock:0,    costPct:0    },
    { hours:4,  unlock:1e4,  costPct:0.25 },
    { hours:6,  unlock:1e5,  costPct:0.30 },
    { hours:8,  unlock:1e7,  costPct:0.35 },
    { hours:10, unlock:1e9,  costPct:0.40 },
    { hours:12, unlock:1e11, costPct:0.45 },
    { hours:16, unlock:1e13, costPct:0.50 }
  ];

  // 士兵：消耗声望，价格逐次 ×1.5
  //   effect: auto = 自动赏金加法、click = 单发伤害加法、offEff = 离线效率、offHours = 离线上限
  var SOLDIERS = [
    { id:'rookie',   name:'新兵', icon:'🪖', baseCost:1,  costMult:1.5, max:Infinity, effect:'auto',     per:0.03,
      desc:'每个：自动赏金 +3%' },
    { id:'engineer', name:'工兵', icon:'🔧', baseCost:5,  costMult:1.5, max:Infinity, effect:'click',    per:0.08,
      desc:'每个：单发伤害 +8%' },
    { id:'medic',    name:'军医', icon:'⛑️', baseCost:10, costMult:1.5, max:50,       effect:'offEff',   per:0.02,
      desc:'每个：离线效率 +2%' },
    { id:'officer',  name:'军官', icon:'🎖️', baseCost:25, costMult:1.5, max:12,       effect:'offHours', per:1,
      desc:'每个：离线上限 +1 小时' }
  ];

  // 军火库：成本 = baseCost * costMult^已拥有数量
  //   rate = 每秒自动赏金；dmg = 每持有一把提供的单发伤害
  var WEAPONS = [
    { id:'pistol',   name:'手枪',       icon:'🔫', desc:'警局里唯一还能上膛的东西', baseCost:15,         costMult:1.15, rate:0.1,    dmg:1 },
    { id:'smg',      name:'冲锋枪',     icon:'🔥', desc:'从便利店保安手里接管',     baseCost:150,        costMult:1.15, rate:1,      dmg:3 },
    { id:'shotgun',  name:'霰弹枪',     icon:'💥', desc:'近距离一枪一片',           baseCost:1700,       costMult:1.15, rate:12,     dmg:12 },
    { id:'rifle',    name:'突击步枪',   icon:'🎖️', desc:'军队制式，弹药管够',       baseCost:20000,      costMult:1.15, rate:150,    dmg:60 },
    { id:'sniper',   name:'狙击步枪',   icon:'🎯', desc:'五公里外点名',             baseCost:250000,     costMult:1.15, rate:2000,   dmg:300 },
    { id:'flamer',   name:'火焰喷射器', icon:'🧯', desc:'清场利器，也烧掉了退路',   baseCost:3000000,    costMult:1.15, rate:25000,  dmg:1500 },
    { id:'launcher', name:'榴弹发射器', icon:'🧨', desc:'把整条街变成弹坑',         baseCost:40000000,   costMult:1.15, rate:350000, dmg:8000 },
    { id:'railgun',  name:'电磁炮',     icon:'⚡', desc:'避难所自研，一发耗三天电', baseCost:500000000,  costMult:1.15, rate:5000000, dmg:40000 },
    { id:'orbital',  name:'轨道炮',     icon:'🛰️', desc:'天基武器，开火要国会签字', baseCost:7000000000, costMult:1.15, rate:80000000, dmg:200000 }
  ];

  // 战术装备：type = clickMult / globalMult（clickAdd 仍支持，只是目前没有装备用它）
  var GEAR = [
    { id:'ammo',   name:'穿甲弹',     icon:'🔩', type:'clickMult',  baseCost:25,      costMult:1,   max:1, value:1.5,
      desc:function () { return '单发伤害 ×1.5'; } },
    { id:'supp',   name:'消音器',     icon:'🔇', type:'clickMult',  baseCost:500,     costMult:1,   max:1, value:2,
      desc:function () { return '单发伤害 ×2'; } },
    { id:'vest',   name:'战术背心',   icon:'🦺', type:'globalMult', baseCost:2500,    costMult:1,   max:1, value:1.5,
      desc:function () { return '自动赏金 ×1.5'; } },
    { id:'helmet', name:'军用头盔',   icon:'🪖', type:'clickMult',  baseCost:12000,   costMult:1,   max:1, value:2,
      desc:function () { return '单发伤害 ×2'; } },
    { id:'drone',  name:'侦察无人机', icon:'🛸', type:'globalMult', baseCost:60000,   costMult:1,   max:1, value:1.5,
      desc:function () { return '自动赏金 ×1.5'; } },
    { id:'sat',    name:'卫星链路',   icon:'📡', type:'globalMult', baseCost:300000,  costMult:1,   max:1, value:2,
      desc:function () { return '自动赏金 ×2'; } },
    { id:'ap',     name:'反器材弹',   icon:'🧿', type:'clickMult',  baseCost:1500000, costMult:1,   max:1, value:3,
      desc:function () { return '单发伤害 ×3'; } }
  ];

  // 生存等级：按「累计赏金」解锁（跨周目不清零）
  var RANKS = [
    { name:'幸存者',   at:0 },
    { name:'拾荒者',   at:1e4 },
    { name:'清道夫',   at:1e6 },
    { name:'猎手',     at:1e8 },
    { name:'老兵',     at:1e10 },
    { name:'队长',     at:1e12 },
    { name:'指挥官',   at:1e14 },
    { name:'战区传奇', at:1e16 },
    { name:'尸潮克星', at:1e18 },
    { name:'人类火种', at:1e20 }
  ];

  // 科技三分支：每个分支 6 个节点，必须按顺序研究
  var TECH_BRANCHES = [
    { id:'fire', name:'火力', icon:'🔥', desc:'单发伤害与暴击' },
    { id:'logi', name:'后勤', icon:'📦', desc:'自动赏金与离线效率' },
    { id:'bio',  name:'生物', icon:'🧬', desc:'精英、暴击与全产出' }
  ];

  // kind: click / auto / all / off(离线效率加法) / crit(暴击率加法) /
  //       eliteReduce(精英间隔减少) / eliteMult(精英赏金乘算)
  var TECH_NODES = [
    { id:'f1', branch:'fire', name:'膛线优化',   cost:3,   kind:'click',       mult:1.15, desc:'单发伤害 ×1.15' },
    { id:'f2', branch:'fire', name:'高爆弹头',   cost:8,   kind:'click',       mult:1.20, desc:'单发伤害 ×1.20' },
    { id:'f3', branch:'fire', name:'弹道计算',   cost:18,  kind:'click',       mult:1.20, desc:'单发伤害 ×1.20' },
    { id:'f4', branch:'fire', name:'暴击训练',   cost:40,  kind:'crit',        value:0.15, desc:'15% 概率暴击（伤害 ×3）' },
    { id:'f5', branch:'fire', name:'重武器许可', cost:90,  kind:'click',       mult:1.25, desc:'单发伤害 ×1.25' },
    { id:'f6', branch:'fire', name:'天基火控',   cost:200, kind:'click',       mult:1.50, desc:'单发伤害 ×1.50' },

    { id:'l1', branch:'logi', name:'补给线',     cost:3,   kind:'auto',        mult:1.15, desc:'自动赏金 ×1.15' },
    { id:'l2', branch:'logi', name:'弹药工厂',   cost:8,   kind:'auto',        mult:1.20, desc:'自动赏金 ×1.20' },
    { id:'l3', branch:'logi', name:'野战医院',   cost:18,  kind:'off',         value:0.10, desc:'离线效率 +10%' },
    { id:'l4', branch:'logi', name:'铁路网',     cost:40,  kind:'auto',        mult:1.25, desc:'自动赏金 ×1.25' },
    { id:'l5', branch:'logi', name:'战时经济',   cost:90,  kind:'auto',        mult:1.30, desc:'自动赏金 ×1.30' },
    { id:'l6', branch:'logi', name:'军工复合体', cost:200, kind:'auto',        mult:1.50, desc:'自动赏金 ×1.50' },

    { id:'b1', branch:'bio',  name:'尸群研究',   cost:3,   kind:'eliteReduce', value:5,    desc:'精英间隔 −5 发' },
    { id:'b2', branch:'bio',  name:'基因样本',   cost:8,   kind:'click',       mult:1.10, desc:'单发伤害 ×1.10' },
    { id:'b3', branch:'bio',  name:'诱饵战术',   cost:18,  kind:'eliteMult',   mult:2.00, desc:'精英赏金 ×2' },
    { id:'b4', branch:'bio',  name:'战场急救',   cost:40,  kind:'off',         value:0.10, desc:'离线效率 +10%' },
    { id:'b5', branch:'bio',  name:'神经加速',   cost:90,  kind:'click',       mult:1.30, desc:'单发伤害 ×1.30' },
    { id:'b6', branch:'bio',  name:'人类适应',   cost:200, kind:'all',         mult:1.50, desc:'单发与自动 ×1.50' }
  ];
  var ELITE_BP = 2;        // 击杀精英获得的蓝图
  var HORDE_SECONDS = 300; // 每隔多少秒来一波尸潮

  var UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

  /* ==================================================================
   *  小工具
   * ================================================================== */

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text != null) { n.textContent = text; }
    return n;
  }

  // 数字格式化：1234 -> 1.23K
  function fmt(n) {
    if (n == null || isNaN(n)) { return '0'; }
    if (!isFinite(n)) { return '∞'; }
    if (n < 0) { return '-' + fmt(-n); }
    if (n < 1000) {
      if (n === Math.floor(n)) { return String(n); }
      return n < 10 ? n.toFixed(2) : (n < 100 ? n.toFixed(1) : String(Math.floor(n)));
    }
    var i = 0;
    while (n >= 1000 && i < UNITS.length - 1) { n /= 1000; i++; }
    if (n >= 1000) { return n.toExponential(2).replace('e+', 'e'); }
    return n.toFixed(2) + UNITS[i];
  }

  function fmtDuration(sec) {
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    if (h > 0) { return h + ' 小时 ' + m + ' 分'; }
    if (m > 0) { return m + ' 分 ' + Math.floor(sec % 60) + ' 秒'; }
    return Math.floor(sec) + ' 秒';
  }

  /* ==================================================================
   *  状态
   * ================================================================== */

  function freshState() {
    var weapons = {};
    for (var i = 0; i < WEAPONS.length; i++) { weapons[WEAPONS[i].id] = 0; }
    var soldiers = {};
    for (var j = 0; j < SOLDIERS.length; j++) { soldiers[SOLDIERS[j].id] = 0; }
    var now = Date.now();
    return {
      v: 3,
      bounty: 0,        // 当前赏金
      total: 0,         // 累计获得（决定生存等级，跨重整不清零）
      manual: 0,        // 累计点射赏金
      auto: 0,          // 累计自动赏金（含离线）
      clicks: 0,
      weapons: weapons,
      gear: {},
      offlineTier: 0,
      prestige: 0,      // 声望余额
      prestigeCount: 0, // 撤退重整次数（>0 才解锁离线）
      runBase: 0,       // 上次重整时的累计赏金，用来算「本局产出」
      soldiers: soldiers,
      blueprints: 0,    // 科技点
      tech: {},         // 已研究的节点 id -> 1
      playTime: 0,      // 累计游玩秒数（尸潮计时用，离线不计）
      lastHorde: 0,     // 上次尸潮时的 playTime
      startedAt: now,
      lastSeen: now
    };
  }

  var state = freshState();
  var ui = {};
  var lastRankIdx = -1;

  /* ==================================================================
   *  数值计算
   * ================================================================== */

  function globalMult() {
    var m = 1;
    for (var i = 0; i < GEAR.length; i++) {
      var g = GEAR[i];
      var lv = state.gear[g.id] || 0;
      if (g.type === 'globalMult' && lv > 0) { m *= Math.pow(g.value, lv); }
    }
    return m;
  }

  /* ---------- 军队加成 ---------- */

  function soldierCount(id) {
    return state.soldiers[id] || 0;
  }

  function totalSoldiers() {
    var n = 0;
    for (var i = 0; i < SOLDIERS.length; i++) { n += soldierCount(SOLDIERS[i].id); }
    return n;
  }

  function armyLevel() {
    return Math.floor(totalSoldiers() / ARMY_LEVEL_SIZE);
  }

  // 新兵按个数加法叠加，军队等级每级再 +5%（同样加法，避免乘法爆炸）
  function armyAutoMult() {
    return 1 + soldierCount('rookie') * 0.03 + armyLevel() * 0.05;
  }

  function armyClickMult() {
    return 1 + soldierCount('engineer') * 0.08;
  }

  function soldierCost(s) {
    return Math.max(1, Math.ceil(s.baseCost * Math.pow(s.costMult, soldierCount(s.id))));
  }

  function soldierMaxed(s) {
    return s.max !== Infinity && soldierCount(s.id) >= s.max;
  }

  /* ---------- 科技加成 ---------- */

  function techHas(id) {
    return !!state.tech[id];
  }

  // 把某类节点的乘区累乘起来（all 同时作用于点击与自动）
  function techProduct(kind) {
    var m = 1;
    for (var i = 0; i < TECH_NODES.length; i++) {
      var n = TECH_NODES[i];
      if (!techHas(n.id)) { continue; }
      if (n.kind === kind || n.kind === 'all') { m *= n.mult; }
    }
    return m;
  }

  function techSum(kind) {
    var s = 0;
    for (var i = 0; i < TECH_NODES.length; i++) {
      var n = TECH_NODES[i];
      if (techHas(n.id) && n.kind === kind) { s += n.value; }
    }
    return s;
  }

  function techClickMult() { return techProduct('click'); }
  function techAutoMult() { return techProduct('auto'); }
  function techOffBonus() { return techSum('off'); }
  function techCritChance() { return Math.min(1, techSum('crit')); }

  // 精英间隔（生物分支的「尸群研究」会缩短）
  function eliteEvery() {
    return Math.max(10, ELITE_EVERY - techSum('eliteReduce'));
  }

  // 精英赏金倍率（「诱饵战术」翻倍）
  function eliteMult() {
    return ELITE_MULT * techProduct('eliteMult');
  }

  function getAutoRate() {
    var r = 0;
    for (var i = 0; i < WEAPONS.length; i++) {
      var w = WEAPONS[i];
      r += w.rate * (state.weapons[w.id] || 0);
    }
    return r * globalMult() * armyAutoMult() * techAutoMult();
  }

  // 单发伤害 = (1 + Σ 持有数 × 单发伤害 + 穿甲弹加成) × Π(点击倍率) × 军队点击加成
  function getClickDamage() {
    var d = 1;
    for (var i = 0; i < WEAPONS.length; i++) {
      var w = WEAPONS[i];
      d += w.dmg * (state.weapons[w.id] || 0);
    }
    for (var j = 0; j < GEAR.length; j++) {
      var g = GEAR[j];
      var lv = state.gear[g.id] || 0;
      if (g.type === 'clickAdd' && lv > 0) { d += g.add * lv; }
      if (g.type === 'clickMult' && lv > 0) { d *= Math.pow(g.value, lv); }
    }
    return d * armyClickMult() * techClickMult();
  }

  function weaponCost(w) {
    return Math.ceil(w.baseCost * Math.pow(w.costMult, state.weapons[w.id] || 0));
  }

  function gearCost(g) {
    return Math.ceil(g.baseCost * Math.pow(g.costMult, state.gear[g.id] || 0));
  }

  function gearMaxed(g) {
    return (state.gear[g.id] || 0) >= g.max;
  }

  function offlineTier() {
    var t = state.offlineTier || 0;
    if (!isFinite(t) || t < 0) { t = 0; }
    if (t > OFFLINE_TIERS.length - 1) { t = OFFLINE_TIERS.length - 1; }
    return t;
  }

  function offlineUnlocked() {
    return !OFFLINE_LOCKED_UNTIL_PRESTIGE || (state.prestigeCount || 0) > 0;
  }

  // 上限 = 补给档位 + 军医/军官加成，封顶 24 小时
  function offlineCapHours() {
    if (!offlineUnlocked()) { return 0; }
    var h = OFFLINE_TIERS[offlineTier()].hours + soldierCount('officer');
    return Math.min(OFFLINE_MAX_HOURS, h);
  }

  // 效率 = 50% 基础 + 军医每人 2% + 科技节点，封顶 150%
  function offlineEfficiency() {
    if (!offlineUnlocked()) { return 0; }
    return Math.min(OFFLINE_MAX_EFF,
      OFFLINE_BASE_EFF + soldierCount('medic') * 0.02 + techOffBonus());
  }

  function offlineNextTier() {
    return OFFLINE_TIERS[offlineTier() + 1] || null;
  }

  function offlineCost(next) {
    return Math.ceil(state.bounty * next.costPct);
  }

  // 渐进解锁门槛：第 0 项看自身基础成本的一半，
  // 之后每档看「上一档基础成本的一半」。
  // （不要用「自身成本 × 比例」，档位一多，最后一档会变得几乎永远看不见。）
  function revealAt(list, i) {
    return (i <= 0 ? list[0].baseCost : list[i - 1].baseCost) * 0.5;
  }

  function rankIndex() {
    var idx = 0;
    for (var i = 0; i < RANKS.length; i++) {
      if (state.total >= RANKS[i].at) { idx = i; }
    }
    return idx;
  }

  // source 传 'click' 记入点射，其余（自动、离线）都记入自动
  function addBounty(amount, source) {
    state.bounty += amount;
    state.total += amount;
    if (source === 'click') {
      state.manual += amount;
    } else {
      state.auto += amount;
    }
  }

  /* ==================================================================
   *  玩家操作
   * ================================================================== */

  function fire() {
    var gain = getClickDamage();
    state.clicks++;
    var crit = Math.random() < techCritChance();
    if (crit) { gain *= 3; }
    var interval = eliteEvery();
    var elite = (state.clicks % interval === 0);
    if (elite) { gain *= eliteMult(); }
    addBounty(gain, 'click');
    floatText('+' + fmt(gain) + (crit ? '!' : ''));
    if (elite) {
      state.blueprints = (state.blueprints || 0) + ELITE_BP;
      toast('精英丧尸！赏金 ×' + fmt(eliteMult()) + '，蓝图 +' + ELITE_BP);
      if (ui.fire.classList) {
        ui.fire.classList.add('elite');
        setTimeout(function () { ui.fire.classList.remove('elite'); }, 320);
      }
    }
    if (navigator && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
    render();
  }

  function buyWeapon(w) {
    var cost = weaponCost(w);
    if (state.bounty < cost) { return; }
    state.bounty -= cost;
    state.weapons[w.id] = (state.weapons[w.id] || 0) + 1;
    render();
  }

  function buyGear(g) {
    if (gearMaxed(g)) { return; }
    var cost = gearCost(g);
    if (state.bounty < cost) { return; }
    state.bounty -= cost;
    state.gear[g.id] = (state.gear[g.id] || 0) + 1;
    toast('已装备：' + g.name);
    render();
  }

  function buyOfflineTier() {
    if (!offlineUnlocked()) {
      toast('撤退重整之后才能升级补给');
      return;
    }
    var next = offlineNextTier();
    if (!next) { return; }
    if (state.bounty < next.unlock) {
      toast('需要 ' + fmt(next.unlock) + ' 赏金才能开启下一档');
      return;
    }
    var cost = offlineCost(next);
    if (state.bounty < cost) { return; }
    state.bounty -= cost;
    state.offlineTier = offlineTier() + 1;
    toast('补给时长提升至 ' + next.hours + ' 小时');
    render();
  }

  /* ---------- 军队 ---------- */

  function buySoldier(s) {
    if (soldierMaxed(s)) { return; }
    var cost = soldierCost(s);
    if (state.prestige < cost) {
      toast('声望不足：需要 ' + fmt(cost));
      return;
    }
    state.prestige -= cost;
    state.soldiers[s.id] = soldierCount(s.id) + 1;
    toast('已招募：' + s.name);
    render();
  }

  // 「本局产出」= 累计赏金 − 上次重整时的累计赏金
  function runTotal() {
    return Math.max(0, state.total - (state.runBase || 0));
  }

  function prestigeGain() {
    if (runTotal() < PRESTIGE_AT) { return 0; }
    return Math.floor(Math.sqrt(runTotal() / PRESTIGE_AT));
  }

  function canPrestige() {
    return prestigeGain() >= 1;
  }

  function openPrestigeModal() {
    if (!canPrestige()) { return; }
    var gain = prestigeGain();
    var bp = prestigeBlueprints(gain);
    ui.prestigeText.textContent =
      '将失去：当前赏金 ' + fmt(state.bounty) +
      '、军火库全部等级、战术装备、补给档位。\n' +
      '将得到：声望 +' + fmt(gain) + '，蓝图 +' + bp +
      '（此前声望 ' + fmt(state.prestige) + '，蓝图 ' + fmt(state.blueprints) + '）。\n' +
      '保留：士兵、军队等级、科技、生存等级、战报统计。';
    ui.prestigeModal.classList.remove('hidden');
  }

  function prestigeBlueprints(gain) {
    return Math.floor(gain * 0.5) + 1;
  }

  function closePrestigeModal() {
    ui.prestigeModal.classList.add('hidden');
  }

  function doPrestige() {
    if (!canPrestige()) { closePrestigeModal(); return; }
    var gain = prestigeGain();
    var bp = prestigeBlueprints(gain);
    state.prestige += gain;
    state.blueprints = (state.blueprints || 0) + bp;
    state.prestigeCount = (state.prestigeCount || 0) + 1;
    state.runBase = state.total;
    state.bounty = 0;
    for (var i = 0; i < WEAPONS.length; i++) { state.weapons[WEAPONS[i].id] = 0; }
    for (var j = 0; j < GEAR.length; j++) { state.gear[GEAR[j].id] = 0; }
    state.offlineTier = 0;
    state.lastSeen = Date.now();
    closePrestigeModal();
    saveGame();
    render();
    toast('撤退重整完成：声望 +' + gain + '，蓝图 +' + bp);
  }

  /* ---------- 科技 ---------- */

  // 同一分支必须按顺序解锁
  function techBranchNodes(branchId) {
    var out = [];
    for (var i = 0; i < TECH_NODES.length; i++) {
      if (TECH_NODES[i].branch === branchId) { out.push(TECH_NODES[i]); }
    }
    return out;
  }

  // 'owned' | 'locked'（前置未研究）| 'ready' | 'poor'（蓝图不够）
  function techState(node) {
    if (techHas(node.id)) { return 'owned'; }
    var list = techBranchNodes(node.branch);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id !== node.id) { continue; }
      if (i > 0 && !techHas(list[i - 1].id)) { return 'locked'; }
      break;
    }
    return (state.blueprints || 0) >= node.cost ? 'ready' : 'poor';
  }

  function researchTech(node) {
    if (techState(node) !== 'ready') { return; }
    state.blueprints -= node.cost;
    state.tech[node.id] = 1;
    toast('研究完成：' + node.name);
    render();
  }

  function grantHorde() {
    var n = 2 + Math.floor(rankIndex() / 3);
    state.blueprints = (state.blueprints || 0) + n;
    toast('尸潮来袭！蓝图 +' + n);
  }

  /* ==================================================================
   *  界面
   * ================================================================== */

  function buildWeapons() {
    var box = ui.weapons;
    box.innerHTML = '';
    for (var i = 0; i < WEAPONS.length; i++) {
      (function (w) {
        var row = el('div', 'card');
        var main = el('div', 'card-main');
        var title = el('div', 'card-title');
        title.appendChild(el('span', 'card-name', w.name));
        var owned = el('span', 'card-owned', '×0');
        title.appendChild(owned);
        var rate = el('div', 'card-rate', '');
        main.appendChild(title);
        main.appendChild(el('div', 'card-desc', w.desc));
        main.appendChild(rate);

        var btn = el('button', 'buy-btn');
        btn.type = 'button';
        btn.appendChild(el('span', 'buy-label', '获取'));
        var cost = el('span', 'buy-cost', '');
        btn.appendChild(cost);
        btn.addEventListener('click', function () { buyWeapon(w); });

        row.appendChild(el('div', 'card-icon', w.icon));
        row.appendChild(main);
        row.appendChild(btn);
        box.appendChild(row);

        w._row = row; w._owned = owned; w._rate = rate; w._btn = btn; w._cost = cost;
      })(WEAPONS[i]);
    }
  }

  function buildGear() {
    var box = ui.gear;
    box.innerHTML = '';
    for (var i = 0; i < GEAR.length; i++) {
      (function (g) {
        var row = el('div', 'card');
        var main = el('div', 'card-main');
        var title = el('div', 'card-title');
        title.appendChild(el('span', 'card-name', g.name));
        var lvEl = el('span', 'card-owned', '');
        title.appendChild(lvEl);
        var desc = el('div', 'card-desc', '');
        main.appendChild(title);
        main.appendChild(desc);

        var btn = el('button', 'buy-btn');
        btn.type = 'button';
        btn.appendChild(el('span', 'buy-label', g.max > 1 ? '改装' : '装备'));
        var cost = el('span', 'buy-cost', '');
        btn.appendChild(cost);
        btn.addEventListener('click', function () { buyGear(g); });

        row.appendChild(el('div', 'card-icon', g.icon));
        row.appendChild(main);
        row.appendChild(btn);
        box.appendChild(row);

        g._row = row; g._owned = lvEl; g._desc = desc; g._btn = btn; g._cost = cost;
      })(GEAR[i]);
    }
  }

  // 军队页：声望概览 + 撤退重整 + 四类士兵
  function buildArmy() {
    var box = ui.armyList;
    box.innerHTML = '';

    var hud = el('div', 'army-hud');
    hud.appendChild(el('span', 'army-hud-label', '声望'));
    ui.armyPrestige = el('b', 'army-hud-value', '0');
    hud.appendChild(ui.armyPrestige);
    ui.armyLevel = el('span', 'army-hud-sub', '军队 Lv.0 ｜ 兵力 0');
    hud.appendChild(ui.armyLevel);
    box.appendChild(hud);

    var row = el('div', 'card prestige');
    var main = el('div', 'card-main');
    var title = el('div', 'card-title');
    title.appendChild(el('span', 'card-name', '撤退重整'));
    var tag = el('span', 'card-owned', '未解锁');
    title.appendChild(tag);
    var desc = el('div', 'card-desc', '清空赏金与军火库，换取声望招募士兵');
    var sub = el('div', 'card-rate', '');
    main.appendChild(title);
    main.appendChild(desc);
    main.appendChild(sub);

    var btn = el('button', 'buy-btn');
    btn.type = 'button';
    btn.appendChild(el('span', 'buy-label', '重整'));
    var cost = el('span', 'buy-cost', '');
    btn.appendChild(cost);
    btn.addEventListener('click', openPrestigeModal);

    row.appendChild(el('div', 'card-icon', '🎖️'));
    row.appendChild(main);
    row.appendChild(btn);
    box.appendChild(row);

    ui.prestige = { row: row, tag: tag, sub: sub, btn: btn, cost: cost };

    for (var i = 0; i < SOLDIERS.length; i++) {
      (function (s) {
        var r = el('div', 'card');
        var m = el('div', 'card-main');
        var t = el('div', 'card-title');
        t.appendChild(el('span', 'card-name', s.name));
        var owned = el('span', 'card-owned', '×0');
        t.appendChild(owned);
        var line = el('div', 'card-rate', '');
        m.appendChild(t);
        m.appendChild(el('div', 'card-desc', s.desc));
        m.appendChild(line);

        var b = el('button', 'buy-btn');
        b.type = 'button';
        b.appendChild(el('span', 'buy-label', '招募'));
        var c = el('span', 'buy-cost', '');
        b.appendChild(c);
        b.addEventListener('click', function () { buySoldier(s); });

        r.appendChild(el('div', 'card-icon', s.icon));
        r.appendChild(m);
        r.appendChild(b);
        box.appendChild(r);

        s._row = r; s._owned = owned; s._line = line; s._btn = b; s._cost = c;
      })(SOLDIERS[i]);
    }
  }

  function soldierEffectText(s, n) {
    if (s.effect === 'auto') { return '当前：自动赏金 ×' + (1 + n * 0.03).toFixed(2); }
    if (s.effect === 'click') { return '当前：单发伤害 ×' + (1 + n * 0.08).toFixed(2); }
    if (s.effect === 'offEff') {
      return '当前：离线效率 ' + Math.round(Math.min(OFFLINE_MAX_EFF, OFFLINE_BASE_EFF + n * s.per) * 100) + '%';
    }
    return '当前：离线上限 ' +
      Math.min(OFFLINE_MAX_HOURS, OFFLINE_TIERS[offlineTier()].hours + n * s.per) + ' 小时';
  }

  // 科技页：蓝图概览 + 三分支 × 6 节点
  function buildTech() {
    var box = ui.techList;
    box.innerHTML = '';

    var hud = el('div', 'army-hud tech-hud');
    hud.appendChild(el('span', 'army-hud-label', '蓝图'));
    ui.techBp = el('b', 'army-hud-value', '0');
    hud.appendChild(ui.techBp);
    ui.techTimer = el('span', 'army-hud-sub', '');
    hud.appendChild(ui.techTimer);
    box.appendChild(hud);

    ui.techProg = {};

    for (var b = 0; b < TECH_BRANCHES.length; b++) {
      var br = TECH_BRANCHES[b];
      var head = el('div', 'tech-branch');
      head.appendChild(el('span', 'tech-branch-icon', br.icon));
      var hmain = el('div', 'tech-branch-main');
      hmain.appendChild(el('div', 'tech-branch-name', br.name));
      hmain.appendChild(el('div', 'tech-branch-desc', br.desc));
      head.appendChild(hmain);
      var prog = el('span', 'tech-branch-prog', '0/6');
      head.appendChild(prog);
      box.appendChild(head);
      ui.techProg[br.id] = prog;

      var list = techBranchNodes(br.id);
      for (var i = 0; i < list.length; i++) {
        (function (node) {
          var row = el('div', 'card tech-node');
          var main = el('div', 'card-main');
          var title = el('div', 'card-title');
          title.appendChild(el('span', 'card-name', node.name));
          var flag = el('span', 'card-owned', '');
          title.appendChild(flag);
          main.appendChild(title);
          main.appendChild(el('div', 'card-desc', node.desc));

          var btn = el('button', 'buy-btn');
          btn.type = 'button';
          btn.appendChild(el('span', 'buy-label', '研究'));
          var cost = el('span', 'buy-cost', '');
          btn.appendChild(cost);
          btn.addEventListener('click', function () { researchTech(node); });

          row.appendChild(el('div', 'card-icon', '◈'));
          row.appendChild(main);
          row.appendChild(btn);
          box.appendChild(row);

          node._row = row; node._flag = flag; node._btn = btn; node._cost = cost;
        })(list[i]);
      }
    }
  }

  function buildOffline() {
    var box = ui.offlineList;
    box.innerHTML = '';
    var row = el('div', 'card');
    var main = el('div', 'card-main');
    var title = el('div', 'card-title');
    title.appendChild(el('span', 'card-name', '补给时长'));
    var lv = el('span', 'card-owned', '');
    title.appendChild(lv);
    var desc = el('div', 'card-desc', '');
    var sub = el('div', 'card-rate', '');
    main.appendChild(title);
    main.appendChild(desc);
    main.appendChild(sub);

    var btn = el('button', 'buy-btn');
    btn.type = 'button';
    btn.appendChild(el('span', 'buy-label', '提升'));
    var cost = el('span', 'buy-cost', '');
    btn.appendChild(cost);
    btn.addEventListener('click', buyOfflineTier);

    row.appendChild(el('div', 'card-icon', '📦'));
    row.appendChild(main);
    row.appendChild(btn);
    box.appendChild(row);

    ui.offlineRow = { row: row, lv: lv, desc: desc, sub: sub, btn: btn, cost: cost };
  }

  function buildRankList() {
    var box = ui.rankList;
    box.innerHTML = '';
    for (var i = 0; i < RANKS.length; i++) {
      var row = el('div', 'realm-item');
      row.appendChild(el('span', 'realm-idx', String(i + 1)));
      var right = el('span', 'realm-item-right');
      right.appendChild(el('span', 'realm-item-name', RANKS[i].name));
      right.appendChild(el('span', 'realm-item-at', fmt(RANKS[i].at)));
      row.appendChild(right);
      box.appendChild(row);
      RANKS[i]._row = row;
    }
  }

  function openRankModal() { ui.rankModal.classList.remove('hidden'); }
  function closeRankModal() { ui.rankModal.classList.add('hidden'); }

  function setTab(name) {
    var tabs = ['arsenal', 'army', 'tech', 'log'];
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i] === name;
      ui.tabBtns[tabs[i]].classList.toggle('active', on);
      ui.panels[tabs[i]].classList.toggle('active', on);
    }
    render();
  }

  function render() {
    var rate = getAutoRate();
    ui.bounty.textContent = fmt(state.bounty);
    ui.rate.textContent = '+' + fmt(rate) + ' / 秒';
    ui.clickPower.textContent = fmt(getClickDamage());

    var ri = rankIndex();
    ui.rank.textContent = RANKS[ri].name;
    if (ri !== lastRankIdx) {
      if (lastRankIdx >= 0 && RANKS[lastRankIdx]._row) {
        RANKS[lastRankIdx]._row.classList.remove('current');
      }
      if (RANKS[ri]._row) { RANKS[ri]._row.classList.add('current'); }
      lastRankIdx = ri;
    }
    var next = RANKS[ri + 1];
    if (next) {
      var from = RANKS[ri].at;
      var span = next.at - from;
      var progress = span > 0 ? (state.total - from) / span : 0;
      progress = Math.max(0, Math.min(1, progress));
      ui.rankBar.style.width = (progress * 100).toFixed(1) + '%';
      ui.rankNext.textContent = '下一级：' + next.name + '（' + fmt(state.total) + ' / ' + fmt(next.at) + '）';
    } else {
      ui.rankBar.style.width = '100%';
      ui.rankNext.textContent = '已达当前版本最高等级';
    }

    // 精英进度
    var left = ELITE_EVERY - (state.clicks % ELITE_EVERY);
    ui.fireNote.textContent = '下一只精英：还需 ' + left + ' 发（击杀赏金 ×' + ELITE_MULT + '）';

    for (var i = 0; i < WEAPONS.length; i++) {
      var w = WEAPONS[i];
      var owned = state.weapons[w.id] || 0;
      var cost = weaponCost(w);
      var visible = i === 0 || state.total >= revealAt(WEAPONS, i);
      w._row.style.display = visible ? '' : 'none';
      if (!visible) { continue; }
      w._owned.textContent = '×' + owned;
      w._cost.textContent = fmt(cost);
      w._rate.textContent = '单发 +' + fmt(w.dmg) + ' ｜ 自动 +' + fmt(w.rate * globalMult()) + ' / 秒';
      w._btn.disabled = state.bounty < cost;
      w._btn.classList.toggle('can', state.bounty >= cost);
    }

    for (var j = 0; j < GEAR.length; j++) {
      var g = GEAR[j];
      var visible2 = state.total >= revealAt(GEAR, j);
      g._row.style.display = visible2 ? '' : 'none';
      if (!visible2) { continue; }
      var lv = state.gear[g.id] || 0;
      var gCost = gearCost(g);
      var maxed = gearMaxed(g);
      g._owned.textContent = g.max > 1 ? 'Lv.' + lv : (lv > 0 ? '已装备' : '');
      g._desc.textContent = g.desc(lv);
      g._cost.textContent = maxed ? '已满级' : fmt(gCost);
      g._btn.disabled = maxed || state.bounty < gCost;
      g._btn.classList.toggle('can', !maxed && state.bounty >= gCost);
      g._row.classList.toggle('done', maxed);
    }

    // 军队：撤退重整 + 士兵
    var p = ui.prestige;
    var gain = prestigeGain();
    var ready = gain >= 1;
    var rt = runTotal();
    p.sub.textContent = ready
      ? '本局产出 ' + fmt(rt) + '，可得声望 +' + fmt(gain)
      : '本局产出 ' + fmt(rt) + ' / ' + fmt(PRESTIGE_AT) + '，还差 ' + fmt(Math.max(0, PRESTIGE_AT - rt));
    p.tag.textContent = ready ? '可重整' : '未解锁';
    p.cost.textContent = ready ? '声望 +' + fmt(gain) : '—';
    p.btn.disabled = !ready;
    p.btn.classList.toggle('can', ready);

    ui.armyPrestige.textContent = fmt(state.prestige);
    ui.armyLevel.textContent = '军队 Lv.' + armyLevel() + ' ｜ 兵力 ' + totalSoldiers();

    for (var si = 0; si < SOLDIERS.length; si++) {
      var so = SOLDIERS[si];
      var sn = soldierCount(so.id);
      var sMaxed = soldierMaxed(so);
      var sc = soldierCost(so);
      so._owned.textContent = sMaxed ? '×' + sn + ' 满' : '×' + sn;
      so._line.textContent = soldierEffectText(so, sn);
      so._cost.textContent = sMaxed ? '已满' : fmt(sc);
      so._btn.disabled = sMaxed || state.prestige < sc;
      so._btn.classList.toggle('can', !sMaxed && state.prestige >= sc);
      so._row.classList.toggle('done', sMaxed);
    }

    // 营地补给
    var o = ui.offlineRow;
    var tIdx = offlineTier();
    var curT = OFFLINE_TIERS[tIdx];
    var nxtT = offlineNextTier();
    var effPct = Math.round(offlineEfficiency() * 100);
    var capH = offlineCapHours();
    if (!offlineUnlocked()) {
      o.lv.textContent = '未解锁';
      o.desc.textContent = '完成一次撤退重整后解锁';
      o.sub.textContent = '现在离线不产出赏金';
      o.cost.textContent = '未解锁';
      o.btn.disabled = true;
      o.btn.classList.remove('can');
      o.row.classList.remove('done');
    } else if (!nxtT) {
      o.lv.textContent = 'Lv.' + (tIdx + 1);
      o.desc.textContent = '离线效率 ' + effPct + '% ｜ 上限 ' + capH + ' 小时';
      o.sub.textContent = '已满级：最多结算 ' + curT.hours + ' 小时';
      o.cost.textContent = '已满级';
      o.btn.disabled = true;
      o.btn.classList.remove('can');
      o.row.classList.add('done');
    } else {
      var oCost = offlineCost(nxtT);
      var oUnlocked = state.bounty >= nxtT.unlock;
      o.lv.textContent = 'Lv.' + (tIdx + 1);
      o.desc.textContent = '离线效率 ' + effPct + '% ｜ 上限 ' + capH + ' 小时';
      o.sub.textContent = '当前 ' + curT.hours + ' 小时 → 下一档 ' + nxtT.hours + ' 小时';
      o.cost.textContent = oUnlocked ? fmt(oCost) : fmt(nxtT.unlock) + ' 开启';
      o.btn.disabled = !oUnlocked || state.bounty < oCost;
      o.btn.classList.toggle('can', oUnlocked && state.bounty >= oCost);
      o.row.classList.remove('done');
    }

    // 科技
    ui.techBp.textContent = fmt(state.blueprints || 0);
    var leftHorde = Math.max(0, HORDE_SECONDS - ((state.playTime || 0) - (state.lastHorde || 0)));
    ui.techTimer.textContent = '尸潮 ' + Math.ceil(leftHorde) + ' 秒后';

    for (var tn = 0; tn < TECH_NODES.length; tn++) {
      var node = TECH_NODES[tn];
      var tst = techState(node);
      node._flag.textContent = tst === 'owned' ? '已研究'
        : (tst === 'locked' ? '需前置' : (tst === 'poor' ? '蓝图不足' : ''));
      node._cost.textContent = tst === 'owned' ? '—' : fmt(node.cost);
      node._btn.disabled = tst !== 'ready';
      node._btn.classList.toggle('can', tst === 'ready');
      node._row.classList.toggle('done', tst === 'owned');
      node._row.classList.toggle('locked', tst === 'locked');
    }
    for (var tb = 0; tb < TECH_BRANCHES.length; tb++) {
      var br0 = TECH_BRANCHES[tb];
      var ownedCount = 0;
      for (var tk = 0; tk < TECH_NODES.length; tk++) {
        if (TECH_NODES[tk].branch === br0.id && techHas(TECH_NODES[tk].id)) { ownedCount++; }
      }
      ui.techProg[br0.id].textContent = ownedCount + '/6';
    }

    // 战报
    var man = state.manual || 0;
    var aut = state.auto || 0;
    var sum = man + aut;
    ui.statManual.textContent = fmt(man);
    ui.statAuto.textContent = fmt(aut);
    ui.statTotal.textContent = fmt(sum);
    ui.statManualPct.textContent = sum > 0 ? (man / sum * 100).toFixed(1) + '%' : '';
    ui.statAutoPct.textContent = sum > 0 ? (aut / sum * 100).toFixed(1) + '%' : '';
    ui.footInfo.textContent = VERSION +
      ' ｜ 离线 ' + (offlineUnlocked() ? capH + ' 小时 / ' + effPct + '%' : '未解锁') +
      ' ｜ 声望 ' + fmt(state.prestige) +
      ' ｜ 击杀 ' + state.clicks;
  }

  function floatText(text) {
    var s = el('span', 'float', text);
    s.style.setProperty('--dx', (Math.random() * 60 - 30).toFixed(0) + 'px');
    ui.fire.appendChild(s);
    setTimeout(function () { if (s.parentNode) { s.parentNode.removeChild(s); } }, 900);
  }

  var toastTimer = null;
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.remove('hidden');
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { ui.toast.classList.add('hidden'); }, 1800);
  }

  function showOffline(seconds, gain) {
    ui.offlineText.textContent =
      '你离开了 ' + fmtDuration(seconds) + '，防线自行开火，带回 ' +
      fmt(gain) + ' 赏金。';
    ui.offlineModal.classList.remove('hidden');
  }

  /* ==================================================================
   *  主循环与离线收益
   * ================================================================== */

  var lastFrame = 0;
  var lastRender = 0;

  function loop(now) {
    if (!lastFrame) { lastFrame = now; }
    var dt = (now - lastFrame) / 1000;
    lastFrame = now;
    if (dt > 1) { dt = 1; }          // 回到前台时不全额补算，离线收益另有计算
    if (dt > 0) {
      var r = getAutoRate();
      if (r > 0) { addBounty(r * dt); }

      // 尸潮：按累计游玩时间触发，离线不计时
      state.playTime = (state.playTime || 0) + dt;
      if (state.playTime - (state.lastHorde || 0) >= HORDE_SECONDS) {
        state.lastHorde = state.playTime;
        grantHorde();
      }
    }
    if (now - lastRender >= RENDER_MS) {
      lastRender = now;
      render();
    }
    requestAnimationFrame(loop);
  }

  function applyOffline() {
    var now = Date.now();
    var last = state.lastSeen || now;
    var seconds = (now - last) / 1000;
    state.lastSeen = now;
    if (!(seconds > 1)) { return; }
    if (!offlineUnlocked()) { return; }          // 未撤退重整：离线不结算
    var capH = offlineCapHours();
    if (!(capH > 0)) { return; }
    var capped = Math.min(seconds, capH * 3600);
    var gain = getAutoRate() * capped * offlineEfficiency();
    if (gain <= 0) { return; }
    addBounty(gain);
    if (capped >= 60) { showOffline(capped, gain); }
  }

  /* ==================================================================
   *  存档
   * ================================================================== */

  function saveGame() {
    state.lastSeen = Date.now();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      toast('存档失败：浏览器存储不可用');
      return false;
    }
  }

  // 只接受结构合法的存档；不认识的字段一律丢弃
  function parseSave(raw) {
    var data = JSON.parse(raw);
    if (!data || typeof data !== 'object') { throw new Error('bad save'); }
    var merged = freshState();
    merged.bounty = Number(data.bounty) || 0;
    merged.total = Number(data.total) || 0;
    merged.manual = Number(data.manual) || 0;
    merged.auto = Number(data.auto) || 0;
    merged.clicks = Number(data.clicks) || 0;
    merged.startedAt = Number(data.startedAt) || merged.startedAt;
    merged.lastSeen = Number(data.lastSeen) || merged.lastSeen;
    merged.offlineTier = Number(data.offlineTier) || 0;
    if (merged.offlineTier < 0) { merged.offlineTier = 0; }
    if (merged.offlineTier > OFFLINE_TIERS.length - 1) { merged.offlineTier = OFFLINE_TIERS.length - 1; }

    // v0.5.0 新增：声望 / 重整次数 / 本局基准 / 士兵（旧档缺字段按 0）
    merged.prestige = Math.max(0, Number(data.prestige) || 0);
    merged.prestigeCount = Math.max(0, Number(data.prestigeCount) || 0);
    merged.runBase = Math.max(0, Number(data.runBase) || 0);
    if (merged.runBase > merged.total) { merged.runBase = 0; }
    var srcS = data.soldiers || {};
    for (var k = 0; k < SOLDIERS.length; k++) {
      var cnt = Math.max(0, Number(srcS[SOLDIERS[k].id]) || 0);
      merged.soldiers[SOLDIERS[k].id] =
        SOLDIERS[k].max === Infinity ? cnt : Math.min(cnt, SOLDIERS[k].max);
    }

    var srcW = data.weapons || {};
    for (var i = 0; i < WEAPONS.length; i++) {
      merged.weapons[WEAPONS[i].id] = Math.max(0, Number(srcW[WEAPONS[i].id]) || 0);
    }
    var srcG = data.gear || {};
    for (var j = 0; j < GEAR.length; j++) {
      var lv = Math.max(0, Number(srcG[GEAR[j].id]) || 0);
      merged.gear[GEAR[j].id] = GEAR[j].max === Infinity ? lv : Math.min(lv, GEAR[j].max);
    }
    // v0.6.0 新增：蓝图 / 已研究节点 / 游玩时长
    merged.blueprints = Math.max(0, Number(data.blueprints) || 0);
    merged.playTime = Math.max(0, Number(data.playTime) || 0);
    merged.lastHorde = Math.max(0, Number(data.lastHorde) || 0);
    if (merged.lastHorde > merged.playTime) { merged.lastHorde = 0; }
    var srcT = data.tech || {};
    for (var t = 0; t < TECH_NODES.length; t++) {
      if (srcT[TECH_NODES[t].id]) { merged.tech[TECH_NODES[t].id] = 1; }
    }

    merged.bounty = Math.max(0, merged.bounty);
    merged.total = Math.max(merged.total, merged.bounty);
    return merged;
  }

  function loadGame() {
    var raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { raw = null; }
    if (!raw) { return; }
    try {
      state = parseSave(raw);
    } catch (e) {
      state = freshState();
      toast('存档已损坏，已重新开始');
    }
  }

  function b64encode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) { bin += String.fromCharCode(bytes[i]); }
    return btoa(bin);
  }

  function b64decode(b64) {
    var bin = atob(b64.replace(/\s+/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
    return new TextDecoder().decode(bytes);
  }

  function exportSave() {
    saveGame();
    try {
      ui.saveText.value = b64encode(JSON.stringify(state));
      ui.saveHint.textContent = '已生成存档码，复制后存到备忘录。';
    } catch (e) {
      ui.saveHint.textContent = '生成失败：' + e.message;
    }
  }

  function importSave() {
    var code = (ui.saveText.value || '').trim();
    if (!code) { ui.saveHint.textContent = '请先粘贴存档码。'; return; }
    try {
      state = parseSave(b64decode(code));
      state.lastSeen = Date.now();
      saveGame();
      render();
      ui.saveHint.textContent = '导入成功。';
      toast('存档已导入');
    } catch (e) {
      ui.saveHint.textContent = '存档码无效。';
    }
  }

  function resetGame() {
    if (!window.confirm('确定要重置全部进度吗？此操作不可撤销。')) { return; }
    state = freshState();
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    saveGame();
    render();
    ui.saveModal.classList.add('hidden');
    toast('已重置');
  }

  function copySave() {
    var text = ui.saveText.value;
    if (!text) { ui.saveHint.textContent = '先点「导出」生成存档码。'; return; }
    ui.saveText.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    if (ok) {
      ui.saveHint.textContent = '已复制到剪贴板。';
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () {
        ui.saveHint.textContent = '已复制到剪贴板。';
      }, function () {
        ui.saveHint.textContent = '复制失败，请长按文本框手动复制。';
      });
    } else {
      ui.saveHint.textContent = '复制失败，请长按文本框手动复制。';
    }
  }

  /* ==================================================================
   *  初始化
   * ================================================================== */

  function cacheDom() {
    ui.bounty = $('bounty');
    ui.rate = $('rate');
    ui.clickPower = $('click-power');
    ui.rank = $('realm');
    ui.rankNext = $('realm-next');
    ui.rankBar = $('realm-bar');
    ui.rankRow = $('realm-row');
    ui.rankModal = $('realm-modal');
    ui.rankList = $('realm-list');
    ui.rankClose = $('realm-close');
    ui.fire = $('fire');
    ui.fireNote = $('fire-note');
    ui.weapons = $('weapons');
    ui.gear = $('gear');
    ui.armyList = $('army-list');
    ui.techList = $('tech-list');
    ui.offlineList = $('offline-list');
    ui.statManual = $('stat-manual');
    ui.statAuto = $('stat-auto');
    ui.statTotal = $('stat-total');
    ui.statManualPct = $('stat-manual-pct');
    ui.statAutoPct = $('stat-auto-pct');
    ui.footInfo = $('foot-info');
    ui.offlineModal = $('offline-modal');
    ui.offlineText = $('offline-text');
    ui.prestigeModal = $('prestige-modal');
    ui.prestigeText = $('prestige-text');
    ui.saveModal = $('save-modal');
    ui.saveText = $('save-text');
    ui.saveHint = $('save-hint');
    ui.toast = $('toast');

    ui.tabBtns = {};
    ui.panels = {};
    var names = ['arsenal', 'army', 'tech', 'log'];
    for (var i = 0; i < names.length; i++) {
      ui.tabBtns[names[i]] = $('tab-' + names[i]);
      ui.panels[names[i]] = $('panel-' + names[i]);
    }
  }

  function bindEvents() {
    ui.fire.addEventListener('click', fire);

    $('btn-save').addEventListener('click', function () { ui.saveModal.classList.remove('hidden'); });
    $('btn-close-save').addEventListener('click', function () { ui.saveModal.classList.add('hidden'); });
    $('btn-export').addEventListener('click', exportSave);
    $('btn-import').addEventListener('click', importSave);
    $('btn-copy').addEventListener('click', copySave);
    $('btn-reset').addEventListener('click', resetGame);
    $('offline-ok').addEventListener('click', function () { ui.offlineModal.classList.add('hidden'); });

    $('btn-prestige-cancel').addEventListener('click', closePrestigeModal);
    $('btn-prestige-ok').addEventListener('click', doPrestige);
    ui.prestigeModal.addEventListener('click', function (e) {
      if (e.target === ui.prestigeModal) { closePrestigeModal(); }
    });

    var names = ['arsenal', 'army', 'tech', 'log'];
    for (var i = 0; i < names.length; i++) {
      (function (name) {
        ui.tabBtns[name].addEventListener('click', function () { setTab(name); });
      })(names[i]);
    }

    ui.rankRow.addEventListener('click', openRankModal);
    ui.rankModal.addEventListener('click', function (e) {
      if (e.target === ui.rankModal) { closeRankModal(); }
    });
    ui.rankClose.addEventListener('click', closeRankModal);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        saveGame();
      } else {
        applyOffline();
        lastFrame = 0;
        render();
      }
    });
    window.addEventListener('pagehide', function () { saveGame(); });
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) { return; }
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') { return; }
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  function requestPersistentStorage() {
    try {
      if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(function () {}); }
    } catch (e) {}
  }

  function boot() {
    cacheDom();
    buildWeapons();
    buildGear();
    buildArmy();
    buildTech();
    buildOffline();
    buildRankList();
    bindEvents();
    loadGame();
    applyOffline();
    render();
    requestPersistentStorage();
    registerSW();
    setInterval(saveGame, AUTOSAVE_MS);
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
