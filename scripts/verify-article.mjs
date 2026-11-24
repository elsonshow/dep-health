#!/usr/bin/env node
/**
 * 校验文章里的每个名单与关键数字，都能从 data/risk-index.json 复算出来。
 * 目的：不允许出现「写的时候看着像」的数字。
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const d = require('../data/risk-index.json')
const md = fs.readFileSync(new URL('../NPM-DEPRECATED-2026-11.md', import.meta.url), 'utf8')

const dep = d.rows.filter((r) => r.deprecated).map((r) => r.name).sort()
const staleOnly = d.rows.filter((r) => !r.deprecated && r.stale).map((r) => r.name).sort()
const total = d.rows.reduce((s, r) => s + (r.weeklyDownloads || 0), 0)

let bad = 0
const need = (cond, msg) => {
  if (cond) console.log('OK   ' + msg)
  else { bad++; console.log('FAIL ' + msg) }
}

// 1) 名单完整性：每个包名都必须以 `name` 形式出现
for (const [label, names] of [['deprecated', dep], ['stale-only', staleOnly]]) {
  const missing = names.filter((n) => !md.includes('`' + n + '`'))
  need(missing.length === 0, `${label} list: ${names.length} names, missing=[${missing.join(',')}]`)
}

// 2) 计数一致
need(md.includes(String(dep.length)), `deprecated count ${dep.length} appears`)
need(md.includes(String(staleOnly.length)), `stale-only count ${staleOnly.length} appears`)
need(md.includes(String(d.rows.length)), `row count ${d.rows.length} appears`)
need(md.includes(String(d.meta.candidates)), `candidate count ${d.meta.candidates} appears`)

// 3) 总量数字（带千分位）
need(md.includes(total.toLocaleString('en-US')), `total weekly ${total.toLocaleString('en-US')} appears`)

// 4) 前 10 名的下载量逐个核对（表格里用千分位逗号，按逗号形式比对）
const top10 = d.rows.slice().sort((a, b) => b.weeklyDownloads - a.weeklyDownloads).slice(0, 10)
for (const r of top10) {
  const formatted = r.weeklyDownloads.toLocaleString('en-US')
  need(
    md.includes(formatted) || md.includes(String(r.weeklyDownloads)),
    `top10 ${r.name} = ${formatted}`
  )
}

// 5) 数字不能自相矛盾：文章若声称 34 个弃用，json 也必须是 34
need(dep.length === 34, `deprecated is exactly 34 (got ${dep.length})`)
need(staleOnly.length === 14, `stale-only is exactly 14 (got ${staleOnly.length})`)

console.log(bad === 0 ? '\nALL CHECKS PASSED' : `\nFAILURES=${bad}`)
process.exit(bad === 0 ? 0 : 1)
