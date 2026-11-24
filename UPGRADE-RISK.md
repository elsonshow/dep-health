# 升级风险评估：落后几个大版本 ≠ 该不该升级

> 一个真实项目（19 个依赖）的实测输出。脚本开源可复现。
> 数据全部来自 npm registry 公开接口，无 key、无登录。

## 为什么「落后 N 个大版本」这个数字没用

大多数依赖检查工具会告诉你：`vitest 落后 3 个大版本`、`typescript 落后 2 个大版本`。

然后你面对一个无法回答的问题：**现在该升吗？**

这两个数字看起来差不多，实际完全相反：

| 包 | 落后 | 最新版发布日期 | 距今 |
| --- | --- | --- | --- |
| `typescript` | 2 个大版本 | 2026-07-08 | **139 天** |
| `vitest` | 3 个大版本 | 2026-11-18 | **6 天** |

`typescript 7` 已经发布 139 天，生态跟上了，升级是正常维护。
`vitest 5` 才发布 6 天，你现在升就是拿自己的 CI 做小白鼠。

**同一个「落后」，风险完全相反。所以判断必须引入时间维度。**

## 实测：一个真实的 19 依赖项目

拿一个真实的开源浏览器扩展（Plasmo + React + Solana）跑一遍：

```
依赖总数: 19

包                      当前        最新        落后   最新版发布    建议
@noble/ed25519          ^2.1.0      3.2.0       1     2026-08-27   SAFE-TO-UPGRADE
@noble/hashes           ^1.5.0      2.4.0       1     2026-08-27   SAFE-TO-UPGRADE
@solana/web3.js         ^1.98.4     3.2.1       2     2026-11-10   TRY-IN-BRANCH
bip39                   ^3.1.0      3.1.2       -     2026-10-13   UP-TO-DATE
qrcode.react            ^4.2.0      4.2.0       -     2024-12-11   UP-TO-DATE
react                   18.3.1      19.3.1      1     2026-10-14   TRY-IN-BRANCH
react-dom               18.3.1      19.3.1      1     2026-10-14   TRY-IN-BRANCH
tweetnacl               ^1.0.3      1.0.3       -     2020-02-10   UP-TO-DATE
zustand                 ^5.0.2      5.1.0       -     2026-11-06   UP-TO-DATE
@ianvs/prettier-plugin  4.3.1       4.7.1       -     2026-02-04   UP-TO-DATE
@types/bip39            ^3.0.0      3.0.4       -     2024-10-23   STOP-USING
@types/chrome           0.0.278     0.3.7       3     2026-10-27   TRY-IN-BRANCH
@types/node             22.10.2     26.6.6      4     2026-10-28   TRY-IN-BRANCH
@types/react            18.3.18     19.3.0      1     2026-09-09   SAFE-TO-UPGRADE
@types/react-dom        18.3.5      19.3.0      1     2026-09-09   SAFE-TO-UPGRADE
plasmo                  0.89.4      0.90.5      1     2025-05-17   SAFE-TO-UPGRADE
prettier                3.4.2       3.10.1      -     2026-11-12   UP-TO-DATE
typescript              5.7.2       7.0.2       2     2026-07-08   SAFE-TO-UPGRADE
vitest                  2.1.9       5.1.1       3     2026-11-18   DO-NOT-UPGRADE-YET

汇总:
  SAFE-TO-UPGRADE      6
  TRY-IN-BRANCH        5
  UP-TO-DATE           6
  STOP-USING           1
  DO-NOT-UPGRADE-YET   1
```

## 五个结论（这就是「要不要升」的答案）

- **SAFE-TO-UPGRADE（6 个）** —— 目标版本发布超过 60 天，可以按正常节奏升。
- **TRY-IN-BRANCH（5 个）** —— 发布 14–60 天，先去分支试，别直接上主干。
- **DO-NOT-UPGRADE-YET（1 个）** —— `vitest` 只发布 6 天。等，别动。
- **STOP-USING（1 个）** —— `@types/bip39` 是 stub 类型包，官方已说明「bip39 自带类型」。
  正确动作是**删掉它**，不是升级。
- **UP-TO-DATE（6 个）** —— 无需动作。

## 我在这份报告里修掉的一个真实 bug

第一版脚本用「major 差值」判断落后程度，结果把 `@types/chrome 0.0.278 → 0.3.7` 判成 `UP-TO-DATE`——
因为两者的 major 都是 `0`，差值为 0。

但 `0.0.278 → 0.3.7` 是跨了 278 个补丁号的大跨度变化。

**0.x 版本里，minor 才是 breaking 位。** 修正后按 semver 语义分段比较：

- `major > 0` 时看 major 差
- `major === 0` 时看 minor 差

修正后 `@types/chrome` 正确显示落后 3 个 minor，`plasmo 0.89.4 → 0.90.5` 也正确显示落后 1 个。

这个 bug 如果不修，工具会告诉你「不用管」，而那恰好是最该看一眼的包之一。

## 自己跑一遍

```bash
node ops/upgrade-risk.mjs path/to/package.json          # 表格
node ops/upgrade-risk.mjs path/to/package.json --json   # 机器可读
```

每个包只调一个接口（`registry.npmjs.org/<包>`），读取 `dist-tags.latest` 与 `time[latest]`，
不缓存、不猜测、不使用第三方评分。

## 边界（必须说清）

- 「发布天数」是**必要不充分**条件。刚发布的大版本风险高；
  发布了很久的大版本也可能有生态未跟上的问题。它只是第一个筛子。
- 本工具**不做** breaking change 的具体识别：不解析 changelog、不比对 API 签名。
  那需要真实的 AST 或类型比对，不是靠 registry 元数据能得出的。
- 不读你的 lockfile，因此**传递依赖的风险不在此列**。
- 「建议」是基于发布时间阈值的机械规则（14 / 60 天），阈值为我所设，不是行业标准。
