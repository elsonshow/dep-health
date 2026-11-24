# npm 依赖现状实测：34 个「已被官方弃用」的包，每周仍被下载 6.92 亿次

> 数据全部来自 npm registry 公开 API，**2026-11-24 实测**，脚本可复现，无人工判断。
> 原始数据：[`data/risk-index.json`](data/risk-index.json) ｜ 生成脚本：[`scripts/build-risk-index.js`](scripts/build-risk-index.js)
> 复现：`node scripts/build-risk-index.js`

## 一句话结论

我在 58 个跨年代、跨生态位的高知名度包里拉了实时 registry 数据，
其中 **34 个已被 npm 官方标记为 deprecated**，14 个最新版已停更 ≥ 24 个月。
这 48 个包**合计每周仍被下载 691,953,410 次**——平均每个每周 1440 万次。

也就是说：**「已弃用」这个标签，几乎没有改变真实世界的安装量。**

## 为什么这件事值得记录

大多数团队判断依赖风险的方式是「跑一次 `npm audit`」。
但 `npm audit` 只报**安全漏洞**，不报**弃用**、也不报**停更**。
一个包可以同时是：

- 完全没有任何 CVE（所以 `audit` 是干净的）
- 已被作者明确写下「不要再用我」
- 每周被几千万个项目安装

这一类依赖不会出现在任何漏洞告警里，却是真实的技术债。

## 前 10 名（按周下载量）

| 包 | 周下载量 | 状态 | npm 官方原文（节选） |
| --- | ---: | --- | --- |
| `punycode` | 307,228,493 | 停更 37 个月 | —（无 deprecated 标记，但最新版停在 2023-10） |
| `inflight` | 131,262,549 | **已弃用** | "This module is not supported, and leaks memory. Do not use it." |
| `url` | 30,881,724 | 停更 28 个月 | — |
| `domexception` | 28,172,451 | **已弃用** | "Use your platform's native DOMException instead" |
| `os-tmpdir` | 27,354,039 | **已弃用** | "This is not needed anymore. `require('os').tmpdir()`…" |
| `abab` | 27,111,881 | **已弃用** | "Use your platform's native atob() and btoa() methods instead" |
| `querystring` | 18,145,080 | **已弃用** | "The querystring API is considered Legacy." |
| `request` | 13,613,888 | **已弃用** | "request has been deprecated" |
| `har-validator` | 13,613,029 | **已弃用** | — |
| `source-map-resolve` | 12,923,514 | **已弃用** | — |

## 完整名单（34 个已弃用）

`inflight`, `domexception`, `os-tmpdir`, `abab`, `querystring`, `request`,
`har-validator`, `source-map-resolve`, `os-homedir`, `stable`, `source-map-url`,
`resolve-url`, `urix`, `w3c-hr-time`, `subscriptions-transport-ws`,
`@babel/polyfill`, `left-pad`, `tslint`, `node-uuid`, `gulp-util`,
`apollo-server-core`, `coffee-script`, `node-sass`, `babel-preset-es2015`,
`nomnom`, `angular`, `jade`, `phantomjs-prebuilt`, `q`, `babel-eslint`,
`eslint-loader`, `friendly-errors-webpack-plugin`, `mkdirp-promise`,
`node-pre-gyp`

停更但未标记弃用的 14 个：`punycode`, `url`, `worker-rpc`, `bower`,
`vue-resource`, `bluebird`, `when`, `promise`, `es6-promise`, `babel-core`,
`uglifyjs-webpack-plugin`, `optimize-css-assets-webpack-plugin`, `ncp`, `fibers`

## 怎么用这份数据

1. **不要**因为一个包在名单里就立刻升级。`inflight` 是 `glob` 的传递依赖，
   直接删会炸整棵树。
2. 先看它是**直接依赖**还是**传递依赖**：`npm ls <包名>`。
3. 传递依赖的正确做法是升级**引入它的那个直接依赖**，不是硬改 lockfile。
4. `punycode` 和 `url` 属于 Node 内置模块的 polyfill，通常由某个上游包自动注入，
   升级上游即可消失。

## 方法边界（诚实说明）

- 下载量来自 `api.npmjs.org/downloads/point/last-week/<包>`，是 npm 的公开统计，
  **包含 CI 与镜像**，不等于真实用户数。
- 「停更」定义为最新版本发布时间距今 ≥ 24 个月，这是我的阈值，不是 npm 的官方定义。
- 候选池是我手工列的 58 个高知名度包，**不是**全量 npm 扫描；
  因此「34 个」是这个池子里的计数，不能外推为「npm 上共有 34 个弃用包」。
- 数据有时效性，上面的数字是 2026-11-24 的快照。

## 复现

```bash
git clone https://github.com/elsonshow/dep-health
cd dep-health
node scripts/build-risk-index.js     # 重新拉实时数据并重写 risk-index.html
```

脚本对每个包调用两个公开端点（`registry.npmjs.org/<包>` 与
`api.npmjs.org/downloads/point/last-week/<包>`），不登录、不带 key、不缓存过期数据。
