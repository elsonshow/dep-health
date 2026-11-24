#!/usr/bin/env node
/**
 * Marketplace 上架前的「最后一道检查」。
 *
 * 目的：让那 2 分钟的动作不会因为一个隐藏的校验失败而白做。
 *
 * GitHub Marketplace 对 Action 的硬性要求（官方文档）：
 *   1. action.yml 的 name 必须唯一（会显示在 Marketplace 上）
 *   2. name 不超过 255 字符
 *   3. description 不超过 125 字符
 *   4. 必须有 branding（icon + color）
 *   5. 仓库为 public
 *   6. 已发布 release（非 draft、非 prerelease）
 *   7. 不能在 name 里使用 GitHub 保留词（如 "GitHub", "Actions", "Marketplace"）
 *
 * 本脚本逐项核对，并把「会阻止上架」的问题与「只是提醒」的问题分开。
 */
import { execFileSync } from 'node:child_process'

function gh(args) {
  try { return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) }
  catch (e) { return e.stdout || '' }
}

const REPO = 'elsonshow/dep-health'
let blockers = 0
let warnings = 0

const blocker = (ok, msg) => {
  if (ok) console.log('OK      ' + msg)
  else { blockers++; console.log('BLOCK   ' + msg) }
}
const warn = (ok, msg) => {
  if (ok) console.log('OK      ' + msg)
  else { warnings++; console.log('WARN    ' + msg) }
}

console.log('=== 1. 仓库可见性 ===')
const meta = JSON.parse(gh(['api', `repos/${REPO}`]))
blocker(meta.private === false, `仓库是 public（当前 private=${meta.private}）`)

console.log('\n=== 2. Release 状态 ===')
const rel = JSON.parse(gh(['api', `repos/${REPO}/releases/tags/v1`]))
blocker(rel.draft === false, `release 非 draft（draft=${rel.draft}）`)
blocker(rel.prerelease === false, `release 非 prerelease（prerelease=${rel.prerelease}）`)

console.log('\n=== 3. action.yml 元数据 ===')
const raw = JSON.parse(gh(['api', `repos/${REPO}/contents/action.yml?ref=v1`]))
const yml = Buffer.from(raw.content, 'base64').toString('utf8')

const nameMatch = yml.match(/^name:\s*['"]?([^'"\n]+)['"]?\s*$/m)
const name = nameMatch ? nameMatch[1].trim() : ''
const descMatch = yml.match(/^description:\s*['"]([\s\S]*?)['"]\s*$/m) || yml.match(/^description:\s*(.+)$/m)
const desc = descMatch ? descMatch[1].trim() : ''

console.log('  name        :', JSON.stringify(name), `(${name.length} 字符)`)
console.log('  description :', JSON.stringify(desc.slice(0, 80) + (desc.length > 80 ? '…' : '')), `(${desc.length} 字符)`)

blocker(name.length > 0 && name.length <= 255, `name 长度合规（${name.length} <= 255）`)
blocker(desc.length > 0 && desc.length <= 125, `description 长度合规（${desc.length} <= 125）`)

// 保留词检查
const RESERVED = /\b(github|actions?|marketplace)\b/i
blocker(!RESERVED.test(name), `name 不含 GitHub 保留词（当前 name 去掉品牌词后检查）`)

// branding
blocker(/branding:\s*\n\s*icon:/m.test(yml), 'action.yml 含 branding.icon')
blocker(/branding:[\s\S]{0,200}color:/m.test(yml), 'action.yml 含 branding.color')
const colorMatch = yml.match(/color:\s*['"]?(\w+)['"]?/m)
const VALID_COLORS = ['white', 'yellow', 'blue', 'green', 'orange', 'red', 'purple', 'gray-dark']
const color = colorMatch ? colorMatch[1] : ''
blocker(VALID_COLORS.includes(color), `branding.color 是合法值（当前 "${color}"，允许：${VALID_COLORS.join('/')}）`)

console.log('\n=== 4. 名字唯一性（Marketplace 内是否已有同名 Action）===')
const search = JSON.parse(gh(['api', `search/repositories?q=${encodeURIComponent('dep-health')}+in:name&per_page=20`]))
const collisions = (search.items || []).filter((i) => i.full_name !== REPO && /dep-?health/i.test(i.name))
console.log(`  发现 ${collisions.length} 个同名/近名仓库：`)
for (const c of collisions) {
  console.log(`    ${c.full_name}  stars=${c.stargazers_count}`)
}
warn(collisions.length === 0, 'Marketplace 展示名无同名冲突（有同名仓库不等于冲突，但会增加混淆）')

console.log('\n=== 5. Action 入口文件存在性 ===')
const runsMain = yml.match(/main:\s*['"]?([^'"\n]+)['"]?/m)
const mainPath = runsMain ? runsMain[1].trim() : ''
console.log('  main:', mainPath)
if (mainPath) {
  try {
    JSON.parse(gh(['api', `repos/${REPO}/contents/${mainPath}?ref=v1`]))
    blocker(true, `入口文件存在于 v1 tag（${mainPath}）`)
  } catch {
    blocker(false, `入口文件在 v1 tag 中找不到（${mainPath}）`)
  }
}

console.log('\n' + '='.repeat(50))
console.log(`BLOCKERS = ${blockers}   WARNINGS = ${warnings}`)
if (blockers === 0) {
  console.log('结论：Marketplace 上架不会因为元数据问题失败。')
  console.log('      那 2 分钟的动作可以放心执行。')
} else {
  console.log('结论：有 ' + blockers + ' 项会阻止上架，必须先修。')
}
process.exit(blockers === 0 ? 0 : 1)
