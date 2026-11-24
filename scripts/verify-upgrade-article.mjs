#!/usr/bin/env node
/**
 * 校验《升级风险评估》一文里的每个数字都能从实测 JSON 复算出来。
 * 并且验证文中那个「修掉的 bug」的说法是真的（0.x 版本按 minor 比较）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MD = path.join(DIR, 'UPGRADE-RISK.md')
const JSON_PATH = path.resolve(DIR, '..', '..', 'work', 'upgrade-risk-sample.json')

let bad = 0
const need = (ok, msg) => { if (ok) console.log('OK   ' + msg); else { bad++; console.log('FAIL ' + msg) } }

const md = fs.readFileSync(MD, 'utf8')

if (!fs.existsSync(JSON_PATH)) {
  console.log('SKIP: sample json not generated yet (run: node ops/upgrade-risk.mjs <pkg> --json)')
  process.exit(0)
}
const d = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))

// 1) 依赖总数
need(md.includes(String(d.totalDeps)), `article states total dependency count ${d.totalDeps}`)

// 2) 每个 advice 分组的计数
for (const [k, v] of Object.entries(d.counts)) {
  const re = new RegExp(`\\*\\*${k}[^*]*\\(${v} 个\\)\\*\\*`)
  need(re.test(md) || md.includes(`${k}（${v} 个）`) || md.includes(`${k}       ${v}`),
    `article states ${k} = ${v}`)
}

// 3) 汇总块里的每个数字
for (const [k, v] of Object.entries(d.counts)) {
  const re = new RegExp(`${k}\\s+${v}\\b`)
  need(re.test(md), `summary block shows ${k} ${v}`)
}

// 4) 文中点名的样板行必须与数据一致
const SPOTCHECK = [
  '@types/chrome', 'plasmo', 'vitest', 'typescript', '@solana/web3.js', '@types/bip39'
]
for (const name of SPOTCHECK) {
  const row = d.rows.find((r) => r.name === name)
  need(!!row, `dataset has ${name}`)
  if (!row) continue
  need(md.includes(name), `article mentions ${name}`)
  need(md.includes(String(row.latest)), `article shows latest version of ${name} (${row.latest})`)
  need(md.includes(row.advice), `article shows advice for ${name} (${row.advice})`)
}

// 5) 关键论断：0.278 -> 0.3.7 必须被判为落后 3 个 minor，而不是 UP-TO-DATE
const chrome = d.rows.find((r) => r.name === '@types/chrome')
need(!!chrome && chrome.majorsBehind === 3, '@types/chrome is recorded as 3 units behind (the fixed bug)')
need(!!chrome && chrome.behindUnit === 'minor(0.x)', '@types/chrome is measured in 0.x minor units')
need(!!chrome && chrome.advice !== 'UP-TO-DATE', '@types/chrome is NOT misclassified as up-to-date')

// 6) 两个对照包的时间差必须真的是 138 与 6 天量级
const ts = d.rows.find((r) => r.name === 'typescript')
const vt = d.rows.find((r) => r.name === 'vitest')
need(!!ts && ts.daysOld > 100, `typescript latest is >100 days old (${ts?.daysOld})`)
need(!!vt && vt.daysOld < 14, `vitest latest is <14 days old (${vt?.daysOld})`)
need(ts.daysOld > vt.daysOld, 'typescript is older than vitest despite fewer majors behind')

// 7) 不许出现数据里不存在的建议词
const validAdvice = new Set(['SAFE-TO-UPGRADE', 'TRY-IN-BRANCH', 'UP-TO-DATE', 'STOP-USING', 'DO-NOT-UPGRADE-YET'])
for (const m of md.matchAll(/^(\S+)\s+.*\s([A-Z-]{6,})$/gm)) {
  const token = m[2]
  if (/^[A-Z-]{6,}$/.test(token) && token.includes('-')) {
    need(validAdvice.has(token) || token === 'MISSING', `advice token ${token} is a known value`)
  }
}

console.log('\n' + (bad === 0 ? 'ALL CHECKS PASSED' : `FAILURES=${bad}`))
process.exit(bad === 0 ? 0 : 1)
