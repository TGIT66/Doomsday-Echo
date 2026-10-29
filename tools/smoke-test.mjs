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
check('科技三分支', nodes.get('tech-list').children.length === 3, 'n=' + nodes.get('tech-list').children.length);
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
for (let i = 0; i < 25; i++) click('fire');
check('25 发含 1 只精英 = 29 赏金', txt('bounty') === '29', txt('bounty'));
check('点射统计入账', txt('stat-manual') === '29', txt('stat-manual'));
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
check('单发伤害 = 1 + 枪 1 + 穿甲弹 2 = 4', txt('click-power') === '4', txt('click-power'));
check('等级显示 Lv.1', gRow.children[1].children[0].children[1].textContent === 'Lv.1',
  gRow.children[1].children[0].children[1].textContent);

console.log('\n[7] 底部 tab 切换');
click('tab-army');
check('军队面板激活', nodes.get('panel-army').classList.contains('active'));
check('军火库面板隐藏', nodes.get('panel-arsenal').classList.contains('active') === false);
click('tab-log');
check('战报面板激活', nodes.get('panel-log').classList.contains('active'));

console.log('\n[8] 撤退重整占位 + 存档往返');
const save = { v: 2, bounty: 20000, total: 200000000, manual: 300000, auto: 900000, clicks: 500,
  weapons: { pistol: 12, smg: 3 }, gear: { ammo: 2 }, offlineTier: 0, lastSeen: Date.now() };
nodes.get('save-text').value = btoa(JSON.stringify(save));
click('btn-import');
check('导入成功', txt('save-hint').indexOf('成功') >= 0, txt('save-hint'));
check('赏金保留', txt('bounty') === '20.00K', txt('bounty'));
check('等级按累计判定（猎手）', txt('realm') === '猎手', txt('realm'));
const pCard = nodes.get('army-list').children[0];
check('撤退重整按钮可用', pCard.children[2].disabled === false, pCard.children[2].children[1].textContent);
check('显示可重整', pCard.children[2].children[1].textContent === '可重整', pCard.children[2].children[1].textContent);

console.log('\n[8b] 营地补给');
click('tab-log');
const offRow = nodes.get('offline-list').children[0];
const offLv = () => offRow.children[1].children[0].children[1].textContent;
const offCost = () => offRow.children[2].children[1].textContent;
check('初始 Lv.1', offLv() === 'Lv.1', offLv());
check('达标后显示成本而非门槛', offCost().indexOf('开启') < 0, offCost());
offRow.children[2]._handlers.click[0]();
check('提升到 Lv.2', offLv() === 'Lv.2', offLv());

console.log('\n[9] 导出 / 非法存档 / 存储键');
click('btn-export');
const code1 = nodes.get('save-text').value;
check('导出得到存档码', code1.length > 10, 'len=' + code1.length);
nodes.get('save-text').value = '这不是存档码!!!';
click('btn-import');
check('坏存档不崩溃且被拒绝', txt('save-hint').indexOf('无效') >= 0, txt('save-hint'));
check('存档写入新键名', store.has('dse_save_v2'));
check('不再写旧题材的键名', store.has('lcz_save_v1') === false && store.has('lcz_save_v2') === false);

console.log('\n[10] 切后台 / 回前台');
document.hidden = true;
(docHandlers.visibilitychange || []).forEach((f) => f());
document.hidden = false;
(docHandlers.visibilitychange || []).forEach((f) => f());
check('visibilitychange 未抛异常', true);

console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('全部通过 ✅');
