#!/usr/bin/env node
/**
 * IndexNow 主动提交：让 Bing / Yandex 立即知道页面存在，不需要注册任何账号。
 *
 * 背景：本轮实测确认
 *   - Google sitemap ping 已废弃（404）
 *   - Bing sitemap ping 已废弃（410）
 *   - IndexNow 端点存在（400/422 是参数问题，不是服务关闭）
 *
 * IndexNow 协议：
 *   1. 生成一个 key（十六进制字符串）
 *   2. 把 key 内容放到站点根目录的 <key>.txt（内容就是 key 本身）
 *   3. POST 或 GET 提交 URL 列表
 *
 * 这是唯一在「不注册账号」前提下能主动推动收录的合法通道。
 *
 * 用法: node ops/indexnow-submit.mjs [--get-only]
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'

const HOST = 'elsonshow.github.io'
const KEY_FILE = path.join(process.cwd(), 'products', 'dephealth', 'indexnow-key.txt')

function httpsReq(options, body) {
  return new Promise((res) => {
    const req = https.request(options, (x) => {
      let d = ''
      x.on('data', (c) => (d += c))
      x.on('end', () => res({ s: x.statusCode, b: d }))
    })
    req.on('error', (e) => res({ s: 0, b: String(e) }))
    req.setTimeout(25000, () => { req.destroy(); res({ s: 0, b: 'timeout' }) })
    if (body) req.write(body)
    req.end()
  })
}

// 1. key：存在则复用，不存在则生成
let key
if (fs.existsSync(KEY_FILE)) {
  key = fs.readFileSync(KEY_FILE, 'utf8').trim()
  console.log('复用已有 key:', key.slice(0, 12) + '…')
} else {
  key = crypto.randomBytes(16).toString('hex')
  fs.writeFileSync(KEY_FILE, key + '\n', 'utf8')
  console.log('生成新 key:', key.slice(0, 12) + '…')
}
console.log('key 文件路径（需部署到站点根目录 <key>.txt）:')
console.log('  products/dephealth/' + key + '.txt')

// 2. 待提交 URL（从 sitemap 读取，避免漏页）
const sitemapPath = path.join(process.cwd(), 'products', 'dephealth', 'sitemap.xml')
const sm = fs.readFileSync(sitemapPath, 'utf8')
const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
console.log('\n待提交 URL 数:', urls.length)
urls.forEach((u) => console.log('  ' + u))

// 3. 先验证 key 文件是否已部署
const keyUrl = `https://${HOST}/dep-health/${key}.txt`
console.log('\n先验证 key 文件是否已上线: ' + keyUrl)
const keyCheck = await httpsReq({ hostname: HOST, path: `/dep-health/${key}.txt`, method: 'GET', headers: { 'user-agent': 'curl/8' } })
const keyLive = keyCheck.s === 200 && String(keyCheck.b).trim() === key
console.log('  status=' + keyCheck.s + ' 内容匹配=' + (String(keyCheck.b).trim() === key))

if (!keyLive) {
  console.log('\nkey 文件尚未部署，先部署再提交。已生成待推送文件：')
  console.log('  products/dephealth/' + key + '.txt')
  console.log('\n推送命令：')
  console.log(`  node ops/gh-push-file.mjs elsonshow/dep-health main "products/dephealth/${key}.txt=${key}.txt"`)
  process.exit(0)
}

// 4. 提交
const payload = JSON.stringify({
  host: HOST,
  key,
  keyLocation: keyUrl,
  urlList: urls
})

const res = await httpsReq({
  hostname: 'api.indexnow.org',
  path: '/indexnow',
  method: 'POST',
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'user-agent': 'curl/8'
  }
}, payload)

console.log('\n=== 提交结果 ===')
console.log('status:', res.s)
console.log('body:', String(res.b).slice(0, 400))
const OK_CODES = [200, 202]
console.log(res.s === 200 || res.s === 202
  ? '提交被接受（200/202）'
  : '提交未被接受——记录该状态，不要反复重试')
