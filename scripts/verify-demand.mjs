#!/usr/bin/env node
/**
 * 需求验证工具（可复跑）。
 *
 * 用途：在零访客的情况下，用公开数据回答「我们解决的问题真实发生吗」。
 *
 * 方法论（本轮踩过的坑，必须遵守）：
 *   1. 必须用整体引号短语，多词组合会被当 OR 处理，返回海量假象
 *   2. 必须先跑「不可能存在的短语」对照组，确认搜索真的在做精确匹配
 *   3. 必须逐条核对 body 是否真的含目标短语，不能只看标题
 *   4. 必须区分「机器人自动报错」与「人在求助」——前者不构成需求表达
 *
 * 用法: node ops/verify-demand.mjs [phrase]
 */
import { execFileSync } from 'node:child_process'

function gh(args) {
  try { return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) }
  catch (e) { return e.stdout || '' }
}

function search(q, per = 20) {
  const raw = gh(['api', `search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=${per}`])
  try { return JSON.parse(raw) } catch { return null }
}

const PHRASE = process.argv[2] || 'npm error code ENOLOCK'
const CONTROL = 'zzqq-impossible-phrase-xyzzy-99999'

console.log('=== 步骤 1：对照组校准 ===')
const ctl = search(`"${CONTROL}"`, 3)
if (!ctl) { console.error('搜索不可用'); process.exit(1) }
console.log(`  不可能短语的 total = ${ctl.total_count}`)
if (ctl.total_count !== 0) {
  console.log('  ⚠ 对照组非 0 —— 搜索未做精确匹配，后续数字不可信')
  process.exit(1)
}
console.log('  OK 搜索支持精确匹配')

console.log('\n=== 步骤 2：目标短语搜索 ===')
const res = search(`"${PHRASE}"`, 20)
console.log(`  total_count = ${res.total_count}`)
console.log(`  实际返回 = ${res.items.length} 条`)

console.log('\n=== 步骤 3：逐条核对 body 是否真含短语 ===')
let real = 0
const byRepo = {}
const byAuthor = {}
for (const it of res.items) {
  const body = it.body || ''
  const title = it.title || ''
  const hit = body.includes(PHRASE) || title.includes(PHRASE)
  if (hit) real++
  const repo = it.repository_url.split('/').slice(-2).join('/')
  const author = it.user?.login || '?'
  byRepo[repo] = (byRepo[repo] || 0) + 1
  byAuthor[author] = (byAuthor[author] || 0) + 1
  if (!hit) continue
  console.log(`  ✓ ${repo}#${it.number}  by ${author}  ${it.created_at.slice(0, 10)}`)
}
console.log(`\n  真实命中: ${real} / ${res.items.length}`)

console.log('\n=== 步骤 4：区分「机器人报错」与「人在求助」===')
const bots = Object.entries(byAuthor).filter(([a]) => /\[bot\]|bot$/.test(a))
const humans = Object.entries(byAuthor).filter(([a]) => !/\[bot\]|bot$/.test(a))
console.log('  机器人作者:')
bots.forEach(([a, n]) => console.log(`    ${a}  ${n} 条`))
console.log('  人类作者:')
if (!humans.length) console.log('    （无）—— 说明都是自动化报错，不是需求表达')
humans.forEach(([a, n]) => console.log(`    ${a}  ${n} 条`))

console.log('\n=== 步骤 5：仓库集中度 ===')
Object.entries(byRepo).sort((a, b) => b[1] - a[1]).slice(0, 5)
  .forEach(([r, n]) => console.log(`  ${r}  ${n} 条`))

console.log('\n=== 结论模板 ===')
console.log('  「痛点真实」= 有机器人反复报同一错误（说明问题真会发生）')
console.log('  「需求被唤起」= 有人类在搜索/询问解决方案（说明有人想要工具）')
console.log('  两者是不同的事：本工具解决前者，但收入取决于后者。')
