#!/usr/bin/env node
/**
 * 验证中文市场：中文开发者是否在公开渠道表达「依赖升级」类需求？
 *
 * 背景：英文精确短语的真实命中都是 0（EXP-037/038）。
 * 但产品是中文的，中文市场可能不同——必须单独验证，不能拿英文结论外推。
 */
import { execFileSync } from 'node:child_process'

function gh(args) {
  try { return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) }
  catch (e) { return e.stdout || '' }
}

function search(q, per = 10) {
  const raw = gh(['api', `search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=${per}`])
  try { return JSON.parse(raw) } catch { return null }
}

const PHRASES = ['依赖升级', '依赖体检', '依赖风险', '依赖漏洞扫描']

console.log('=== 挑战信号：中文「求助型」表达 ===')
const HELP = ['依赖升级 怎么办', '依赖太旧 不敢升', '怎么安全升级依赖']

for (const phrase of [...PHRASES, ...HELP]) {
  const r = search(`"${phrase}"`, 10)
  if (!r) { console.log(`[${phrase}] 搜索失败`); continue }

  let realHits = 0
  const items = r.items || []
  for (const it of items) {
    const body = it.body || ''
    const title = it.title || ''
    if (body.includes(phrase) || title.includes(phrase)) realHits++
  }

  console.log(`\n"${phrase}"`)
  console.log(`  total=${r.total_count}  返回=${items.length}  真含短语=${realHits}`)

  for (const it of items.slice(0, 4)) {
    const body = it.body || ''
    const title = it.title || ''
    if (!(body.includes(phrase) || title.includes(phrase))) continue
    const repo = it.repository_url.split('/').slice(-2).join('/')
    const kind = it.pull_request ? 'PR' : 'issue'
    console.log(`    ✓ ${repo}#${it.number} [${kind}] ${(title || '').slice(0, 56)}`)
  }
}

console.log('\n=== 判读 ===')
console.log('若中文「求助型」短语的真实命中也为 0，说明这不是语言问题，是需求本身弱。')
console.log('若中文有明显命中，则说明中文市场值得单独做内容。')
