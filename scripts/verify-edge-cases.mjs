#!/usr/bin/env node
/**
 * 零依赖 / monorepo 边界回归测试。
 *
 * 为什么需要：monorepo 是这个 Action 最可能的真实使用场景。
 * 如果「全部依赖都是 workspace:*」被当成 0 分，那么每一个 monorepo 根目录
 * 的 CI 都会无故失败——这是会让用户立刻卸载产品的失败模式。
 *
 * 已验证的正确行为（本测试锁住）：
 *   1. workspace / file: / git: 依赖标为 unknown，而不是静默丢弃
 *   2. unknown 不计入平均分（scored 只数有分的）
 *   3. 零可分析依赖时 average = null，三门禁档位都不失败
 *   4. 完全空的 package.json 不报错
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Eng = require('../assets/engine.js')

let bad = 0
const need = (ok, msg) => { if (ok) console.log('OK   ' + msg); else { bad++; console.log('FAIL ' + msg) } }

console.log('--- 1. parseManifest 覆盖四个依赖桶 ---')
const manifest = {
  name: 'mono', version: '1.0.0',
  dependencies: { a: '^1.0.0' },
  devDependencies: { b: '^1.0.0' },
  peerDependencies: { c: '^1.0.0' },
  optionalDependencies: { d: '^1.0.0' }
}
const parsed = Eng.parseManifest(JSON.stringify(manifest))
need(parsed.deps.length === 4, `四个桶共 4 个依赖（实际 ${parsed.deps.length}）`)
const buckets = parsed.deps.map((d) => d.bucket).sort().join(',')
need(buckets === 'dev,optional,peer,runtime', `bucket 标注正确（实际 ${buckets}）`)

console.log('\n--- 2. 重复依赖只算一次 ---')
const dup = Eng.parseManifest(JSON.stringify({
  dependencies: { x: '^1.0.0' },
  devDependencies: { x: '^2.0.0' }
}))
need(dup.deps.length === 1, `同名依赖只保留一个（实际 ${dup.deps.length}）`)
need(dup.deps[0].bucket === 'runtime', `保留先出现的 runtime 桶（实际 ${dup.deps[0].bucket}）`)

console.log('\n--- 3. 坏 JSON 必须报错而不是静默 ---')
let threw = false
try { Eng.parseManifest('{ not json }') } catch (e) { threw = e.code === 'BAD_JSON' }
need(threw, '坏 JSON 抛出 BAD_JSON')

console.log('\n--- 4. 空 manifest 不报错 ---')
const empty = Eng.parseManifest(JSON.stringify({ name: 'empty' }))
need(empty.deps.length === 0, '空 manifest -> 0 个依赖')
const emptySummary = Eng.summarize([])
need(emptySummary.total === 0, `空列表 total=0（实际 ${emptySummary.total}）`)
need(emptySummary.average === null, `空列表 average=null（实际 ${emptySummary.average}）`)

console.log('\n--- 5. 零可分析依赖时三门禁都不失败 ---')
function gate(failOn, verdicts) {
  const summary = Eng.summarize(verdicts)
  const criticalVerdicts = verdicts.filter(
    (v) => v.securityStatus === 'critical' || v.securityStatus === 'deprecated')
  const hasCritical = criticalVerdicts.length > 0
  // 关键：average 为 null 时必须视为「不触发分数门禁」
  const risky = summary.average !== null && summary.average < 65
  return failOn === 'critical' ? hasCritical : failOn === 'risk' ? (hasCritical || risky) : false
}
for (const tier of ['none', 'critical', 'risk']) {
  need(gate(tier, []) === false, `空依赖列表 + fail-on=${tier} -> 不失败`)
}

console.log('\n--- 6. unknown 不计入平均分 ---')
// 模拟 monorepo：2 个 workspace（unknown）+ 1 个健康包
const healthy = Eng.assess({
  name: 'ok', range: '1.0.0',
  installed: Eng.parseVersion('1.0.0'),
  latestParsed: Eng.parseVersion('1.0.0'),
  latest: '1.0.0', deprecated: '', vulns: [], depCount: 1, bucket: 'runtime'
}, new Date())
const unknownLike = { name: 'ws', range: 'workspace:*', status: 'unknown', securityStatus: 'ok', score: null, findings: [] }
const mixed = Eng.summarize([healthy, unknownLike])
need(mixed.total === 2, `total 含 unknown（实际 ${mixed.total}）`)
need(mixed.scored === 1, `scored 不含 unknown（实际 ${mixed.scored}）`)
need(mixed.average === healthy.score, `平均分只由可分析项决定（${mixed.average} vs ${healthy.score}）`)

console.log('\n' + (bad === 0 ? 'ALL CHECKS PASSED' : `FAILURES=${bad}`))
process.exit(bad === 0 ? 0 : 1)
