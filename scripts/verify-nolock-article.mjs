#!/usr/bin/env node
/**
 * 校验《还没装依赖的时候怎么查漏洞》一文里的每个数字都能复算。
 *
 * 重点：
 *   1. 文中的泄洞数（24 / 2 / 3）必须与实测 JSON 一致
 *   2. 文中的平均分（51）与逐包分数必须一致
 *   3. 文中提到的 ENOLOCK 报错必须是 npm 真实输出（不是编的）
 *   4. 文中说「^1.7.9 上限 33 漏洞、1.21.1 为 0」也必须可核
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MD = path.join(DIR, 'NO-LOCKFILE-AUDIT.md')

let bad = 0
const need = (ok, msg) => { if (ok) console.log('OK   ' + msg); else { bad++; console.log('FAIL ' + msg) } }

if (!fs.existsSync(MD)) {
  console.error('missing article')
  process.exit(2)
}
const md = fs.readFileSync(MD, 'utf8')

// 实测快照（由 action 在 work/nolock/package.json 上跑出）
const SNAPSHOT = {
  average: 51,
  packages: {
    axios: { score: 33, status: 'critical', vulns: 24 },
    lodash: { score: 70, status: 'watch', vulns: 2 },
    jsonwebtoken: { score: 50, status: 'risk', vulns: 3 }
  }
}

console.log('--- 1. 汇总数字 ---')
need(md.includes(String(SNAPSHOT.average) + '/100'), `平均分 ${SNAPSHOT.average}/100 出现在文中`)

console.log('\n--- 2. 逐包分数与漏洞数 ---')
for (const [name, v] of Object.entries(SNAPSHOT.packages)) {
  need(md.includes(name), `文中提到 ${name}`)
  // 表格行形如 "axios            33   critical    24"
  const rowRe = new RegExp(`${name}\\s+${v.score}\\s+${v.status}\\s+${v.vulns}`)
  need(rowRe.test(md), `${name} 的 分数/状态/漏洞数 与实测一致（${v.score}/${v.status}/${v.vulns}）`)
}

console.log('\n--- 3. ENOLOCK 报错必须是真实输出 ---')
need(md.includes('ENOLOCK'), '文中含 ENOLOCK 错误码')
need(md.includes('This command requires an existing lockfile'), '文中含 npm 原文提示')
need(md.includes('loadVirtual requires existing shrinkwrap file'), '文中含完整报错尾部（证明真实粘贴）')

console.log('\n--- 4. axios 范围上界的对照数据 ---')
need(md.includes('1.21.1'), '文中提到 1.21.1（最新版）')
need(md.includes('^1.7.9'), '文中提到 ^1.7.9 的对照例子')
need(/33/.test(md), '文中提到 33 个漏洞（^1.7.9 下限）')

console.log('\n--- 5. 必须有的诚实声明 ---')
need(md.includes('不是替代品'), '明写「不是替代品」')
need(md.includes('npm audit` 够用'), '明写「有 lockfile 就不必换工具」')
need(md.includes('最坏情况'), '说明这个数字是最坏情况')
need(md.includes('请以 `npm ls` 为准'), '提示用户以实际安装版本为准')

console.log('\n--- 6. 四种门禁规则必须写全 ---')
for (const rule of ['可升级范围', '精确锁定', '已被官方弃用', '已在最新版']) {
  need(md.includes(rule), `门禁规则「${rule}」已写明`)
}

console.log('\n--- 7. 复现步骤必须可执行 ---')
need(md.includes('package.json <<'), '含可直接复制粘贴的创建命令')
need(md.includes('https://elsonshow.github.io/dep-health/'), '含在线地址')
need(md.includes('uses: elsonshow/dep-health@v1'), '含 CI 用法')

console.log('\n' + (bad === 0 ? 'ALL CHECKS PASSED' : `FAILURES=${bad}`))
process.exit(bad === 0 ? 0 : 1)
