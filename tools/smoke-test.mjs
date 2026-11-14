/* 无头冒烟测试：用最小 DOM 桩加载 game.js，验证核心循环不报错。
 * 运行： node tools/smoke-test.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const code = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');

const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
if (ids.length === 0) throw new Error('index.html 里没找到任何 id');

const failures = [];
function check(name, cond, extra = '') {
  if (cond) {
    console.log('  ok   ' + name);
  } else {
    failures.push(name + (extra ? ' -> ' + extra : ''));
    console.log('  FAIL ' + name + (extra ? ' -> ' + extra : ''));
  }
}

function makeEl(tag = 'div') {
  const el = {
    tagName: tag,
    children: [],
    style: { setProperty() {} },
    className: '',
    textContent: '',
    value: '',
    disabled: false,
    _handlers: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (f) { this._s.add(c); } else { this._s.delete(c); } },
      contains(c) { return this._s.has(c); },
    },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    remove() {},
    select() {},
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener(t, f) { (this._handlers[t] = this._handlers[t] || []).push(f); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    get parentNode() { return null; },
  };
  let _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return _html; },
    set(v) { _html = v; if (v === '') el.children.length = 0; },
  });
  return el;
}

const nodes = new Map();
for (const id of ids) nodes.set(id, makeEl());

const docHandlers = {};
const store = new Map();
const pendingTimers = [];
let rafCb = null;

const document = {
  readyState: 'complete',
  hidden: false,
  createElement: makeEl,
  getElementById(id) {
    if (!nodes.has(id)) throw new Error('game.js 引用了 index.html 中不存在的 id: #' + id);
    return nodes.get(id);
  },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener(t, f) { (docHandlers[t] = docHandlers[t] || []).push(f); },
  execCommand() { return false; },
  body: makeEl('body'),
};

const sandbox = {
  console,
  document,
  Math,
  Date,
  JSON,
  Object,
  Array,
  Number,
  String,
  Boolean,
  isNaN,
  isFinite,
  parseInt,
  parseFloat,
  TextEncoder,
  TextDecoder,
  btoa,
  atob,
  setTimeout: (cb) => { pendingTimers.push(cb); return pendingTimers.length; },
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  requestAnimationFrame: (cb) => { rafCb = cb; return 1; },
  performance: { now: () => Date.now() },
  navigator: { storage: { persist: () => Promise.resolve(true) } },
  location: { protocol: 'file:', hostname: '', pathname: '/' },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};
sandbox.window = sandbox;
sandbox.window.confirm = () => true;
sandbox.window.addEventListener = (t, f) => { (docHandlers[t] = docHandlers[t] || []).push(f); };
sandbox.globalThis = sandbox;

console.log('加载 game.js ...');
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'game.js' });

const click = (id) => {
  const h = nodes.get(id)._handlers.click;
  if (!h || !h.length) throw new Error('#' + id + ' 没有绑定 click');
  h.forEach((f) => f());
};
const txt = (id) => nodes.get(id).textContent;

console.log('\n[1] 初始化');
check('赏金初始为 0', txt('bounty') === '0', txt('bounty'));
check('生存等级为幸存者', txt('realm') === '幸存者', txt('realm'));
check('军火库共 9 把武器', nodes.get('weapons').children.length === 9, 'n=' + nodes.get('weapons').children.length);
check('只显示 1 把武器', nodes.get('weapons').children.filter((c) => c.style.display !== 'none').length === 1);
check('战术装备已移除（军火库不再有 gear 容器）', !nodes.has('gear'));
check('武器卡带里程碑提示', nodes.get('weapons').children[0].children[1].children[3].textContent.indexOf('下一档') >= 0,
  nodes.get('weapons').children[0].children[1].children[3].textContent);
check('科技页 = 蓝图条 + 兑换 + 4 分支', nodes.get('tech-list').children.length === 27,
  'n=' + nodes.get('tech-list').children.length);
check('战报统计初始为 0', txt('stat-manual') === '0' && txt('stat-auto') === '0' && txt('stat-total') === '0');
check('精英进度提示', txt('fire-note').indexOf('下一只精英') >= 0, txt('fire-note'));
check('尸潮条初始就绪', txt('horde-text').indexOf('尸潮就绪') >= 0, txt('horde-text'));
check('尸潮条就绪态', nodes.get('horde-bar').classList.contains('ready') === true);

console.log('\n[1b] 生存等级弹窗');
const rModal = nodes.get('realm-modal');
const rList = nodes.get('realm-list');
check('列出全部 10 级', rList.children.length === 10, 'n=' + rList.children.length);
check('当前等级高亮为第 1 档', rList.children[0].classList.contains('current'));
check('阈值显示正确（拾荒者 = 10.00K）', rList.children[1].children[1].children[1].textContent === '10.00K',
  rList.children[1].children[1].children[1].textContent);
click('realm-row');
check('点等级区域 → 打开', rModal.classList.contains('hidden') === false);
rModal._handlers.click[0]({ target: rModal });
check('点空白处 → 关闭', rModal.classList.contains('hidden') === true);

console.log('\n[2] 开火与精英');
for (let i = 0; i < 40; i++) click('fire');
check('40 发含 1 只精英 = 41 赏金（精英 ×2）', txt('bounty') === '41', txt('bounty'));
check('点射统计入账', txt('stat-manual') === '41', txt('stat-manual'));
check('自动仍为 0', txt('stat-auto') === '0', txt('stat-auto'));
check('精英提示条弹出', txt('toast').indexOf('精英') >= 0, txt('toast'));
check('精英倍率显示 ×2', txt('toast').indexOf('×2') >= 0, txt('toast'));

console.log('\n[3] 重置');
click('btn-reset');
check('重置后归零', txt('bounty') === '0', txt('bounty'));

console.log('\n[4] 购买武器');
for (let i = 0; i < 20; i++) click('fire');
const wRow = nodes.get('weapons').children[0];
const wBtn = wRow.children[2];
check('买得起时按钮可点', wBtn.disabled === false);
wBtn._handlers.click[0]();
check('赏金扣除（20 - 15）', txt('bounty') === '5', txt('bounty'));
check('拥有数变为 ×1', wRow.children[1].children[0].children[1].textContent === '×1',
  wRow.children[1].children[0].children[1].textContent);
check('单价涨到 18', wBtn.children[1].textContent === '18', wBtn.children[1].textContent);
check('单发伤害 = 1 + 枪 1 = 2', txt('click-power') === '2', txt('click-power'));

console.log('\n[5] 主循环自动产出');
check('已注册 requestAnimationFrame', typeof rafCb === 'function');
let t = 1000;
for (let i = 0; i < 20; i++) { const cb = rafCb; t += 500; cb(t); }
check('10 秒后自动赏金入账', parseFloat(txt('bounty')) > 5, txt('bounty'));
check('自动产出入账到统计', parseFloat(txt('stat-auto')) > 0, txt('stat-auto'));
check('占比已计算', txt('stat-manual-pct').indexOf('%') > 0, txt('stat-manual-pct'));

console.log('\n[6] 军械里程碑');
const saveM = { v: 4, bounty: 0, total: 5000, manual: 0, auto: 0, clicks: 0,
  weapons: { pistol: 10 }, offlineTier: 0,
  prestige: 0, prestigeCount: 0, runBase: 0, soldiers: {},
  blueprints: 0, tech: {}, playTime: 0, hordeProgress: 0, hordeLeft: 0, hordeCooldown: 0,
  eliteProgress: 0, lastSeen: Date.now() };
nodes.get('save-text').value = btoa(JSON.stringify(saveM));
click('btn-import');
click('tab-arsenal');
const pRowM = nodes.get('weapons').children[0];
const msText = () => pRowM.children[1].children[3].textContent;
check('10 把手枪解锁第一档：单发 1 + 10×1.2 = 13，再 ×1.3 = 16.9',
  txt('click-power') === '16.9', txt('click-power'));
check('自动 = 0.1 × 1.3 × 10 × 1.2 = 1.56 / 秒', txt('rate') === '+1.56 / 秒', txt('rate'));
check('卡片提示下一个里程碑 ×25', msText().indexOf('×25') >= 0 && msText().indexOf('还差 15 把') >= 0, msText());
check('里程碑不影响单把价格（10 把后仍是 61）', pRowM.children[2].children[1].textContent === '61',
  pRowM.children[2].children[1].textContent);

// 两把武器同时到 10 把：加法桶叠加（自动 +40%、单发 +60%）
const saveM2 = { ...saveM, weapons: { pistol: 10, smg: 10 } };
nodes.get('save-text').value = btoa(JSON.stringify(saveM2));
click('btn-import');
check('两把枪的里程碑叠加：自动 (1.3+12.87)×1.4 = 19.8',
  txt('rate') === '+19.8 / 秒', txt('rate'));
check('两把枪的里程碑叠加：单发 (1+12+24)×1.6 = 59.2',
  txt('click-power') === '59.2', txt('click-power'));

console.log('\n[7] 底部 tab 切换');
click('tab-army');
check('军队面板激活', nodes.get('panel-army').classList.contains('active'));
check('军火库面板隐藏', nodes.get('panel-arsenal').classList.contains('active') === false);
click('tab-log');
check('战报面板激活', nodes.get('panel-log').classList.contains('active'));

console.log('\n[8] 军队入口与离线门槛');
const saveA = { v: 3, bounty: 5000, total: 500000, manual: 1000, auto: 499000, clicks: 50,
  weapons: { pistol: 5 }, gear: {}, offlineTier: 0,
  prestige: 0, prestigeCount: 0, runBase: 0, soldiers: {}, lastSeen: Date.now() };
nodes.get('save-text').value = btoa(JSON.stringify(saveA));
click('btn-import');
check('导入成功', txt('save-hint').indexOf('成功') >= 0, txt('save-hint'));
click('tab-army');
check('军队页 = 声望条 + 重整 + 4 兵种', nodes.get('army-list').children.length === 6,
  'n=' + nodes.get('army-list').children.length);
const pCard0 = nodes.get('army-list').children[1];
check('未到 1e6 不能重整', pCard0.children[2].disabled === true, pCard0.children[2].children[1].textContent);
check('重整按钮显示 —', pCard0.children[2].children[1].textContent === '—', pCard0.children[2].children[1].textContent);

console.log('\n[8b] 离线未解锁');
click('tab-log');
const offRow = nodes.get('offline-list').children[0];
const offLv = () => offRow.children[1].children[0].children[1].textContent;
const offDesc = () => offRow.children[1].children[1].textContent;
check('离线显示未解锁', offLv() === '未解锁', offLv());
check('提示需撤退重整', offDesc().indexOf('撤退重整') >= 0, offDesc());
check('离线按钮禁用', offRow.children[2].disabled === true);

console.log('\n[8c] 科技在声望达标前锁定');
click('tab-tech');
const gate0 = nodes.get('tech-list').children[1];
check('声望 0 时显示科技锁定', gate0.children[1].children[0].children[0].textContent === '科技锁定',
  gate0.children[1].children[0].children[0].textContent);
check('门槛提示 0 / 300', gate0.children[1].children[1].textContent.indexOf('/ 300') >= 0,
  gate0.children[1].children[1].textContent);
check('未解锁时兑换按钮禁用', gate0.children[2].children[0].disabled === true);
check('未解锁时节点不可研究', nodes.get('tech-list').children[3].children[2].disabled === true);
check('节点标记未解锁', nodes.get('tech-list').children[3].children[1].children[0].children[1].textContent === '未解锁',
  nodes.get('tech-list').children[3].children[1].children[0].children[1].textContent);

console.log('\n[9] 声望与士兵');
const saveB = { v: 3, bounty: 20000, total: 200000000, manual: 300000, auto: 900000, clicks: 500,
  weapons: { pistol: 12, smg: 3 }, gear: { ammo: 2 }, offlineTier: 0,
  prestige: 500, prestigeCount: 2, runBase: 0, soldiers: {}, lastSeen: Date.now() };
nodes.get('save-text').value = btoa(JSON.stringify(saveB));
click('btn-import');
check('赏金保留', txt('bounty') === '20.00K', txt('bounty'));
check('等级按累计判定（猎手）', txt('realm') === '猎手', txt('realm'));
check('自动产出 = 4.53 × 1.2(里程碑) × 声望 1.5 = 8.15', txt('rate') === '+8.15 / 秒', txt('rate'));
check('单发伤害 = (1+12×1.2+6) × 1.3(里程碑) × 声望 1.5 = 41.7', txt('click-power') === '41.7', txt('click-power'));
click('tab-army');
const hud = nodes.get('army-list').children[0];
const pCard = nodes.get('army-list').children[1];
const rookieRow = nodes.get('army-list').children[2];
const engRow = nodes.get('army-list').children[3];
const officerRow = nodes.get('army-list').children[5];
check('声望显示 500', hud.children[1].textContent === '500', hud.children[1].textContent);
check('军队等级提示 Lv.0', hud.children[2].textContent.indexOf('Lv.0') >= 0, hud.children[2].textContent);
check('声望被动显示在军队条上', hud.children[2].textContent.indexOf('全局 +50.0%') >= 0, hud.children[2].textContent);
check('可重整', pCard.children[2].disabled === false);
check('重整显示声望 +14', pCard.children[2].children[1].textContent === '声望 +14',
  pCard.children[2].children[1].textContent);

rookieRow.children[2]._handlers.click[0]();
check('招募新兵后声望 -1', hud.children[1].textContent === '499', hud.children[1].textContent);
check('新兵 ×1', rookieRow.children[1].children[0].children[1].textContent === '×1',
  rookieRow.children[1].children[0].children[1].textContent);
check('自动产出 ×1.03 = 8.39', txt('rate') === '+8.39 / 秒', txt('rate'));

check('工兵首价 5', engRow.children[2].children[1].textContent === '5', engRow.children[2].children[1].textContent);
engRow.children[2]._handlers.click[0]();
check('招募工兵后声望 -5', hud.children[1].textContent === '494', hud.children[1].textContent);
check('单发伤害 ×1.08 = 44.9', txt('click-power') === '44.9', txt('click-power'));

console.log('\n[9b] 撤退重整');
pCard.children[2]._handlers.click[0]();
check('确认弹窗打开', nodes.get('prestige-modal').classList.contains('hidden') === false);
check('弹窗列出将失去什么', txt('prestige-text').indexOf('将失去') >= 0, txt('prestige-text').slice(0, 20));
nodes.get('btn-prestige-ok')._handlers.click[0]();
check('弹窗关闭', nodes.get('prestige-modal').classList.contains('hidden') === true);
check('赏金清零', txt('bounty') === '0', txt('bounty'));
check('声望 494 + 14 = 508', hud.children[1].textContent === '508', hud.children[1].textContent);
check('军火库归零', nodes.get('weapons').children[0].children[1].children[0].children[1].textContent === '×0',
  nodes.get('weapons').children[0].children[1].children[0].children[1].textContent);
check('累计不清零，等级仍是猎手', txt('realm') === '猎手', txt('realm'));
check('单发伤害回落到 1 × 1.08 × 声望 1.502 = 1.62', txt('click-power') === '1.62', txt('click-power'));
check('自动产出归零', txt('rate') === '+0 / 秒', txt('rate'));
check('重整后按钮变灰（本局产出不足）', pCard.children[2].disabled === true);

console.log('\n[9c] 重整后离线解锁 + 军官 + 军队等级');
click('tab-log');
check('离线解锁 Lv.1', offLv() === 'Lv.1', offLv());
check('上限 2 小时', offDesc().indexOf('2 小时') >= 0, offDesc());
check('效率 25%', offDesc().indexOf('25%') >= 0, offDesc());

click('tab-army');
check('军官首价 25', officerRow.children[2].children[1].textContent === '25', officerRow.children[2].children[1].textContent);
officerRow.children[2]._handlers.click[0]();
check('军官 ×1', officerRow.children[1].children[0].children[1].textContent === '×1',
  officerRow.children[1].children[0].children[1].textContent);
check('军官把上限加到 2.5 小时', officerRow.children[1].children[2].textContent.indexOf('2.5 小时') >= 0,
  officerRow.children[1].children[2].textContent);

for (let i = 0; i < 9; i++) rookieRow.children[2]._handlers.click[0]();
check('兵力 10+ 后升到军队 Lv.1', hud.children[2].textContent.indexOf('Lv.1') >= 0, hud.children[2].textContent);

console.log('\n[9d] 科技：解锁门槛、兑换阶梯、研究');
// 用一个专门的存档测科技，避免被前面的招募/重整影响数值
const saveT = { v: 4, bounty: 0, total: 1e9, manual: 0, auto: 0, clicks: 0,
  weapons: {}, offlineTier: 0, prestige: 3000, prestigeTotal: 4000, prestigeCount: 3,
  runBase: 0, soldiers: {}, blueprints: 0, bpBought: 0, tech: {},
  playTime: 0, hordeProgress: 0, hordeLeft: 0, hordeCooldown: 0,
  eliteProgress: 0, lastSeen: Date.now() };
nodes.get('save-text').value = btoa(JSON.stringify(saveT));
click('btn-import');
click('tab-tech');
check('科技页 = 蓝图条 + 兑换 + 4 分支 × 7', nodes.get('tech-list').children.length === 27,
  'n=' + nodes.get('tech-list').children.length);
const techHud = nodes.get('tech-list').children[0];
const gate = nodes.get('tech-list').children[1];
check('导入后蓝图 0', techHud.children[1].textContent === '0', techHud.children[1].textContent);
check('累计声望 4000 已过门槛', gate.children[1].children[0].children[0].textContent === '声望兑换',
  gate.children[1].children[0].children[0].textContent);
check('兑换价 25 起', gate.children[1].children[1].textContent.indexOf('25 声望 = 1 蓝图') >= 0,
  gate.children[1].children[1].textContent);
check('掉率显示在 hud', techHud.children[2].textContent.indexOf('掉率') >= 0, techHud.children[2].textContent);

check('换 10 按钮可用', gate.children[2].children[1].disabled === false);
gate.children[2].children[1]._handlers.click[0]();
check('兑换 10 张 × 25 = 250，蓝图 = 10', techHud.children[1].textContent === '10', techHud.children[1].textContent);
check('第二档单张涨到 29', gate.children[1].children[1].textContent.indexOf('29 声望 = 1 蓝图') >= 0,
  gate.children[1].children[1].textContent);
click('tab-army');
check('军队页声望同步扣减（3000 - 250 = 2750）', nodes.get('army-list').children[0].children[1].textContent === '2.75K',
  nodes.get('army-list').children[0].children[1].textContent);
click('tab-tech');
gate.children[2].children[1]._handlers.click[0]();
check('再兑 10 张 × 29 = 290，蓝图 = 20', techHud.children[1].textContent === '20', techHud.children[1].textContent);

const f1Row = nodes.get('tech-list').children[3];
const f2Row = nodes.get('tech-list').children[4];
check('f1 可研究（成本 15）', f1Row.children[2].disabled === false, f1Row.children[2].children[1].textContent);
check('f2 需前置',
  f2Row.children[2].disabled === true && f2Row.children[1].children[0].children[1].textContent === '需前置',
  f2Row.children[1].children[0].children[1].textContent);

const dmgBeforeTech = parseFloat(txt('click-power'));
f1Row.children[2]._handlers.click[0]();
check('研究后蓝图 20 - 15 = 5', techHud.children[1].textContent === '5', techHud.children[1].textContent);
check('单发伤害被 ×1.15 放大', parseFloat(txt('click-power')) > dmgBeforeTech,
  dmgBeforeTech + ' -> ' + txt('click-power'));
check('f1 标记已研究', f1Row.children[1].children[0].children[1].textContent === '已研究',
  f1Row.children[1].children[0].children[1].textContent);
check('f2 变为蓝图不足', f2Row.children[1].children[0].children[1].textContent === '蓝图不足',
  f2Row.children[1].children[0].children[1].textContent);

// 精英不再掉蓝图
const bpBeforeElite = parseInt(techHud.children[1].textContent, 10);
const realRandom = Math.random;
Math.random = () => 0.999;              // 压掉随机掉落，只看精英
for (let i = 0; i < 40; i++) click('fire');
check('击杀精英不再送蓝图', parseInt(techHud.children[1].textContent, 10) === bpBeforeElite,
  bpBeforeElite + ' -> ' + techHud.children[1].textContent);
check('精英仍有多倍赏金', txt('toast').indexOf('赏金 ×') >= 0, txt('toast'));

// 开火掉落（把随机数压到 0 必定命中）
Math.random = () => 0;
click('fire');
Math.random = realRandom;
check('开火掉落 +1 蓝图', parseInt(techHud.children[1].textContent, 10) === bpBeforeElite + 1,
  techHud.children[1].textContent);

const bpEl = () => parseInt(techHud.children[1].textContent, 10) || 0;

// v0.9.0：尸潮不再「按时间白送蓝图」，挂机不会产出任何蓝图
const bpBeforeTime = bpEl();
let t2 = 20000;
for (let i = 0; i < 310; i++) { const cb = rafCb; t2 += 1000; cb(t2); }
check('挂机 310 秒不再白送蓝图', bpEl() === bpBeforeTime, bpBeforeTime + ' -> ' + bpEl());

console.log('\n[9e] 尸群研究缩短精英间隔');
const saveD = { v: 3, bounty: 50000, total: 200000000, manual: 1000, auto: 1000, clicks: 0,
  weapons: { pistol: 10 }, gear: {}, offlineTier: 0,
  prestige: 100, prestigeCount: 2, runBase: 0, soldiers: {},
  blueprints: 100, tech: { b1: 1 }, playTime: 0, hordeProgress: 0, hordeLeft: 0, eliteProgress: 0, lastSeen: Date.now() };
nodes.get('save-text').value = btoa(JSON.stringify(saveD));
click('btn-import');
click('tab-tech');
check('提示显示每 30 发一只', txt('fire-note').indexOf('每 30 发') >= 0, txt('fire-note'));
for (let i = 0; i < 30; i++) click('fire');
check('30 发后计数器归零（间隔确实生效）', txt('fire-note').indexOf('还需 30 发') >= 0, txt('fire-note'));

console.log('\n[9f] 尸潮：手动释放（v0.12.0）');
const saveF = { v: 3, bounty: 0, total: 0, manual: 0, auto: 0, clicks: 0,
  weapons: {}, offlineTier: 0,
  prestige: 0, prestigeCount: 0, runBase: 0, soldiers: {},
  blueprints: 0, tech: {}, playTime: 0, hordeProgress: 0, hordeLeft: 0, hordeCooldown: 0,
  eliteProgress: 0, lastSeen: Date.now() };
nodes.get('save-text').value = btoa(JSON.stringify(saveF));
click('btn-import');
click('tab-arsenal');
const hordeBar = nodes.get('horde-bar');
const fireBtn = nodes.get('fire');
check('导入后尸潮就绪', hordeBar.classList.contains('ready') === true, txt('horde-text'));
check('就绪文案', txt('horde-text').indexOf('尸潮就绪') >= 0, txt('horde-text'));

for (let i = 0; i < 150; i++) click('fire');
check('开火 150 发也不会自动触发', hordeBar.classList.contains('active') === false, txt('horde-text'));

click('horde-bar');
check('点按钮才触发尸潮', hordeBar.classList.contains('active') === true, txt('horde-text'));
check('横幅切到进行中', txt('horde-text').indexOf('尸潮进行中') >= 0, txt('horde-text'));
check('剩余 120 秒', txt('horde-text').indexOf('120 秒') >= 0, txt('horde-text'));
check('提示条切到尸潮模式', txt('fire-note').indexOf('尸潮中') >= 0, txt('fire-note'));
check('开火按钮进入尸潮高亮', fireBtn.classList.contains('horde') === true);

const b0 = parseInt(txt('bounty'), 10);
click('fire');
check('尸潮中点击 ×2', parseInt(txt('bounty'), 10) === b0 + 2, b0 + ' -> ' + txt('bounty'));

// 掉率 ×3：基础 0.1%，尸潮中 0.3%；取 0.2% 正好落在两者之间
const realRandom2 = Math.random;
const bp0 = bpEl();
Math.random = () => 0.002;
click('fire');
Math.random = realRandom2;
check('尸潮中掉率 ×3（0.2% 命中）', bpEl() === bp0 + 1, bp0 + ' -> ' + bpEl());

// 120 秒倒数：只在游玩时推进（dt 上限 1 秒/帧）
let t3 = 400000;
for (let i = 0; i < 120; i++) { const cb = rafCb; t3 += 1000; cb(t3); }
check('120 秒后尸潮结束', hordeBar.classList.contains('active') === false, txt('horde-text'));
check('结束后立刻进入冷却', hordeBar.classList.contains('cooling') === true, txt('horde-text'));
check('冷却显示 5:00', txt('horde-text').indexOf('5:00') >= 0, txt('horde-text'));
check('尸潮退去提示', txt('toast').indexOf('尸潮退去') >= 0, txt('toast'));
check('开火按钮退出尸潮高亮', fireBtn.classList.contains('horde') === false);

click('horde-bar');
check('冷却中点按钮不触发', hordeBar.classList.contains('active') === false, txt('horde-text'));
check('冷却提示', txt('toast').indexOf('冷却中') >= 0, txt('toast'));

// 冷却 300 秒走完
for (let i = 0; i < 299; i++) { const cb = rafCb; t3 += 1000; cb(t3); }
check('冷却 299 秒还没结束', hordeBar.classList.contains('cooling') === true, txt('horde-text'));
check('冷却剩 0:01', txt('horde-text').indexOf('0:01') >= 0, txt('horde-text'));
{ const cb = rafCb; t3 += 1000; cb(t3); }
check('冷却结束回到就绪', hordeBar.classList.contains('ready') === true, txt('horde-text'));
check('就绪提示', txt('toast').indexOf('尸潮已就绪') >= 0, txt('toast'));

click('horde-bar');
check('第二轮可以再放', hordeBar.classList.contains('active') === true, txt('horde-text'));
check('第二轮从 120 秒开始', txt('horde-text').indexOf('剩余 120 秒') >= 0, txt('horde-text'));

console.log('\n[9g] 武器折扣（智能分支）');
const mkSave = (over) => Object.assign({ v: 4, bounty: 0, total: 1e9, manual: 0, auto: 0, clicks: 0,
  weapons: {}, offlineTier: 0, prestige: 0, prestigeTotal: 0, prestigeCount: 0,
  runBase: 0, soldiers: {}, blueprints: 0, bpBought: 0, tech: {},
  playTime: 0, hordeProgress: 0, hordeLeft: 0, hordeCooldown: 0,
  eliteProgress: 0, lastSeen: Date.now() }, over || {});
const importSave = (obj) => {
  nodes.get('save-text').value = btoa(JSON.stringify(obj));
  click('btn-import');
};
const priceOf = (i) => nodes.get('weapons').children[i].children[2].children[1].textContent;

importSave(mkSave());
check('无折扣：手枪 15', priceOf(0) === '15', priceOf(0));

importSave(mkSave({ tech: { i1: 1 } }));
check('低档 −25%：手枪 12', priceOf(0) === '12', priceOf(0));
check('低档折扣不影响高档：狙击 250.00K', priceOf(4) === '250.00K', priceOf(4));

importSave(mkSave({ tech: { i1: 1, i3: 1 } }));
check('高档 −25%：狙击 187.50K', priceOf(4) === '187.50K', priceOf(4));
check('i3 不影响低档：手枪仍 12', priceOf(0) === '12', priceOf(0));

importSave(mkSave({ tech: { i1: 1, i3: 1, i4: 1 } }));
check('两档叠加 = 40% 封顶：手枪 9', priceOf(0) === '9', priceOf(0));
check('两档叠加 = 40% 封顶：狙击 150.00K', priceOf(4) === '150.00K', priceOf(4));

console.log('\n[9h] 长按连发（智能分支）');
const fireEl = nodes.get('fire');
importSave(mkSave({ bounty: 0, total: 0, tech: { i2: 1 } }));
let th = 2000000;
{ const cb = rafCb; th += 1000; cb(th); }
const holdBefore = parseInt(txt('bounty'), 10) || 0;
fireEl._handlers.pointerdown[0]();
pendingTimers.splice(0).forEach((f) => f());
{ const cb = rafCb; th += 1000; cb(th); }
check('长按 1 秒 = 5 发（基础 5 发/秒）', (parseInt(txt('bounty'), 10) || 0) === holdBefore + 5,
  holdBefore + ' -> ' + txt('bounty'));
fireEl._handlers.pointerup[0]();

importSave(mkSave({ bounty: 0, total: 0, tech: { i2: 1, i5: 1, i6: 1 } }));
{ const cb = rafCb; th += 1000; cb(th); }
const holdBefore2 = parseInt(txt('bounty'), 10) || 0;
fireEl._handlers.pointerdown[0]();
pendingTimers.splice(0).forEach((f) => f());
{ const cb = rafCb; th += 1000; cb(th); }
check('点满两级 = 10 发/秒', (parseInt(txt('bounty'), 10) || 0) === holdBefore2 + 10,
  holdBefore2 + ' -> ' + txt('bounty'));
fireEl._handlers.pointerup[0]();

importSave(mkSave({ bounty: 0, total: 0, tech: {} }));
const holdBefore3 = parseInt(txt('bounty'), 10) || 0;
fireEl._handlers.pointerdown[0]();
pendingTimers.splice(0).forEach((f) => f());
{ const cb = rafCb; th += 1000; cb(th); }
check('未研究时长按无效', (parseInt(txt('bounty'), 10) || 0) === holdBefore3,
  holdBefore3 + ' -> ' + txt('bounty'));
fireEl._handlers.pointerup[0]();

console.log('\n[9i] 科技树 21 节点 / 总成本 3890');
importSave(mkSave({ tech: {} }));
click('tab-tech');
const tl = nodes.get('tech-list');
check('科技页 27 张卡（1 hud + 1 兑换 + 4 分支头 + 21 节点）', tl.children.length === 27,
  'n=' + tl.children.length);
let costSum = 0;
let nodeCount = 0;
for (let ci = 2; ci < tl.children.length; ci++) {
  const card = tl.children[ci];
  if (card.className === 'tech-branch') { continue; }
  costSum += parseInt(card.children[2].children[1].textContent, 10) || 0;
  nodeCount++;
}
check('21 个节点', nodeCount === 21, 'n=' + nodeCount);
check('总成本 3890', costSum === 3890, 'sum=' + costSum);
check('火力进度 0/5', tl.children[2].children[2].textContent === '0/5', tl.children[2].children[2].textContent);
check('智能进度 0/6', tl.children[20].children[2].textContent === '0/6', tl.children[20].children[2].textContent);

console.log('\n[9j] GM 面板（连点标题 7 次）');
const titleEl = nodes.get('game-title');
const gmModal = nodes.get('gm-modal');
gmModal.classList.add('hidden');          // 模拟 HTML 里的初始 hidden
check('GM 默认关闭', gmModal.classList.contains('hidden') === true);
for (let i = 0; i < 7; i++) titleEl._handlers.click[0]();
check('连点标题 7 次打开 GM', gmModal.classList.contains('hidden') === false);
const gmBody = nodes.get('gm-body');
check('GM 分组齐全', gmBody.children.length > 15, 'n=' + gmBody.children.length);

importSave(mkSave({ bounty: 0, total: 0, tech: {} }));
const gmBtns = gmBody.children.filter((c) => c.className !== 'gm-group');
const findGm = (label) => gmBtns.find((b) => b.textContent === label);
check('有「赏金 +1M」按钮', !!findGm('赏金 +1M'));
findGm('赏金 +1M')._handlers.click[0]();
check('GM 赏金 +1M', txt('bounty') === '1.00M', txt('bounty'));

findGm('一键全解')._handlers.click[0]();
click('tab-tech');
check('全解后火力 5/5', tl.children[2].children[2].textContent === '5/5', tl.children[2].children[2].textContent);
check('全解后智能 6/6', tl.children[20].children[2].textContent === '6/6', tl.children[20].children[2].textContent);

click('gm-exit');
check('退出 GM 后关闭面板', gmModal.classList.contains('hidden') === true);

console.log('\n[9k] 旧档科技 id 迁移（v < 4）');
const flagOf = (i) => tl.children[i].children[1].children[0].children[1].textContent;
importSave(mkSave({ v: 3, tech: { f4: 1, l6: 1, b6: 1, f3: 1 } }));
check('旧 f4（暴击）→ 新 f3', flagOf(5) === '已研究', flagOf(5));
check('旧 l6 → 新 l5', flagOf(13) === '已研究', flagOf(13));
check('旧 b6 → 新 b5', flagOf(19) === '已研究', flagOf(19));
check('被砍掉的旧 f3 不落到新节点上', flagOf(7) !== '已研究', flagOf(7));
importSave(mkSave({ v: 4, tech: { f3: 1 } }));
check('v4 新档直接按新 id 读', flagOf(5) === '已研究', flagOf(5));

console.log('\n[10] 导出 / 非法存档 / 存储键');
click('btn-export');
const code1 = nodes.get('save-text').value;
check('导出得到存档码', code1.length > 10, 'len=' + code1.length);
nodes.get('save-text').value = '这不是存档码!!!';
click('btn-import');
check('坏存档不崩溃且被拒绝', txt('save-hint').indexOf('无效') >= 0, txt('save-hint'));
check('存档写入新键名', store.has('dse_save_v2'));
check('不再写旧题材的键名', store.has('lcz_save_v1') === false && store.has('lcz_save_v2') === false);

console.log('\n[11] 切后台 / 回前台');
document.hidden = true;
(docHandlers.visibilitychange || []).forEach((f) => f());
document.hidden = false;
(docHandlers.visibilitychange || []).forEach((f) => f());
check('visibilitychange 未抛异常', true);

console.log('\n[11b] 离线结算弹窗');
const saveG = { v: 3, bounty: 0, total: 0, manual: 0, auto: 0, clicks: 0,
  weapons: { pistol: 10 }, gear: {}, offlineTier: 0,
  prestige: 0, prestigeCount: 1, runBase: 0, soldiers: {},
  blueprints: 0, tech: {}, playTime: 0, hordeProgress: 0, hordeLeft: 0, hordeCooldown: 0,
  lastSeen: Date.now() };
nodes.get('save-text').value = btoa(JSON.stringify(saveG));
click('btn-import');
click('offline-ok');            // 先关掉可能残留的弹窗（DOM 桩不会读 HTML 里的初始 class）
check('导入本身不弹离线窗', nodes.get('offline-modal').classList.contains('hidden') === true);

// 切后台存一次档 → 把时间拨快 3 小时 → 回前台结算
document.hidden = true;
(docHandlers.visibilitychange || []).forEach((f) => f());
const offlineNow = Date.now();
class OfflineFakeDate extends Date { static now() { return offlineNow + 3 * 3600 * 1000; } }
sandbox.Date = OfflineFakeDate;
document.hidden = false;
(docHandlers.visibilitychange || []).forEach((f) => f());
sandbox.Date = Date;

check('回来后弹出离线弹窗', nodes.get('offline-modal').classList.contains('hidden') === false);
check('离线时长按上限截断成 2 小时', txt('offline-duration') === '2 小时 0 分', txt('offline-duration'));
check('带回赏金 = 1.56/秒 × 7200 秒 × 25% = +2.81K', txt('offline-gain') === '+2.81K', txt('offline-gain'));
check('说明写了效率与上限',
  txt('offline-text').indexOf('离线效率 25%') >= 0 && txt('offline-text').indexOf('2 小时') >= 0,
  txt('offline-text'));
check('超出上限有提示', txt('offline-text').indexOf('已达上限') >= 0, txt('offline-text'));
click('offline-ok');
check('点「收下」关闭弹窗', nodes.get('offline-modal').classList.contains('hidden') === true);

console.log('\n[12] 军火库十连购买');
const saveE = { v: 3, bounty: 1000000, total: 1000000, manual: 0, auto: 0, clicks: 0,
  weapons: { pistol: 0 }, gear: {}, offlineTier: 0,
  prestige: 0, prestigeCount: 0, runBase: 0, soldiers: {},
  blueprints: 0, tech: {}, playTime: 0, hordeProgress: 0, hordeLeft: 0, eliteProgress: 0, lastSeen: Date.now() };
nodes.get('save-text').value = btoa(JSON.stringify(saveE));
click('btn-import');
click('tab-arsenal');
const pRow0 = nodes.get('weapons').children[0];
check('默认是单次购买', pRow0.children[2].children[0].textContent === '获取',
  pRow0.children[2].children[0].textContent);
check('单买价格 15', pRow0.children[2].children[1].textContent === '15',
  pRow0.children[2].children[1].textContent);

click('bulk-10');
check('切到 ×10 后按钮标签变化', pRow0.children[2].children[0].textContent === '获取 ×10',
  pRow0.children[2].children[0].textContent);
check('十连价格 = 等比求和 305', pRow0.children[2].children[1].textContent === '305',
  pRow0.children[2].children[1].textContent);

pRow0.children[2]._handlers.click[0]();
check('一次买到 ×10', pRow0.children[1].children[0].children[1].textContent === '×10',
  pRow0.children[1].children[0].children[1].textContent);
check('十把枪的单发伤害 (1+10×1.2)×1.3 = 16.9', txt('click-power') === '16.9', txt('click-power'));

click('bulk-1');
check('切回单次后价格按已拥有 10 把重算', pRow0.children[2].children[1].textContent === '61',
  pRow0.children[2].children[1].textContent);

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('全部通过 ✅');
