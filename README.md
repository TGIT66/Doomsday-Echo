# 末日残响 / Doomsday Echo（v0.4.2）

一个纯前端的离线放置增量游戏，原创末日丧尸题材。
**个人练习作，仅供自己手机安装使用。**

## 目录结构

本地目录 = 仓库根目录，上传时把这里的**内容**（不是外层文件夹）拖进 GitHub 仓库根目录即可。

```
（仓库根）
├─ index.html      界面结构（顶部状态 + 开火区 + 底部四个 tab）
├─ style.css       样式（冷灰 + 血色 + 警报黄）
├─ game.js         全部游戏逻辑（数值都在文件顶部「配置区」）
├─ manifest.json   PWA 清单，让 Chrome 认它是可安装应用
├─ sw.js           Service Worker，负责离线缓存
├─ CHANGELOG.md    ★ 更新日志：每次改动都记一条，并给版本号
├─ README.md       本文件
├─ icons/          图标（192 / 512，由 tools/make_icons.py 生成）
├─ docs/           设计文档（design-v0.2.md；legacy/ 放旧题材 PRD）
└─ tools/          辅助脚本（生成图标、冒烟测试、旧 PRD 生成器）
```

> 游戏必须放在仓库**根目录**，GitHub Pages 的地址才是干净的
> `https://<用户名>.github.io/Doomsday-Echo/`；放进子文件夹会多一层路径。

## 改代码之前先看这个

**每次改动都要做两件事**，缺一个就会出问题：

1. 在 [`CHANGELOG.md`](CHANGELOG.md) 里加一条记录，给个版本号
2. 把 `sw.js` 里 `CACHE = 'dse-vN'` 的 N **+1**

第 2 条最容易被忘。忘了的表现是"代码明明改了，手机上还是老样子"。

## 本地预览

直接双击 `index.html` 就能在电脑浏览器里玩。
（`file://` 下 Service Worker 不生效，但游戏本身照常运行。）

## 当前玩法

- **开火**：点中央的准星按钮，每发造成「单发伤害」点赏金，每 25 发来一只精英（赏金 ×5）
- **军火库**：9 把武器，从手枪到轨道炮，成本 ×1.15 复利，每把同时提供单发伤害和自动赏金
- **战术装备**：7 件，加减点伤、乘点伤、乘自动产出
- **营地补给**：离线收益 6~24 小时分档，效率 100%
- **生存等级**：10 级，按累计赏金判定（0 → 1e20）
- **军队**：撤退重整的入口已就位，v0.5.0 实装声望与士兵
- **科技**：三分支骨架已就位，v0.6.0 实装蓝图与科技树

## 部署到手机（Android）

全程不需要命令行、不需要 git。

**路线 A：Cloudflare Drop** —— 打开 <https://cloudflare.com/drop>，把本目录**里面的文件**拖进去，
拿到 `https://xxx.workers.dev`，点 **Claim** 认领成永久网址，手机 Chrome「安装应用」。

**路线 B：Netlify Drop** —— <https://app.netlify.com/drop>，流程同上。

**路线 C：GitHub Pages** —— 把文件上传到仓库**根目录** → Settings → Pages → main / (root) → Save。
地址是 `https://<用户名>.github.io/Doomsday-Echo/`。

> Service Worker 和「安装到主屏幕」都要求 HTTPS，所以必须走一次托管。
> 装好之后就是本地的，跟服务器再没关系。

## 改了代码怎么更新

1. 改完代码，把 `sw.js` 里 `CACHE` 的 N **+1**（当前 `dse-v7`，下次 `dse-v8`）
2. 手机上旧版里**导出存档**（💾 → 导出 → 复制）
3. 重新部署（拖文件夹 / 覆盖上传）
4. 新网址或刷新后，导入存档码

## 想调数值 / 改设定

全部集中在 `game.js` 顶部「配置区」：

- `WEAPONS`：9 把武器，字段 `baseCost` / `costMult` / `rate`（自动赏金）/ `dmg`（单发伤害）。
- `GEAR`：战术装备，`type` 支持 `clickAdd` / `clickMult` / `globalMult`。
- `RANKS`：生存等级名称与阈值。
- `OFFLINE_TIERS`：补给各档的 `hours` / `unlock` / `costPct`。
- `PRESTIGE_AT` / `ELITE_EVERY` / `ELITE_MULT`：转生门槛与精英节奏。
- `revealAt()`：列表渐进解锁，规则是「上一档基础成本的一半」，加档位不用改。

## 已知边界（本阶段故意不做的）

- 军队/声望（v0.5.0）、科技树（v0.6.0）
- 成就系统、音效、成就
- 云存档（完全离线，只有本地存档 + 存档码）
- 大数库（原生 number 到 1e308 才需要）

## 版本切分

| 版本 | 内容 |
|---|---|
| v0.4.0 | 题材化：末日丧尸、军火库/战术装备、单发伤害、底部 tab |
| v0.5.0 | 军队：声望、士兵、军队等级、撤退重整、离线并入军队 |
| v0.6.0 | 科技：蓝图、三分支科技树 |
