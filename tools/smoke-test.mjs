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
  setTimeout: () => 0,
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
check('战术装备全部隐藏', nodes.get('gear').children.every((c) => c.style.display === 'none'));
check('科技页 = 蓝图条 + 3 分支 × 7', nodes.get('tech-list').children.length === 22,
  'n=' + nodes.get('tech-list').children.length);
check('战报统计初始为 0', txt('stat-manual') === '0' && txt('stat-auto') === '0' && txt('stat-total') === '0');
check('精英进度提示', txt('fire-note').indexOf('下一只精英') >= 0, txt('fire-note'));

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
check('40 发含 1 只精英 = 44 赏金', txt('bounty') === '44', txt('bounty'));
check('点射统计入账', txt('stat-manual') === '44', txt('stat-manual'));
check('自动仍为 0', txt('stat-auto') === '0', txt('stat-auto'));
check('精英提示条弹出', txt('toast').indexOf('精英') >= 0, txt('toast'));

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

console.log('\n[6] 战术装备');
for (let i = 0; i < 12; i++) click('fire');
const gRow = nodes.get('gear').children[0];
check('穿甲弹已解锁', gRow.style.display !== 'none', gRow.style.display);
const gBtn = gRow.children[2];
check('攒够 25 可买', gBtn.disabled === false, 'cost=' + gBtn.children[1].textContent);
gBtn._handlers.click[0]();
check('单发伤害 = (1 + 枪 1) × 穿甲弹 1.5 = 3', txt('click-power') === '3', txt('click-power'));
check('穿甲弹是一次性装备', gRow.children[1].children[0].children[1].textContent === '已装备',
  gRow.children[1].children[0].children[1].textContent);

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

console.log('\n[9] 声望与士兵');
const saveB = { v: 3, bounty: 20000, total: 200000000, manual: 300000, auto: 900000, clicks: 500,
  weapons: { pistol: 12, smg: 3 }, gear: { ammo: 2 }, offlineTier: 0,
  prestige: 500, prestigeCount: 2, runBase: 0, soldiers: {}, lastSeen: Date.now() };
nodes.get('save-text').value = btoa(JSON.stringify(saveB));
click('btn-import');
check('赏金保留', txt('bounty') === '20.00K', txt('bounty'));
check('等级按累计判定（猎手）', txt('realm') === '猎手', txt('realm'));
check('自动产出 = 4.2', txt('rate') === '+4.20 / 秒', txt('rate'));
check('单发伤害 = (1+12+6) × 1.5 = 28.5', txt('click-power') === '28.5', txt('click-power'));
click('tab-army');
const hud = nodes.get('army-list').children[0];
const pCard = nodes.get('army-list').children[1];
const rookieRow = nodes.get('army-list').children[2];
const engRow = nodes.get('army-list').children[3];
const officerRow = nodes.get('army-list').children[5];
check('声望显示 500', hud.children[1].textContent === '500', hud.children[1].textContent);
check('军队等级提示 Lv.0', hud.children[2].textContent.indexOf('Lv.0') >= 0, hud.children[2].textContent);
check('可重整', pCard.children[2].disabled === false);
check('重整显示声望 +14', pCard.children[2].children[1].textContent === '声望 +14',
  pCard.children[2].children[1].textContent);

rookieRow.children[2]._handlers.click[0]();
check('招募新兵后声望 -1', hud.children[1].textContent === '499', hud.children[1].textContent);
check('新兵 ×1', rookieRow.children[1].children[0].children[1].textContent === '×1',
  rookieRow.children[1].children[0].children[1].textContent);
check('自动产出 ×1.03 = 4.33', txt('rate') === '+4.33 / 秒', txt('rate'));

check('工兵首价 5', engRow.children[2].children[1].textContent === '5', engRow.children[2].children[1].textContent);
engRow.children[2]._handlers.click[0]();
check('招募工兵后声望 -5', hud.children[1].textContent === '494', hud.children[1].textContent);
check('单发伤害 ×1.08 = 30.8', txt('click-power') === '30.8', txt('click-power'));

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
check('单发伤害回落到 1.08', txt('click-power') === '1.08', txt('click-power'));
check('自动产出归零', txt('rate') === '+0 / 秒', txt('rate'));
check('重整后按钮变灰（本局产出不足）', pCard.children[2].disabled === true);

console.log('\n[9c] 重整后离线解锁 + 军官 + 军队等级');
click('tab-log');
check('离线解锁 Lv.1', offLv() === 'Lv.1', offLv());
check('上限 2 小时', offDesc().indexOf('2 小时') >= 0, offDesc());
check('效率 50%', offDesc().indexOf('50%') >= 0, offDesc());

