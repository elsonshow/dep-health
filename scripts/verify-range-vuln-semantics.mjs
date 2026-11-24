#!/usr/bin/env node
/**
 * 「范围下限漏洞」的阻断语义回归测试。
 *
 * 实测缺陷（EXP-030）：一个只含 axios ^1.7.9 / lodash ^4.17.21 / jest ^29.7.0
 * 的普通项目，按 README 推荐的 fail-on: critical 直接失败。
 * 原因是按「范围下限」查漏洞：1.7.9 有 33 个漏洞（13 HIGH），
 * 但 ^1.7.9 实际会装 1.21.1，而 1.21.1 是 0 漏洞 —— 这是误报。
 *
 * 修复后语义（本测试锁住）：
 *   A. 可升级范围（^ / ~ 开头且最新版更高）→ 下限漏洞不阻断
 *   B. 精确锁定（1.7.9）→ 阻断
 *   C. 已弃用 → 无论范围写法都阻断
 *   D. 无论阻断与否，报告文案都必须写明审计基准
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Eng = require('../assets/engine.js')

let bad = 0
const need = (ok, msg) => { if (ok) console.log('OK   ' + msg); else { bad++; console.log('FAIL ' + msg) } }

/** 按 collect 的真实输出形状构造 */
function dep(over = {}) {
  const installedStr = over.installedStr ?? '1.7.9'
  const latestStr = over.latestStr ?? installedStr
  return Eng.assess(Object.assign({
    name: over.name ?? 'x',
    range: over.range ?? '^1.7.9',
    installed: Eng.parseVersion(installedStr),
    latestParsed: Eng.parseVersion(latestStr),
    latest: latestStr,
    deprecated: over.deprecated ?? '',
    vulns: over.vulns ?? [],
    depCount: 1,
    bucket: 'runtime'
  }, {}), new Date())
}

const HIGH = [{ severity: 'HIGH' }, { severity: 'MODERATE' }]

console.log('--- A. 可升级范围：下限有 HIGH 漏洞但能升到新版 -> 不阻断 ---')
const caret = dep({ range: '^1.7.9', installedStr: '1.7.9', latestStr: '1.21.1', vulns: HIGH })
need(caret.securityStatus === 'ok', `securityStatus=ok（实际 ${caret.securityStatus}）`)
need(caret.findings.some((f) => /范围下限/.test(f.text)), '文案写明「范围下限」')
need(caret.findings.some((f) => /实际安装的可能已是 1\.21\.1/.test(f.text)), '文案给出实际可能版本')

const tilde = dep({ range: '~1.7.9', installedStr: '1.7.9', latestStr: '1.21.1', vulns: HIGH })
need(tilde.securityStatus === 'ok', `~ 范围同样不阻断（实际 ${tilde.securityStatus}）`)

console.log('\n--- B. 精确锁定：必须阻断 ---')
const pinned = dep({ range: '1.7.9', installedStr: '1.7.9', latestStr: '1.21.1', vulns: HIGH })
need(pinned.securityStatus === 'critical', `精确版本 -> critical（实际 ${pinned.securityStatus}）`)

console.log('\n--- C. 已弃用：不论范围写法都阻断 ---')
const dep1 = dep({ range: '^1.0.0', installedStr: '1.0.0', latestStr: '3.0.0', deprecated: 'no longer maintained' })
need(dep1.securityStatus === 'deprecated', `^ 范围但已弃用 -> deprecated（实际 ${dep1.securityStatus}）`)
const dep2 = dep({ range: '1.0.0', installedStr: '1.0.0', latestStr: '1.0.0', deprecated: 'gone' })
need(dep2.securityStatus === 'deprecated', `精确版本但已弃用 -> deprecated（实际 ${dep2.securityStatus}）`)

console.log('\n--- D. 已是该范围最高版却仍有漏洞：阻断 ---')
// installed === latest，^ 范围也升不上去（没有更高版本存在）
const atLatest = dep({ range: '^1.7.9', installedStr: '1.21.1', latestStr: '1.21.1', vulns: HIGH })
need(atLatest.securityStatus === 'critical', `已在最新版且有 HIGH 漏洞 -> critical（实际 ${atLatest.securityStatus}）`)

console.log('\n--- E. 无漏洞时任何情况都不阻断 ---')
const clean = dep({ range: '^1.7.9', installedStr: '1.7.9', latestStr: '1.21.1', vulns: [] })
need(clean.securityStatus === 'ok', `无漏洞 -> ok（实际 ${clean.securityStatus}）`)

console.log('\n--- F. MODERATE 级漏洞不单独触发 critical ---')
const mod = dep({ range: '1.0.0', installedStr: '1.0.0', latestStr: '1.0.0', vulns: [{ severity: 'MODERATE' }] })
need(mod.securityStatus === 'ok', `只有 MODERATE -> ok（实际 ${mod.securityStatus}）`)
need(mod.score < 100, `但仍扣分（score ${mod.score}）`)

console.log('\n--- G. 门禁集成：典型小项目应通过 ---')
function gate(failOn, verdicts) {
  const summary = Eng.summarize(verdicts)
  const hasCritical = verdicts.some((v) => v.securityStatus === 'critical' || v.securityStatus === 'deprecated')
  const risky = summary.average !== null && summary.average < 65
  return failOn === 'critical' ? hasCritical : failOn === 'risk' ? (hasCritical || risky) : false
}
const typical = [
  dep({ name: 'axios', range: '^1.7.9', installedStr: '1.7.9', latestStr: '1.21.1', vulns: HIGH }),
  dep({ name: 'lodash', range: '^4.17.21', installedStr: '4.17.21', latestStr: '4.18.1', vulns: HIGH })
]
need(gate('critical', typical) === false, 'axios ^1.7.9 + lodash ^4.17.21 -> fail-on=critical 通过')

console.log('\n' + (bad === 0 ? 'ALL CHECKS PASSED' : `FAILURES=${bad}`))
process.exit(bad === 0 ? 0 : 1)
