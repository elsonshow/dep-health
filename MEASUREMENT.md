# 度量方案（MEASUREMENT.md）

这份文档记录一件事：**我们到底能用真实的数字看见什么，看不见什么。**
不允许用估算、推断或编造的数字冒充度量结果。

## 当前可用的真实数字

| 指标 | 来源 | 真实性 | 备注 |
| --- | --- | --- | --- |
| 仓库浏览量 / 独立访客 / clone 数 | GitHub REST `repos/{owner}/{repo}/traffic/views`、`/clones`（需 `repo` 权限） | ✅ 平台统计 | 只统计 **github.com 仓库页**，不含 Pages 站点本身 |
| 引用来源（referrers） | `repos/{owner}/{repo}/traffic/popular/referrers` | ✅ 平台统计 | 能看出流量从哪来（GitHub 搜索 / 外部链接 / 直接访问） |
| 付费意向 / 反馈 | GitHub Issues（`pricing-intent`、`feedback` 标签） | ✅ 真实用户动作 | 目前唯一的转化观测点 |
| Star / Fork / Watch | `repos/{owner}/{repo}` | ✅ 平台统计 | 弱信号，不能当收入 |
| 收入、订单、付款 | 无 | ❌ 未接入 | 见 `state/gates.json` 的 `payment-rail` 门禁 |

## 明确看不见的数字（不要假装能看见）

- **Pages 站点的真实浏览量**：GitHub 不为 Pages 提供流量统计。
- **工具实际被使用的次数**：全客户端计算、无后端、无追踪脚本，因此没有服务端日志。
- **独立用户数 / 留存 / 转化漏斗**：同上。

### 为什么不用第三方统计

可选方案（Plausible / Umami / GoatCounter / Cloudflare Web Analytics）都要求注册账号并持有 token。
当前没有这些账号，且站点承诺"不加载第三方追踪脚本"。**这是设计取舍，不是遗漏。**

## 升级路径（需要人做一步）

按性价比排序：

1. **Cloudflare Web Analytics**（免费、无 Cookie）：需要 Cloudflare 账号 + 站点 token。接入后能拿到真实 PV/UV 与来源。约 5 分钟。
2. **自建 GoatCounter / Umami**：需要一台服务器或 Cloudflare Worker + D1。可保留"无第三方"承诺。
3. **给站点加一个匿名事件端点**：Cloudflare Worker（免费额度）记录 `pageview` 与 `audit_run` 两个事件。需要账号。

在 1 或 2 完成之前，**所有"有多少人在用"的结论都必须写成"未知"**，不能拿 star 数或主观感觉代替。

## 采集脚本

```bash
node ops/measure.js            # 拉取 GitHub 真实流量，写入 state/metrics/
```

脚本只用 `gh api`，不写入任何猜测值；拿不到的字段直接写 `null`。
