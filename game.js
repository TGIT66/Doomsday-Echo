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

  var VERSION = 'v0.4.2';
  var SAVE_KEY = 'dse_save_v2';   // 题材化后不兼容旧档，直接换键名（v0.4.1 改为 dse_ 前缀）
  var AUTOSAVE_MS = 10000;        // 自动存档间隔
  var OFFLINE_EFFICIENCY = 1;     // 离线收益效率（100%）
  var RENDER_MS = 100;            // 界面刷新节流（毫秒）
  var PRESTIGE_AT = 1e6;          // 撤退重整解锁门槛（v0.5.0 实装）
  var ELITE_EVERY = 25;           // 每 N 次开火来一只精英
  var ELITE_MULT = 5;             // 精英赏金倍率

  // 离线时长档位。第 0 档是默认，之后每档花掉「当前赏金的固定百分比」来提升。
  //   unlock  = 开启该档所需的当前赏金（逐档抬高）
  //   costPct = 消耗当前赏金的比例
  var OFFLINE_TIERS = [
    { hours:6,  unlock:0,    costPct:0    },
    { hours:8,  unlock:1e4,  costPct:0.25 },
    { hours:10, unlock:1e6,  costPct:0.30 },
    { hours:12, unlock:1e8,  costPct:0.35 },
    { hours:16, unlock:1e10, costPct:0.40 },
    { hours:20, unlock:1e12, costPct:0.45 },
    { hours:24, unlock:1e14, costPct:0.50 }
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

  // 战术装备：type = clickAdd / clickMult / globalMult
  var GEAR = [
    { id:'ammo',   name:'穿甲弹',     icon:'🔩', type:'clickAdd',   baseCost:25,      costMult:1.9, max:Infinity, add:2,
      desc:function (lv) { return '单发伤害 +' + ((lv + 1) * 2) + '（每级叠加）'; } },
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

  // 科技三分支（v0.6.0 实装，这里只做展示骨架）
  var TECH_BRANCHES = [
    { id:'fire',    name:'火力', icon:'🔥', desc:'单发伤害、暴击、解锁重武器' },
    { id:'logi',    name:'后勤', icon:'📦', desc:'自动赏金、离线效率、自动购买' },
    { id:'bio',     name:'生物', icon:'🧬', desc:'点击连锁、精英出现率、士兵加成' }
  ];

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
    var now = Date.now();
    return {
      v: 2,
      bounty: 0,        // 当前赏金
      total: 0,         // 累计获得（决定生存等级）
      manual: 0,        // 累计点射赏金
      auto: 0,          // 累计自动赏金（含离线）
      clicks: 0,
      weapons: weapons,
      gear: {},
      offlineTier: 0,
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

  function getAutoRate() {
    var r = 0;
    for (var i = 0; i < WEAPONS.length; i++) {
      var w = WEAPONS[i];
      r += w.rate * (state.weapons[w.id] || 0);
    }
    return r * globalMult();
  }

  // 单发伤害 = (1 + Σ 持有数 × 单发伤害 + 穿甲弹加成) × Π(点击倍率)
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
    return d;
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

  function offlineCapHours() {
    return OFFLINE_TIERS[offlineTier()].hours;
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
    var elite = (state.clicks % ELITE_EVERY === 0);
    if (elite) { gain *= ELITE_MULT; }
    addBounty(gain, 'click');
    floatText('+' + fmt(gain));
    if (elite) {
      toast('精英丧尸！赏金 ×' + ELITE_MULT);
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

  // 军队页：撤退重整占位 + 说明
  function buildArmy() {
    var box = ui.armyList;
    box.innerHTML = '';

    var row = el('div', 'card prestige');
    var main = el('div', 'card-main');
    var title = el('div', 'card-title');
    title.appendChild(el('span', 'card-name', '撤退重整'));
    var tag = el('span', 'card-owned', 'v0.5.0');
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
    btn.addEventListener('click', function () {
      toast('撤退重整将在 v0.5.0 开放');
    });

    row.appendChild(el('div', 'card-icon', '🎖️'));
    row.appendChild(main);
    row.appendChild(btn);
    box.appendChild(row);

    ui.prestige = { row: row, sub: sub, btn: btn, cost: cost };
  }

  // 科技页：三分支骨架
  function buildTech() {
    var box = ui.techList;
    box.innerHTML = '';
    for (var i = 0; i < TECH_BRANCHES.length; i++) {
      var b = TECH_BRANCHES[i];
      var row = el('div', 'card locked');
      var main = el('div', 'card-main');
      var title = el('div', 'card-title');
      title.appendChild(el('span', 'card-name', b.name));
      title.appendChild(el('span', 'card-owned', '锁定'));
      main.appendChild(title);
      main.appendChild(el('div', 'card-desc', b.desc));
      main.appendChild(el('div', 'card-rate', '6 节点 · 蓝图 0'));
      row.appendChild(el('div', 'card-icon', b.icon));
      row.appendChild(main);
      box.appendChild(row);
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

    // 撤退重整（占位）
    var p = ui.prestige;
    var ready = state.total >= PRESTIGE_AT;
    p.sub.textContent = ready
      ? '已达成条件：声望 +' + fmt(Math.floor(Math.sqrt(state.total / PRESTIGE_AT)))
      : '解锁条件：累计赏金 ' + fmt(PRESTIGE_AT) + '（当前 ' + fmt(state.total) + '）';
    p.cost.textContent = ready ? '可重整' : fmt(PRESTIGE_AT) + ' 开启';
    p.btn.disabled = !ready;
    p.btn.classList.toggle('can', ready);

    // 营地补给
    var o = ui.offlineRow;
    var tIdx = offlineTier();
    var curT = OFFLINE_TIERS[tIdx];
    var nxtT = offlineNextTier();
    var effPct = Math.round(OFFLINE_EFFICIENCY * 100);
    o.lv.textContent = 'Lv.' + (tIdx + 1);
    o.desc.textContent = '离线收益效率 ' + effPct + '%';
    if (!nxtT) {
      o.sub.textContent = '已满级：最多结算 ' + curT.hours + ' 小时';
      o.cost.textContent = '已满级';
      o.btn.disabled = true;
      o.btn.classList.remove('can');
      o.row.classList.add('done');
    } else {
      var oCost = offlineCost(nxtT);
      var oUnlocked = state.bounty >= nxtT.unlock;
      o.sub.textContent = '当前 ' + curT.hours + ' 小时 → 下一档 ' + nxtT.hours + ' 小时';
      o.cost.textContent = oUnlocked ? fmt(oCost) : fmt(nxtT.unlock) + ' 开启';
      o.btn.disabled = !oUnlocked || state.bounty < oCost;
      o.btn.classList.toggle('can', oUnlocked && state.bounty >= oCost);
      o.row.classList.remove('done');
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
    ui.footInfo.textContent = VERSION + ' ｜ 离线最多 ' + curT.hours + ' 小时 ｜ 击杀 ' + state.clicks;
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
    var capped = Math.min(seconds, offlineCapHours() * 3600);
    var gain = getAutoRate() * capped * OFFLINE_EFFICIENCY;
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

    var srcW = data.weapons || {};
    for (var i = 0; i < WEAPONS.length; i++) {
      merged.weapons[WEAPONS[i].id] = Math.max(0, Number(srcW[WEAPONS[i].id]) || 0);
    }
    var srcG = data.gear || {};
    for (var j = 0; j < GEAR.length; j++) {
      var lv = Math.max(0, Number(srcG[GEAR[j].id]) || 0);
      merged.gear[GEAR[j].id] = GEAR[j].max === Infinity ? lv : Math.min(lv, GEAR[j].max);
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
