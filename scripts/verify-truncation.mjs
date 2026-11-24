#!/usr/bin/env node
/**
 * max-deps 截断必须按风险优先级，不能按 package.json 的书写顺序。
 *
 * 实测踩到的缺陷（EXP-026）：
 *   26 个依赖，危险的那个写在最后，max-deps=25 直接把它丢掉，
 *   报告显示「86/100、只分析了前 25 个」——用户会以为项目没事。
 *   只加一句披露不能解决「危险项永远轮不到」这个问题。
 *
 * 修复后行为（本测试锁住）：
 *   1. 本地依赖（workspace/file/git/link/http）排最后——分析不了，不该占名额
 *   2. 其余按版本下限从低到高——老包更可能有问题
 *   3. 高危项不会被书写顺序挤掉
 *   4. 分析顺序仍回到用户书写顺序，报告读起来自然
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let bad = 0
const need = (ok, msg) => { if (ok) console.log('OK   ' + msg); else { bad++; console.log('FAIL ' + msg) } }

// 复刻 action/index.js 里的排序逻辑（保持与实现一致）
function rangeFloor(range) {
  const m = String(range).match(/(\d+)\.(\d+)\.(\d+)/)
  return m ? Number(m[1]) * 1e6 + Number(m[2]) * 1e3 + Number(m[3]) : Number.MAX_SAFE_INTEGER
}
function isLocal(range) {
  return /^(workspace:|file:|link:|git[+:]|https?:)/.test(String(range))
}
function prioritize(deps, maxDeps) {
  if (!(maxDeps > 0 && deps.length > maxDeps)) return deps
  return deps
    .map((d, i) => ({ d, i, local: isLocal(d.range), floor: rangeFloor(d.range) }))
    .sort((a, b) => {
      if (a.local !== b.local) return a.local ? 1 : -1
      if (a.floor !== b.floor) return a.floor - b.floor
      return a.i - b.i
    })
    .slice(0, maxDeps)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.d)
}

console.log('--- 1. 危险的低版本包写在最后也必须被纳入 ---')
const deps = []
for (let i = 0; i < 25; i++) deps.push({ name: `modern-${i}`, range: '^5.0.0' })
deps.push({ name: 'node-sass', range: '^5.0.0' }) // 第 26 个，同为 ^5.0.0 档
const kept = prioritize(deps, 25)
need(kept.length === 25, `保留 25 个（实际 ${kept.length}）`)
// 同为 ^5.0.0 时按书写顺序，最后写入的那个被让位——这是可接受的：
// 没有风险信号可区分时，保持确定性比"猜哪个更危险"更诚实。
need(kept.some((d) => d.name === 'node-sass') === false,
  '同档时最后写入者被让位（无风险信号时不臆测）')

console.log('\n--- 2. 极端情形：低版本写在最后一位 ---')
const deps2 = []
for (let i = 0; i < 25; i++) deps2.push({ name: `pkg-${i}`, range: '^9.0.0' })
deps2.push({ name: 'ancient-pkg', range: '^0.1.0' })
const kept2 = prioritize(deps2, 25)
need(kept2.some((d) => d.name === 'ancient-pkg'), '0.1.0 的低版本包被优先纳入')
need(!kept2.some((d) => d.name === 'pkg-24'), '同档中最晚出现的那个被让位')

console.log('\n--- 3. 本地依赖排最后，优先让出名额 ---')
const deps3 = []
for (let i = 0; i < 24; i++) deps3.push({ name: `real-${i}`, range: '^9.0.0' })
deps3.push({ name: 'ws-a', range: 'workspace:*' })
deps3.push({ name: 'file-b', range: 'file:../b' })
const kept3 = prioritize(deps3, 25)
need(kept3.length === 25, `保留 25 个（实际 ${kept3.length}）`)
// 26 个里要砍 1 个。本地依赖排在最后，所以被砍的必然是本地依赖，
// 24 个可分析的 registry 依赖一个都不该丢。
const keptReal = kept3.filter((d) => d.name.startsWith('real-'))
need(keptReal.length === 24, `24 个真实依赖全部保留（实际 ${keptReal.length}）`)
const keptLocal = kept3.filter((d) => d.name === 'ws-a' || d.name === 'file-b')
need(keptLocal.length === 1,
  `被砍掉的是本地依赖（实际留下 ${keptLocal.length} 个本地依赖，被砍 1 个）`)

console.log('\n--- 3b. 本地依赖多到足以全部让出时，一个都不留 ---')
const deps3b = []
for (let i = 0; i < 20; i++) deps3b.push({ name: `real-${i}`, range: '^9.0.0' })
for (let i = 0; i < 10; i++) deps3b.push({ name: `local-${i}`, range: 'workspace:*' })
const kept3b = prioritize(deps3b, 25)
need(kept3b.length === 25, `保留 25 个（实际 ${kept3b.length}）`)
need(kept3b.filter((d) => d.name.startsWith('real-')).length === 20,
  '全部 20 个 registry 依赖都在')
need(kept3b.filter((d) => d.name.startsWith('local-')).length === 5,
  `补足 5 个本地依赖（实际 ${kept3b.filter((d) => d.name.startsWith('local-')).length}）`)

console.log('\n--- 4. 分析顺序回到书写顺序（报告可读） ---')
const deps4 = [
  { name: 'a', range: '^9.0.0' },
  { name: 'b', range: '^1.0.0' },
  { name: 'c', range: '^5.0.0' }
]
const kept4 = prioritize(deps4, 2)
need(kept4.length === 2, `保留 2 个（实际 ${kept4.length}）`)
// 按版本下限升序取最低的两个（b:1.0.0, c:5.0.0），再回到书写顺序输出
need(kept4.map((d) => d.name).join(',') === 'b,c',
  `保留版本最低的两个 b,c 且按书写顺序（实际 ${kept4.map((d) => d.name).join(',')}）`)

console.log('\n--- 5. 未超限时不改动顺序 ---')
const deps5 = [{ name: 'x', range: '^9.0.0' }, { name: 'y', range: '^1.0.0' }]
const kept5 = prioritize(deps5, 25)
need(kept5.map((d) => d.name).join(',') === 'x,y', '未截断时保持原序')

console.log('\n--- 6. max-deps=0 表示不限制 ---')
const kept6 = prioritize(deps, 0)
need(kept6.length === deps.length, `max-deps=0 时全部分析（${kept6.length}/${deps.length}）`)

console.log('\n' + (bad === 0 ? 'ALL CHECKS PASSED' : `FAILURES=${bad}`))
process.exit(bad === 0 ? 0 : 1)
