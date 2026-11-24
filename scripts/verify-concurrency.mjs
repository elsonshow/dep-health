#!/usr/bin/env node
/**
 * 并发与规模回归测试。
 *
 * 背景（EXP-029）：每个依赖要打 4 个公共端点（registry / deps.dev / 下载量 / OSV）。
 * 原并发是 5，91 个真实依赖要 29.5s——真实大项目会觉得卡。
 *
 * 实测三个并发档位（91 个真实依赖，全部取数成功）：
 *   并发 5  → 29.5s
 *   并发 12 → 14.1s（逐包结果与 5 完全一致，差异 0）
 *   并发 20 → 8.4s（也一致，但对公共 API 不友好）
 *
 * 选择 12：2.1x 提升，且不过度压公共端点（压太狠被限流，用户反而看到 unknown）。
 *
 * 本测试不跑网络，只锁住「并发值是 12」与「pool 实现确实按并发分片」这两个事实，
 * 防止将来有人把它改回去，或在改 pool 时破坏并发语义。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let bad = 0
const need = (ok, msg) => { if (ok) console.log('OK   ' + msg); else { bad++; console.log('FAIL ' + msg) } }

console.log('--- 1. Action 的并发值 ---')
const actionSrc = fs.readFileSync(path.join(DIR, 'action', 'index.js'), 'utf8')
const m = /const CONCURRENCY = (\d+);/.exec(actionSrc)
need(!!m, '找到 CONCURRENCY 声明')
const conc = m ? Number(m[1]) : 0
need(conc === 12, `并发值为 12（实际 ${conc}）`)
need(conc >= 8, `并发不低于 8，避免大项目过慢（实际 ${conc}）`)
need(conc <= 16, `并发不高于 16，避免压垮公共 API（实际 ${conc}）`)
need(/并发 5 = 29\.5s/.test(actionSrc), '保留实测数据作为注释，便于日后复核')
need(/限流/.test(actionSrc), '注释写明为何不用更高并发')

console.log('\n--- 2. pool 实现确实按并发分片 ---')
const Collect = require('../assets/collect.js')
need(typeof Collect.pool === 'function', 'Collect.pool 是函数')

// 构造 10 个任务，并发 3，记录同时在跑的最大数量
const items = Array.from({ length: 10 }, (_, i) => i)
let inFlight = 0
let maxInFlight = 0
const done = []
await Collect.pool(items, 3, async (n) => {
  inFlight++
  maxInFlight = Math.max(maxInFlight, inFlight)
  await new Promise((r) => setTimeout(r, 10))
  inFlight--
  return n * 2
}, () => {}).then((res) => { done.push(...res) })

need(done.length === 10, `全部 10 个任务完成（实际 ${done.length}）`)
need(maxInFlight <= 3, `同时在跑的不超过 3（实际峰值 ${maxInFlight}）`)
need(maxInFlight >= 2, `确实并行执行（实际峰值 ${maxInFlight}）`)
need(done.every((v) => typeof v === 'number'), '返回值都被收集到')

console.log('\n--- 3. 顺序与结果完整性 ---')
const items2 = [1, 2, 3, 4, 5]
const out2 = await Collect.pool(items2, 2, async (n) => n * 10, () => {})
need(out2.length === 5, `5 个结果（实际 ${out2.length}）`)
need(JSON.stringify(out2) === JSON.stringify([10, 20, 30, 40, 50]),
  `结果与输入顺序一致（实际 ${JSON.stringify(out2)}）`)

console.log('\n' + (bad === 0 ? 'ALL CHECKS PASSED' : `FAILURES=${bad}`))
process.exit(bad === 0 ? 0 : 1)
