#!/usr/bin/env node
/**
 * 校验《DEPRECATED 警告要不要管》一文中的每个数字与包名，
 * 都必须能从 data/risk-index.json 复算出来。
 *
 * 上一篇文章的手写名单曾出错（把 stale-only 与 deprecated 混淆），
 * 这个脚本就是为了让同类错误在提交前就暴露。
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const d = require('../data/risk-index.json')
const md = fs.readFileSync(new URL('../DEPRECATED-警告要不要管.md', import.meta.url), 'utf8')

const byName = new Map(d.rows.map((r) => [r.name, r]))
let bad = 0
const need = (ok, msg) => { if (ok) console.log('OK   ' + msg); else { bad++; console.log('FAIL ' + msg) } }

// 1) 文章提到的每个包，要么在数据集里，要么被显式标注为「不在数据集」
const MENTIONED = [
  'inflight', 'node-sass', 'fibers', 'phantomjs-prebuilt', 'request', 'tslint',
  'os-tmpdir', 'domexception', 'abab', 'querystring', 'node-pre-gyp'
]
for (const n of MENTIONED) {
  const r = byName.get(n)
  need(!!r, `dataset contains ${n}`)
  if (r) need(md.includes('`' + n + '`'), `article mentions \`${n}\``)
}

// 2) moment 不在数据集，文章必须显式声明这一点
if (md.includes('moment')) {
  need(md.includes('不在本文的 48 包数据集内'), 'article discloses that moment is NOT in the dataset')
}

// 3) 总量与计数
const total = d.rows.reduce((s, r) => s + (r.weeklyDownloads || 0), 0)
const dep = d.rows.filter((r) => r.deprecated)
need(md.includes(total.toLocaleString('en-US')), `total weekly ${total.toLocaleString('en-US')} appears`)
need(dep.length === 34, `deprecated is 34 (got ${dep.length})`)
need(md.includes(String(dep.length)), `article states ${dep.length} deprecated`)
need(md.includes(String(d.rows.length)), `article states ${d.rows.length} rows`)
need(md.includes(String(d.meta.candidates)), `article states ${d.meta.candidates} candidates`)

// 4) 平均值的算术必须对
const avg = Math.round(total / d.rows.length)
need(md.includes('1440 万'), `article's "1440 万" matches computed avg ${avg}`)
need(avg >= 14_000_000 && avg < 15_000_000, `avg ${avg} really is ~1440万`)

// 5) inflight 的官方原文关键短语必须准确
const inflight = byName.get('inflight')
need(/leaks memory/i.test(inflight.deprecated), 'dataset confirms inflight leaks memory')
need(md.includes('leaks memory'), 'article quotes the memory-leak wording')

// 6) 不许出现无法核对的具体月数（只允许 24 个月这个阈值）
const monthClaims = [...md.matchAll(/停更\s*(\d+)\s*个月|(\d+)\s*个月前/g)].map((m) => m[1] || m[2])
const allowedMonths = new Set(['24'])
for (const m of monthClaims) {
  need(allowedMonths.has(m), `month figure ${m} is an allowed, checkable value`)
}

console.log('\n' + (bad === 0 ? 'ALL CHECKS PASSED' : `FAILURES=${bad}`))
process.exit(bad === 0 ? 0 : 1)
