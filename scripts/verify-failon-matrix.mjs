#!/usr/bin/env node
/**
 * fail-on 三档语义的回归测试（受控 fixture，不依赖网络）。
 *
 * 重要：assess() 依赖 `installed` 与 `latestParsed` 两个**已解析**的对象，
 * 不是 `latest` 字符串。第一版测试只传了 latest 字符串，
 * 结果「落后 4 个大版本」算出 100 分，差点被误判成产品缺陷。
 * 真实流程里 collect.js 会提供这两个字段，所以这里是测试写错，不是代码错。
 *
 * 期望语义（action.yml）：
 *   none      —— 从不失败
 *   critical  —— 有「已弃用」或「CRITICAL/HIGH 漏洞」才失败
 *   risk      —— 平均分 < 65 或存在上述安全威胁才失败
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Eng = require('../assets/engine.js')

let bad = 0
const need = (ok, msg) => { if (ok) console.log('OK   ' + msg); else { bad++; console.log('FAIL ' + msg) } }

/** 按真实 collect 输出的形状构造一条依赖 */
function dep(over = {}) {
  const installedStr = over.installedStr ?? '1.0.0'
  const latestStr = over.latestStr ?? installedStr
  const base = {
    name: over.name ?? 'x',
    range: over.range ?? '^1.0.0',
    installed: Eng.parseVersion(installedStr),
    latestParsed: Eng.parseVersion(latestStr),
    latest: latestStr,
    deprecated: over.deprecated ?? '',
    vulns: over.vulns ?? [],
    depCount: 1,
    bucket: 'runtime'
  }
  return Eng.assess(base, new Date())
}

function gate(failOn, verdicts) {
  const summary = Eng.summarize(verdicts)
  const criticalVerdicts = verdicts.filter(
    (v) => v.securityStatus === 'critical' || v.securityStatus === 'deprecated')
  const hasCritical = criticalVerdicts.length > 0
  const risky = summary.average !== null && summary.average < 65
  return failOn === 'critical' ? hasCritical : failOn === 'risk' ? (hasCritical || risky) : false
}

const clean = [dep({ name: 'a', latestStr: '1.0.0' }), dep({ name: 'b', latestStr: '1.0.0' })]
const lagging = [dep({ name: 'c', installedStr: '1.0.0', latestStr: '5.0.0' })]
const vulnCritical = [dep({ name: 'd', vulns: [{ severity: 'CRITICAL' }] })]
const vulnHigh = [dep({ name: 'e', vulns: [{ severity: 'HIGH' }] })]
const moderateOnly = [dep({ name: 'f', vulns: [{ severity: 'MODERATE' }] })]
const deprecated = [dep({ name: 'g', deprecated: 'no longer maintained' })]

console.log('--- 字段契约：lag 必须真的被算出来 ---')
need(lagging[0].lag.level === 'major', `严重落后 -> lag.level=major（实际 ${lagging[0].lag.level}）`)
need(lagging[0].lag.majors === 4, `落后 4 个大版本（实际 ${lagging[0].lag.majors}）`)
need(lagging[0].score < 65, `严重落后 -> 分数 < 65（实际 ${lagging[0].score}）`)
need(clean[0].lag.level === 'none', `最新版 -> lag.level=none（实际 ${clean[0].lag.level}）`)

console.log('\n--- fail-on=none：从不失败 ---')
need(gate('none', clean) === false, 'clean -> 不失败')
need(gate('none', vulnCritical) === false, 'CRITICAL 漏洞 -> 仍不失败（none 档）')
need(gate('none', deprecated) === false, '已弃用 -> 仍不失败（none 档）')

console.log('\n--- fail-on=critical：只由安全威胁触发 ---')
need(gate('critical', clean) === false, '干净项目 -> 通过')
need(gate('critical', lagging) === false, '仅版本落后 -> 通过（EXP-023 修的 bug）')
need(gate('critical', moderateOnly) === false, '仅 MODERATE 漏洞 -> 通过')
need(gate('critical', vulnHigh) === true, 'HIGH 漏洞 -> 失败')
need(gate('critical', vulnCritical) === true, 'CRITICAL 漏洞 -> 失败')
need(gate('critical', deprecated) === true, '已弃用 -> 失败')

console.log('\n--- fail-on=risk：安全威胁 或 平均分 < 65 ---')
need(gate('risk', clean) === false, '干净项目 -> 通过')
need(gate('risk', vulnCritical) === true, 'CRITICAL 漏洞 -> 失败')
need(gate('risk', deprecated) === true, '已弃用 -> 失败')
need(gate('risk', lagging) === true, '严重落后导致低分 -> 失败（risk 档本就该更严）')

console.log('\n--- 两档严格性关系 ---')
need(gate('risk', lagging) && !gate('critical', lagging),
  '落后项目：critical 通过但 risk 失败（risk 更严，符合 action.yml 文档）')

console.log('\n' + (bad === 0 ? 'ALL CHECKS PASSED' : `FAILURES=${bad}`))
process.exit(bad === 0 ? 0 : 1)
