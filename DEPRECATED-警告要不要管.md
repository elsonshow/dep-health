# 依赖里出现 deprecated 警告，到底要不要管？48 个包的实测答案

> 全部判断基于 **2026-11-24** 从 npm registry 公开 API 拉取的实时数据，数据与脚本一起开源，可自行复现。
> `npm install` 时看到 `deprecated` 警告，这篇是给你判断「要不要动手」的。

## 先给结论

**大部分情况不用管，但有三类必须处理。**

我按「装了会不会有事」把这 48 个包分成三档，并给出每一档的具体动作。
判断依据不是感觉，是三个可查的事实：包在不在维护、是不是原生模块、是直接依赖还是被拖进来的。

## 第一档：不用管（占了大多数）

**特征：纯 JS、功能已被平台内置取代、且你几乎不会是直接依赖它。**

这类包每周被下载上亿次，绝大多数来自 `glob`、`request`、`jsdom` 这些老包的下游。
你项目里出现它们，通常是因为**某个依赖的依赖**用了它们。

典型：

- `os-tmpdir` — 官方说明「已不需要，直接用 `os.tmpdir()`」
- `domexception` — 「用平台原生 `DOMException`」
- `abab` — 「用原生 `atob()` / `btoa()`」
- `querystring` — 「Legacy API，新代码用 `URLSearchParams`」

**动作：什么都不做。** 不要为了消掉警告去手动装替代品或改 lockfile。

为什么：这类包被上游依赖锁定，你改自己的 `package.json` 不会让它消失；
强行删还会破坏依赖树。等上游升级即可。

## 第二档：值得排期处理

**特征：你是直接依赖，或者它承担了实际功能。**

检查你是不是直接依赖：

```bash
npm ls <包名>
```

输出里如果出现在你的 `dependencies` 第一层，就是直接依赖。

典型：

- `moment` — 曾是最大的日期库之一。它在 npm 上从未被标记 deprecated，但已经**长期没有新版本**
  （项目维护者已转向 `luxon` 等后继方案）。体积大、可变对象、时区处理有坑。
  新项目应换 `date-fns` 或 `dayjs`；老项目不必紧急迁移，但要意识到它不再修 bug。
  *（注意：`moment` 不在本文的 48 包数据集内——数据集候选池里没有它。此处是常识性说明，
  具体停更月数以 npm 页面为准，本文不提供该数字。）*
- `request` — 已弃用多年。仍在用的项目应排期换 `undici` / `node-fetch` / 原生 `fetch`。
- `tslint` — 已废弃，换 `eslint`。

**动作：排进技术债，不要马上改。** 这类替换会牵动调用点，属于有计划的迁移，不是消警告。

## 第三档：必须尽快处理（真正会出事）

**特征：原生模块（需要编译），或内存/安全有明确问题。**

这一类是唯一「看到就该动手」的：

- `inflight` — 官方原文：**"This module is not supported, and leaks memory. Do not use it."**
  它是 `glob` 的依赖，node 生态里很多工具链会带进来。内存泄漏在生产长跑进程里是真问题。
- `node-sass` — 原生编译，与 Node 版本强绑定。换 `sass`（纯 JS，Dart Sass）。
- `node-pre-gyp` / `node-gyp` 相关 — 原生编译链，CI 里最常见的构建失败来源。
- `fibers` — 与新版 Node 不兼容，早已停止维护。
- `phantomjs-prebuilt` — PhantomJS 项目已终止，二进制下载源经常挂。

**动作：这些值得开 issue 排期。** 尤其 `node-sass` 和 `fibers`，它们会让你的 CI 在某次 Node 升级后突然红掉。

## 怎么快速自查（30 秒）

不要一个个查。用一条命令列出你项目里所有已弃用的直接依赖：

```bash
npm ls --all 2>/dev/null | grep -i deprecat
```

或者只看顶层：

```bash
npm outdated
```

如果你想要一份带「弃用标记 + 停更月数 + 周下载量」的清单，
可以直接把 `package.json` 粘到浏览器里跑一次体检（数据来自 npm registry / deps.dev / OSV.dev 公开接口，不上传代码）。

## 为什么「周下载 6.92 亿次」这件事重要

我实测的 48 个包里，34 个已被 npm 官方标记废弃，
**它们合计每周仍被下载 691,953,410 次**（平均每个每周 1440 万次）。

这说明：**`deprecated` 标签几乎不影响真实安装量。**
所以你在 `npm install` 看到它时，不必惊慌——但也不该完全无视，
因为「大家都不管」不代表「对你没事」，尤其第三档那几个。

## 数据与复现

- 完整名单与逐包数据：[`data/risk-index.json`](data/risk-index.json)
- 生成脚本：[`scripts/build-risk-index.js`](scripts/build-risk-index.js)（只调公开端点，无 key、无登录）
- 数字一致性校验：[`scripts/verify-article.mjs`](scripts/verify-article.mjs)

```bash
git clone https://github.com/elsonshow/dep-health
cd dep-health
node scripts/build-risk-index.js
node scripts/verify-article.mjs
```

## 一句实话

`npm audit` 不会告诉你这些——它只报安全漏洞。
一个包可以零 CVE、已被作者明确弃用、每周被几千万项目安装，这三点同时成立。
这类依赖不会出现在任何告警里，但它确实是债。

## 边界

- 下载量是 npm 公开统计，**包含 CI 与镜像**，不等于真实用户数。
- 「停更」= 最新版本距今 ≥ 24 个月，是我的阈值，不是 npm 官方定义。
- 候选池是我列的 58 个高知名度包，不是全量 npm 扫描；
  「34 个」是这个池子里的计数，不能外推成「npm 上共有 34 个弃用包」。
- 数字是 2026-11-24 的快照，会随时间变。
