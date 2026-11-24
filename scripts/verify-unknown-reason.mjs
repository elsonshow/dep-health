#!/usr/bin/env node
/**
 * 「未知」项必须带原因，不能只写「未知」。
 *
 * 实测缺陷（EXP-028）：一个不存在的 scope 包在 Job Summary 里只显示
 * 「— | — | 未知」，与「查得到但数据缺失」长得一模一样，
 * 用户会以为它没问题。
 *
 * 修复后行为（本测试锁住）：
 *   1. 状态为 unknown 的项，状态列附带原因（来自 info finding）
 *   2. 没有原因时退回纯「未知」，不编造
 *   3. unknown 不计入平均分与门禁
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Eng = require('../assets/engine.js')

let bad = 0
const need = (ok, msg) => { if (ok) console.log('OK   ' + msg); else { bad++; console.log('FAIL ' + msg) } }

function unknownVerdict(name, reason) {
  const findings = reason ? [{ level: 'info', text: '未能获取数据：' + reason }] : []
  return { name, range: '^1.0.0', status: 'unknown', securityStatus: 'ok', score: null, findings }
}

console.log('--- 1. 有原因时状态列必须带出来 ---')
const md1 = Eng.toMarkdown(
  Eng.summarize([unknownVerdict('@nope/pkg', 'npm registry 中查无此包')]),
  [unknownVerdict('@nope/pkg', 'npm registry 中查无此包')],
  { project: 'scope-test' }
)
need(md1.includes('@nope/pkg'), '表格含该包名')
need(/未知（npm registry 中查无此包）/.test(md1), '状态列显示「未知（原因）」')

console.log('\n--- 2. 没有原因时退回纯「未知」，不编造 ---')
const bare = unknownVerdict('no-reason-pkg', null)
const md2 = Eng.toMarkdown(Eng.summarize([bare]), [bare], { project: 'x' })
need(/\| 未知 \|/.test(md2), '状态列就是「未知」，没有括号内容')
need(!md2.includes('未知（'), '没有凭空编造原因')

console.log('\n--- 3. 原因过长要截断，避免撑坏表格 ---')
const long = unknownVerdict('long-pkg', 'x'.repeat(200))
const md3 = Eng.toMarkdown(Eng.summarize([long]), [long], { project: 'x' })
const m = md3.match(/未知（([^）]*)）/);
need(m && m[1].length <= 60, `原因截断到 60 字符（实际 ${m ? m[1].length : 'n/a'}）`)

console.log('\n--- 4. unknown 不计入平均分 ---')
const healthy = Eng.assess({
  name: 'ok', range: '1.0.0',
  installed: Eng.parseVersion('1.0.0'),
  latestParsed: Eng.parseVersion('1.0.0'),
  latest: '1.0.0', deprecated: '', vulns: [], depCount: 1, bucket: 'runtime'
}, new Date())
const s = Eng.summarize([healthy, unknownVerdict('u', 'boom')])
need(s.total === 2, `total=2（实际 ${s.total}）`)
need(s.scored === 1, `scored=1（实际 ${s.scored}）`)
need(s.average === healthy.score, `average 只由可分析项决定（${s.average}）`)

console.log('\n--- 5. unknown 不触发任何门禁 ---')
function gate(failOn, verdicts) {
  const summary = Eng.summarize(verdicts)
  const hasCritical = verdicts.some((v) => v.securityStatus === 'critical' || v.securityStatus === 'deprecated')
  const risky = summary.average !== null && summary.average < 65
  return failOn === 'critical' ? hasCritical : failOn === 'risk' ? (hasCritical || risky) : false
}
for (const tier of ['none', 'critical', 'risk']) {
  need(gate(tier, [unknownVerdict('u', 'boom')]) === false, `只有 unknown 项时 fail-on=${tier} 不失败`)
}

console.log('\n' + (bad === 0 ? 'ALL CHECKS PASSED' : `FAILURES=${bad}`))
process.exit(bad === 0 ? 0 : 1)
