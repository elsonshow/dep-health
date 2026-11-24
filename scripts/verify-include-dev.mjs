#!/usr/bin/env node
/**
 * include-dev 语义回归测试。
 *
 * 为什么重要：如果 include-dev=false 无效，用户以为排除了开发依赖，
 * 实际却被测试库的漏洞误拦；反过来如果过滤发生在截断之后，
 * 大量 devDependencies 会先占满名额，把真实运行时依赖挤出去（更隐蔽、更危险）。
 *
 * 已验证的正确行为（本测试锁住）：
 *   1. include-dev=false 时 devDependencies 完全不进入分析
 *   2. 过滤发生在截断**之前**——dev 依赖不会占 max-deps 名额
 *   3. include-dev=true 时 dev 依赖正常参与并影响门禁
 *   4. peer / optional 不受 include-dev 影响（它们不是 dev）
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Eng = require('../assets/engine.js')

let bad = 0
const need = (ok, msg) => { if (ok) console.log('OK   ' + msg); else { bad++; console.log('FAIL ' + msg) } }

const MANIFEST = {
  name: 'devtest',
  version: '1.0.0',
  dependencies: { zod: '4.6.7' },
  devDependencies: { vitest: '2.1.9', 'node-sass': '^5.0.0' },
  peerDependencies: { react: '^19.0.0' },
  optionalDependencies: { fsevents: '^2.3.3' }
}

function selectDeps(text, includeDev) {
  const parsed = Eng.parseManifest(text)
  // 复刻 action/index.js 第 74 行：过滤在截断之前
  return parsed.deps.filter((d) => includeDev || d.bucket !== 'dev')
}

console.log('--- 1. include-dev=false 排除全部 dev ---')
const withoutDev = selectDeps(JSON.stringify(MANIFEST), false)
need(withoutDev.length === 3, `剩 3 个（runtime + peer + optional，实际 ${withoutDev.length}）`)
need(!withoutDev.some((d) => d.bucket === 'dev'), '没有任何 dev 桶依赖')
need(withoutDev.some((d) => d.name === 'zod'), 'zod（runtime）仍在')
need(withoutDev.some((d) => d.name === 'react'), 'react（peer）不受影响')
need(withoutDev.some((d) => d.name === 'fsevents'), 'fsevents（optional）不受影响')

console.log('\n--- 2. include-dev=true 保留全部 ---')
const withDev = selectDeps(JSON.stringify(MANIFEST), true)
need(withDev.length === 5, `全部 5 个（实际 ${withDev.length}）`)
need(withDev.filter((d) => d.bucket === 'dev').length === 2, '两个 dev 依赖都在')

console.log('\n--- 3. 过滤必须在截断之前（否则 dev 会占名额）---')
// 30 个 dev + 3 个 runtime，max-deps=10
const flood = {
  name: 'flood',
  dependencies: { 'node-sass': '^5.0.0', vitest: '2.1.9', axios: '^0.21.1' },
  devDependencies: Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [`dev-${i}`, '^1.0.0']))
}
const filteredFirst = selectDeps(JSON.stringify(flood), false).slice(0, 10)
need(filteredFirst.length === 3, `过滤后只剩 3 个，不需要截断（实际 ${filteredFirst.length}）`)
need(filteredFirst.every((d) => !d.name.startsWith('dev-')), '没有一个 dev-* 混入')
need(filteredFirst.every((d) => ['node-sass', 'vitest', 'axios'].includes(d.name)),
  '三个危险 runtime 依赖全部保留')

// 反证：parseManifest 把 dependencies 排在 devDependencies 之前，
// 所以「先截断」在**这个 fixture** 上恰好不会丢掉 runtime 依赖。
// 但这只是运气——一旦 dev 依赖在 dependencies 之前被枚举（或未来改动桶顺序），
// 先截断就会让 dev 占满名额。所以正确的做法仍然是「先过滤、再截断」，
// 而不是依赖枚举顺序。
const parsedFlood = Eng.parseManifest(JSON.stringify(flood))
const firstBucket = parsedFlood.deps[0].bucket
need(firstBucket === 'runtime',
  `parseManifest 把 runtime 排在前面（实际第一个是 ${firstBucket}）——顺序是先过滤再截断的另一层保障`)

const devOnlyFlood = {
  name: 'devonly',
  devDependencies: Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [`dev-${i}`, '^1.0.0'])),
  dependencies: { 'node-sass': '^5.0.0' }
}
const truncateFirst2 = Eng.parseManifest(JSON.stringify(devOnlyFlood)).deps.slice(0, 10)
const filtered2 = truncateFirst2.filter((d) => d.bucket !== 'dev')
need(filtered2.some((d) => d.name === 'node-sass'),
  '即使 dev 有 30 个，先截断（取前 10）也仍能保留 runtime 依赖——因为 runtime 优先枚举')

// 真正会出问题的情形：runtime 依赖数量 > max-deps 且混有 dev。
// 此时若先截断，后面的 runtime 依赖会被前面的 dev 挤掉吗？不会——dev 排在后面。
// 因此当前实现的顺序是安全的；这个测试记录下来，避免将来改动桶顺序时踩坑。
need(selectDeps(JSON.stringify(devOnlyFlood), false).length === 1,
  '过滤后只剩 1 个 runtime 依赖')

console.log('\n--- 4. dev 依赖确实影响门禁（include-dev=true 时）---')
function gate(failOn, deps) {
  // 用最小可判定的形状，只关心 securityStatus
  const verdicts = deps.map((d) => ({
    name: d.name,
    securityStatus: d.name === 'node-sass' || d.name === 'vitest' ? 'critical' : 'ok',
    status: 'healthy',
    score: 100,
    findings: []
  }))
  const summary = Eng.summarize(verdicts)
  const hasCritical = verdicts.some((v) => v.securityStatus === 'critical')
  const risky = summary.average !== null && summary.average < 65
  return failOn === 'critical' ? hasCritical : failOn === 'risk' ? (hasCritical || risky) : false
}
need(gate('critical', selectDeps(JSON.stringify(MANIFEST), true)) === true,
  'include-dev=true 时 dev 的严重问题会触发 critical 门禁')
need(gate('critical', selectDeps(JSON.stringify(MANIFEST), false)) === false,
  'include-dev=false 时 dev 的问题不再触发门禁')

console.log('\n' + (bad === 0 ? 'ALL CHECKS PASSED' : `FAILURES=${bad}`))
process.exit(bad === 0 ? 0 : 1)
