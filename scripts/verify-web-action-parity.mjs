#!/usr/bin/env node
/**
 * 网页版与 Action 的「结论等价性」验证。
 *
 * 两者共用 assets/engine.js 与 assets/collect.js，理论上必然一致。
 * 但「共用文件」不等于「调用方式一致」——比如网页可能传的字段形状不同、
 * 或对 status 做了自己的映射。所以要在同一输入下比对最终结论。
 *
 * 做法：用同一个 package.json，分别走
 *   A. action/index.js（真实 Actions 环境变量）
 *   B. 直接调用 Eng.parseManifest + Assess + summarize（网页所用的同一批函数）
 * 比对平均分、各状态计数、逐包 score/status。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOME = path.join(DIR, 'products', 'dephealth')

// 用仓库内的 example，保证他人 clone 后可直接复跑（不依赖本地 work/ 目录）
const FIXTURE = path.join(HOME, 'examples', 'legacy-app', 'package.json')
if (!fs.existsSync(FIXTURE)) {
  console.error('missing fixture: ' + FIXTURE)
  process.exit(2)
}

let bad = 0
const need = (ok, msg) => { if (ok) console.log('OK   ' + msg); else { bad++; console.log('FAIL ' + msg) } }

// ---- A. 走 Action ----
const outFile = path.join(HOME, 'parity-action.txt')
const sumFile = path.join(HOME, 'parity-summary.md')
for (const f of [outFile, sumFile]) { try { fs.unlinkSync(f) } catch {} }

execFileSync(process.execPath, ['action/index.js'], {
  cwd: HOME,
  encoding: 'utf8',
  env: {
    ...process.env,
    GITHUB_STEP_SUMMARY: sumFile,
    GITHUB_OUTPUT: outFile,
    INPUT_PATH: FIXTURE,
    'INPUT_FAIL_ON': 'none',
    'INPUT_MAX_DEPS': '25',
    'INPUT_INCLUDE_DEV': 'true'
  }
})

const actionReport = JSON.parse(
  fs.readFileSync(outFile, 'utf8').split('\n').find((l) => l.startsWith('report=')).slice(7))

// ---- B. 走网页同一批函数 ----
const Eng = require(path.join(HOME, 'assets', 'engine.js'))
const Collect = require(path.join(HOME, 'assets', 'collect.js'))

const parsed = Eng.parseManifest(fs.readFileSync(FIXTURE, 'utf8'))
const deps = parsed.deps.filter((d) => d.bucket !== 'dev' || true)

const rows = await Collect.pool(deps, 12, Collect.collectDep, () => {})
const verdicts = rows.map((r) => Eng.assess(r, new Date()))
const webSummary = Eng.summarize(verdicts)

// ---- 比对 ----
console.log('=== 汇总比对 ===')
console.log('Action :', JSON.stringify(actionReport.summary))
console.log('Web    :', JSON.stringify(webSummary))

need(actionReport.summary.average === webSummary.average,
  `平均分一致（${actionReport.summary.average} vs ${webSummary.average}）`)
need(actionReport.summary.total === webSummary.total,
  `依赖数一致（${actionReport.summary.total} vs ${webSummary.total}）`)
need(actionReport.summary.scored === webSummary.scored,
  `可评分项一致（${actionReport.summary.scored} vs ${webSummary.scored}）`)
need(actionReport.summary.criticalCount === webSummary.criticalCount,
  `安全高危数一致（${actionReport.summary.criticalCount} vs ${webSummary.criticalCount}）`)
for (const k of ['critical', 'risk', 'watch', 'healthy', 'unknown']) {
  need((actionReport.summary.counts[k] || 0) === (webSummary.counts[k] || 0),
    `状态计数 ${k} 一致（${actionReport.summary.counts[k] || 0} vs ${webSummary.counts[k] || 0}）`)
}

console.log('\n=== 逐包比对 ===')
let diffs = 0
for (const av of actionReport.dependencies) {
  const wv = verdicts.find((v) => v.name === av.name)
  if (!wv) { console.log('  MISSING in web: ' + av.name); diffs++; continue }
  if (av.score !== wv.score || av.status !== wv.status) {
    console.log(`  DIFF ${av.name}: action=${av.score}/${av.status} web=${wv.score}/${wv.status}`)
    diffs++
  }
}
need(diffs === 0, `逐包 score/status 完全一致（差异 ${diffs}）`)

console.log('\n' + (bad === 0 ? 'WEB AND ACTION AGREE' : `DIVERGENCES=${bad}`))
process.exit(bad === 0 ? 0 : 1)