click('tab-army');
check('军官首价 25', officerRow.children[2].children[1].textContent === '25', officerRow.children[2].children[1].textContent);
officerRow.children[2]._handlers.click[0]();
check('军官 ×1', officerRow.children[1].children[0].children[1].textContent === '×1',
  officerRow.children[1].children[0].children[1].textContent);
check('军官把上限加到 3 小时', officerRow.children[1].children[2].textContent.indexOf('3 小时') >= 0,
  officerRow.children[1].children[2].textContent);

for (let i = 0; i < 9; i++) rookieRow.children[2]._handlers.click[0]();
check('兵力 10+ 后升到军队 Lv.1', hud.children[2].textContent.indexOf('Lv.1') >= 0, hud.children[2].textContent);

console.log('\n[9d] 科技');
click('tab-tech');
check('科技页 = 蓝图条 + 3 分支 × (标题 + 6 节点)', nodes.get('tech-list').children.length === 22,
  'n=' + nodes.get('tech-list').children.length);
const techHud = nodes.get('tech-list').children[0];
check('重整给了 4 蓝图', techHud.children[1].textContent === '4', techHud.children[1].textContent);
check('尸潮倒计时存在', techHud.children[2].textContent.indexOf('尸潮') >= 0, techHud.children[2].textContent);

const f1Row = nodes.get('tech-list').children[2];
const f2Row = nodes.get('tech-list').children[3];
check('f1 可研究', f1Row.children[2].disabled === false, f1Row.children[2].children[1].textContent);
check('f2 需前置',
  f2Row.children[2].disabled === true && f2Row.children[1].children[0].children[1].textContent === '需前置',
  f2Row.children[1].children[0].children[1].textContent);

const dmgBeforeTech = parseFloat(txt('click-power'));
f1Row.children[2]._handlers.click[0]();
check('研究后蓝图 4 - 4 = 0', techHud.children[1].textContent === '0', techHud.children[1].textContent);
check('单发伤害被 ×1.15 放大', parseFloat(txt('click-power')) > dmgBeforeTech,
  dmgBeforeTech + ' -> ' + txt('click-power'));
check('f1 标记已研究', f1Row.children[1].children[0].children[1].textContent === '已研究',
  f1Row.children[1].children[0].children[1].textContent);
check('f2 变为蓝图不足', f2Row.children[1].children[0].children[1].textContent === '蓝图不足',
  f2Row.children[1].children[0].children[1].textContent);

const bpBeforeElite = parseInt(techHud.children[1].textContent, 10);
for (let i = 0; i < 40; i++) click('fire');
check('击杀精英 +1 蓝图', parseInt(techHud.children[1].textContent, 10) === bpBeforeElite + 1,
  bpBeforeElite + ' -> ' + techHud.children[1].textContent);

const bpBeforeHorde = parseInt(techHud.children[1].textContent, 10);
let t2 = 20000;
for (let i = 0; i < 310; i++) { const cb = rafCb; t2 += 1000; cb(t2); }
check('尸潮按时到达并给蓝图', parseInt(techHud.children[1].textContent, 10) > bpBeforeHorde,
  bpBeforeHorde + ' -> ' + techHud.children[1].textContent);

console.log('\n[9e] 尸群研究缩短精英间隔');
const saveD = { v: 3, bounty: 50000, total: 200000000, manual: 1000, auto: 1000, clicks: 0,
  weapons: { pistol: 10 }, gear: {}, offlineTier: 0,
  prestige: 100, prestigeCount: 2, runBase: 0, soldiers: {},
  blueprints: 100, tech: { b1: 1 }, playTime: 0, lastHorde: 0, eliteProgress: 0, lastSeen: Date.now() };
nodes.get('save-text').value = btoa(JSON.stringify(saveD));
click('btn-import');
click('tab-tech');
check('提示显示每 30 发一只', txt('fire-note').indexOf('每 30 发') >= 0, txt('fire-note'));
const bpBefore30 = parseInt(nodes.get('tech-list').children[0].children[1].textContent, 10);
for (let i = 0; i < 30; i++) click('fire');
check('30 发就出精英（间隔确实生效）',
  parseInt(nodes.get('tech-list').children[0].children[1].textContent, 10) === bpBefore30 + 1,
  bpBefore30 + ' -> ' + nodes.get('tech-list').children[0].children[1].textContent);

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

console.log('\n[12] 军火库十连购买');
const saveE = { v: 3, bounty: 1000000, total: 1000000, manual: 0, auto: 0, clicks: 0,
  weapons: { pistol: 0 }, gear: {}, offlineTier: 0,
  prestige: 0, prestigeCount: 0, runBase: 0, soldiers: {},
  blueprints: 0, tech: {}, playTime: 0, lastHorde: 0, eliteProgress: 0, lastSeen: Date.now() };
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
check('十把枪的单发伤害 1 + 10 = 11', txt('click-power') === '11', txt('click-power'));

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
