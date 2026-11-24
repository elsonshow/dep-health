#!/usr/bin/env node
/**
 * 回归测试：验证「版本落后」不会阻断 CI，而「真实安全威胁」会。
 *
 * 背景：实际踩到的 bug —— 一个健康分 71/100 的项目被 fail-on=critical 拦住，
 * 因为「落后 N 个大版本」这条维护性 finding 也被标成了 critical 级别。
 * 版本落后不该阻断合并；只有「已弃用」或「CRITICAL/HIGH 漏洞」才该阻断。
 *
 * 用 engine 直接断言，不需要发网络请求。
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Eng = require('../assets/engine.js')

let bad = 0
const need = (ok, msg) => { if (ok) console.log('OK   ' + msg); else { bad++; console.log('FAIL ' + msg) } }

function assess(over) {
  return Eng.assess(Object.assign({
    name: 'pkg', range: '^1.0.0', deprecated: '', vulns: [],
    depCount: 1, bucket: 'runtime', latest: '1.0.1'
  }, over), new Date())
}

// 1) 仅落后大版本 —— 不得被判为安全威胁
const lagging = assess({ name: 'typescript', range: '^4.5.0', latest: '7.0.2' })
need(lagging.securityStatus === 'ok',
  `只落后大版本的包 securityStatus=ok（实际 ${lagging.securityStatus}, score ${lagging.score}）`)

// 2) 已弃用 —— 必须阻断
const deprecated = assess({ deprecated: 'this package is deprecated' })
need(deprecated.securityStatus === 'deprecated', `已弃用 -> deprecated（实际 ${deprecated.securityStatus}）`)

// 3) HIGH 漏洞 —— 必须阻断
const high = assess({ vulns: [{ severity: 'HIGH' }] })
need(high.securityStatus === 'critical', `HIGH 漏洞 -> critical（实际 ${high.securityStatus}）`)

// 4) CRITICAL 漏洞 —— 必须阻断
const crit = assess({ vulns: [{ severity: 'CRITICAL' }] })
need(crit.securityStatus === 'critical', `CRITICAL 漏洞 -> critical（实际 ${crit.securityStatus}）`)

// 5) 只有 MODERATE 漏洞 —— 不该按 critical 阻断（它仍会影响分数）
const moderate = assess({ vulns: [{ severity: 'MODERATE' }] })
need(moderate.securityStatus === 'ok',
  `只有 MODERATE 漏洞 -> ok，不阻断（实际 ${moderate.securityStatus}）`)
need(moderate.score < 100, `MODERATE 漏洞仍然扣分（score ${moderate.score}）`)

// 6) summarize 的 criticalCount 只数安全威胁
const summary = Eng.summarize([lagging, deprecated, high, crit, moderate])
need(summary.total === 5, `total=5（实际 ${summary.total}）`)
need(summary.securityCriticalCount === 3,
  `securityCriticalCount=3（deprecated+high+crit，实际 ${summary.securityCriticalCount}）`)
need(summary.deprecatedCount === 1, `deprecatedCount=1（实际 ${summary.deprecatedCount}）`)
need(summary.vulnCriticalCount === 2, `vulnCriticalCount=2（实际 ${summary.vulnCriticalCount}）`)
need(summary.criticalCount === summary.securityCriticalCount,
  'criticalCount 与 securityCriticalCount 一致（避免两套口径漂移）')

// 7) 旧行为回归：status 仍按分数分档，不受本次改动影响
need(lagging.status === 'healthy' || lagging.status === 'watch',
  `版本落后仍会体现在 status 上（实际 ${lagging.status}）`)

console.log('\n' + (bad === 0 ? 'ALL CHECKS PASSED' : `FAILURES=${bad}`))
process.exit(bad === 0 ? 0 : 1)
