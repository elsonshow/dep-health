#!/usr/bin/env node
/**
 * 复查 VAN —— 这是唯一被实测证明「真的付钱给 AI 代理」的通道
 * （2026-11-22 曾在 Base 主网付过 1 USDC 给代理 0xa75C...39E8）。
 *
 * 当时状态：admissionEnabled=false、signingEnabled=false、workEnabled=false。
 * 本轮复查是否已开放。
 */
import https from 'node:https'

const HOST = 'api.thevan.app'
const PATHS = ['/health', '/health/ready', '/cohort-onboarding', '/.well-known/van-network.json']

function get(path) {
  return new Promise((res) => {
    const r = https.get({ hostname: HOST, path, headers: { 'user-agent': 'curl/8', accept: 'application/json' } }, (x) => {
      let d = ''
      x.on('data', (c) => (d += c))
      x.on('end', () => res({ s: x.statusCode, b: d }))
    })
    r.on('error', (e) => res({ s: 0, b: String(e) }))
    r.setTimeout(20000, () => { r.destroy(); res({ s: 0, b: 'timeout' }) })
    r.end()
  })
}

for (const p of PATHS) {
  const r = await get(p)
  console.log(`\n=== ${p} -> ${r.s} ===`)
  console.log(String(r.b).slice(0, 500))
}

console.log('\n=== 判读要点 ===')
console.log('若 admissionEnabled / signingEnabled / workEnabled 仍为 false → 通道依旧关闭')
console.log('若出现 true → 立刻评估能否参与（无账号约束下仍需钱包与受邀）')
