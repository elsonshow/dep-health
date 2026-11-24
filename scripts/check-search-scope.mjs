#!/usr/bin/env node
/**
 * 检查 GitHub issue 搜索是否覆盖 body 文本。
 *
 * 为什么重要：如果搜索只覆盖标题，那 EXP-037 里「人类作者 0 条求助」
 * 的结论就是在残缺的数据上得出的——必须确认。
 *
 * 方法：用一条已知「标题无关但 body 含该短语」的 issue 反向验证。
 */
import { execFileSync } from 'node:child_process'

function gh(args) {
  try { return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) }
  catch (e) { return e.stdout || '' }
}

function search(q, per = 5) {
  const raw = gh(['api', `search/issues?q=${encodeURIComponent(q)}&per_page=${per}`])
  try { return JSON.parse(raw) } catch { return null }
}

console.log('=== 测试 1：搜 body 中已知存在的短语 ===')
const PHRASE = 'npm error code ENOLOCK'
const r1 = search(`"${PHRASE}"`)
console.log(`  total=${r1?.total_count}  返回=${r1?.items?.length}`)
if (r1?.items?.length) {
  const first = r1.items[0]
  const inBody = (first.body || '').includes(PHRASE)
  const inTitle = (first.title || '').includes(PHRASE)
  console.log(`  第一条：${first.repository_url.split('/').slice(-2).join('/')}#${first.number}`)
  console.log(`    title: ${first.title}`)
  console.log(`    短语在 body 中: ${inBody}  |  在 title 中: ${inTitle}`)
  if (inBody && !inTitle) {
    console.log('  => 搜索确实覆盖 body（标题完全没有该短语，但能搜到）')
  }
}

console.log('\n=== 测试 2：用一个只可能出现在标题的短语 ===')
// 已知标题
const TITLE_PHRASE = 'Audit sécurité - 2026-11-23'
const r2 = search(`"${TITLE_PHRASE}"`)
console.log(`  total=${r2?.total_count}  返回=${r2?.items?.length}`)

console.log('\n=== 测试 3：中文短语是否可搜 ===')
const r3 = search('"依赖升级"')
console.log(`  "依赖升级" total=${r3?.total_count}  返回=${r3?.items?.length}`)
for (const it of (r3?.items || []).slice(0, 3)) {
  const repo = it.repository_url.split('/').slice(-2).join('/')
  console.log(`    ${repo}#${it.number}  ${(it.title || '').slice(0, 60)}`)
}

console.log('\n=== 结论 ===')
console.log('若测试 1 显示「短语在 body 中=true 且在 title 中=false」，则搜索覆盖 body，')
console.log('EXP-037 的「0 条求助」结论成立；否则需要用别的方式验证需求。')
