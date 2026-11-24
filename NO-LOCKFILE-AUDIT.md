# 还没装依赖的时候，怎么查依赖的漏洞？

> 本文所有输出都是实测，可复现。工具：`elsonshow/dep-health`。

## 一个具体的困境

你 `git clone` 了一个仓库，或者同事发来一份 `package.json` 让你评一评，
你想知道「这些依赖有没有已知漏洞」。

第一反应是 `npm audit`。那就试试。

## 实测：`npm audit` 在这个场景会直接拒绝

目录里只有 `package.json`：

```json
{
  "dependencies": {
    "axios": "^0.21.1",
    "lodash": "^4.17.21",
    "jsonwebtoken": "^8.5.1"
  }
}
```

跑 `npm audit`：

```
$ npm audit
npm error code ENOLOCK
npm error audit This command requires an existing lockfile.
npm error audit Try creating one first with: npm i --package-lock-only
npm error audit Original error: loadVirtual requires existing shrinkwrap file
```

**它宁可报错也不给你结果。** 这不是 bug——`npm audit` 的正确性建立在 lockfile 上：
只有知道**精确锁定的版本**，它才能给出准确的漏洞列表。

问题在于，你此刻恰恰没有 lockfile。

## 这个场景比看上去常见

- **刚 clone 一个仓库**，还没跑 `npm install`
- **评审外包/供应商交付的代码**，只有 `package.json`
- **决定要不要引入某个依赖**之前，先看看它有坑没
- 仓库用 **pnpm / yarn**，而你在 npm 下跑 `audit`（多数情况下也拿不到结果）
- CI 里想做一个**安装之前**的快速筛查，不想为了检查先花几分钟装依赖

## 换成只读 package.json 的工具

同一份 `package.json`，不装依赖，直接分析：

```
平均健康分 51/100 · 高危 0

包              分数   状态      已知漏洞
axios            33   critical    24
lodash           70   watch        2
jsonwebtoken     50   risk         3
```

具体到每个包：

- **axios** — 范围下限 `0.21.1` 有 **24 个**已知漏洞（最高 MODERATE）
- **lodash** — 范围下限 `4.17.21` 有 **2 个**已知漏洞（最高 MODERATE）
- **jsonwebtoken** — 范围下限 `8.5.1` 有 **3 个**已知漏洞（最高 MODERATE）

`npm audit` 一行都不给你，这边直接列出 32 个。

## 但必须说清这个方法的代价

上面的输出有一句关键的话，别跳过：

> 范围下限 0.21.1 有 24 个已知漏洞；**实际安装的可能已是 1.21.1**，请以 `npm ls` 为准

原因很直接：没有 lockfile，就不知道你实际会装哪个版本。
工具只能拿 `package.json` 里**能确定的下界**（`^0.21.1` 的下界是 `0.21.1`）去查漏洞。

所以：

- `^0.21.1` 实际可能装到 `1.21.1`，而 `1.21.1` 是 0 漏洞 → **24 这个数字是上界，不是事实**
- 反过来，如果你写死了 `"axios": "0.21.1"`，那 `0.21.1` 就是你会装的版本 → **24 是事实**

**结论：这个数字是「最坏情况」，不是「你的现状」。**

## 所以两者该怎么用

| 你想做的事 | 用什么 |
| --- | --- |
| 已经装了依赖，要精确漏洞报告 | `npm audit`（更准，基于 lockfile） |
| 还没装依赖，先快速看风险面 | 只读 `package.json` 的工具 |
| 在 PR 里按阈值拦住合并 | GitHub Action 的 `fail-on` |
| 需要合规级 SBOM / 供应链证明 | Snyk / Socket 等商业方案 |

**如果你已经有 lockfile 且只在本地用，`npm audit` 够用，不必换工具。** 这句话我写在 README 里，也写在这里。

## 一个必须提的设计取舍

因为这个数字是「最坏情况」，如果直接拿它阻断 CI，会误伤大量正常项目。

实测过的例子：一个只写了 `axios ^1.7.9` 的项目，
下限 `1.7.9` 有 33 个漏洞，但 `^1.7.9` 实际会解析到 `1.21.1`（0 漏洞）。
如果直接拿 33 去卡，一个依赖全在可升级范围内的项目会被判成「不安全」。

所以门禁做了区分：

- **可升级范围**（`^` / `~` 开头，且存在更高版本）→ 下限漏洞**不阻断**
- **精确锁定**（`1.7.9`）→ 下限就是实际版本，漏洞**阻断**
- **已被官方弃用** → 不论写法都阻断
- **已在最新版且仍有 HIGH 漏洞** → 阻断（升无可升）

这不是为了消误报而放水——精确锁死的项目仍然会被拦住。

## 自己复现

```bash
# 1. 造一个只有 package.json 的目录
mkdir demo && cd demo
cat > package.json <<'EOF'
{
  "dependencies": {
    "axios": "^0.21.1",
    "lodash": "^4.17.21",
    "jsonwebtoken": "^8.5.1"
  }
}
EOF

# 2. npm audit 会拒绝
npm audit          # -> ENOLOCK

# 3. 用只读 package.json 的工具
#    在线：https://elsonshow.github.io/dep-health/
#    或在 CI 里：uses: elsonshow/dep-health@v1
```

数据来自 `registry.npmjs.org`、`api.deps.dev`、`api.npmjs.org`、`api.osv.dev`，
全部是公开只读接口，不需要 token，不上传你的代码。

## 一句话总结

`npm audit` 更强，但它要求你先装依赖。
**这个工具填的是「你还没装、但想先知道」的那几分钟。**
它不是替代品，它填的是一个空档。
