#!/usr/bin/env node
/**
 * 校验渲染出的 HTML 文章：必须是可被搜索引擎当正文收录的完整页面，
 * 而不是把 Markdown 原文塞进 <pre>。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FILES = ['deprecated-warning.html', 'npm-deprecated-2026-11.html']

let bad = 0
const need = (ok, msg) => { if (ok) console.log('OK   ' + msg); else { bad++; console.log('FAIL ' + msg) } }

for (const f of FILES) {
  const p = path.join(DIR, f)
  console.log('\n=== ' + f + ' ===')
  if (!fs.existsSync(p)) { need(false, 'file exists'); continue }
  const h = fs.readFileSync(p, 'utf8')
  need(true, 'file exists (' + Buffer.byteLength(h, 'utf8') + ' bytes)')

  need(/<html lang="zh-CN">/.test(h), 'has zh-CN html lang')
  need(/<title>[^<]{6,}<\/title>/.test(h), 'has a real <title>')
  need(/<meta name="description" content="[^"]{20,}"/.test(h), 'has a meta description')
  need(/<meta name="robots" content="index,follow"/.test(h), 'is explicitly indexable')
  need(/<link rel="canonical" href="https:\/\/elsonshow\.github\.io\/dep-health\//.test(h), 'has an absolute canonical URL')

  const h1 = (h.match(/<h1>/g) || []).length
  const h2 = (h.match(/<h2>/g) || []).length
  const pcount = (h.match(/<p>/g) || []).length
  const li = (h.match(/<li>/g) || []).length
  need(h1 >= 1, 'has an h1 (' + h1 + ')')
  need(h2 >= 3, 'has multiple h2 sections (' + h2 + ')')
  need(pcount >= 8, 'has substantial body paragraphs (' + pcount + ')')
  need(li >= 5, 'has list content (' + li + ')')

  // 关键：不能把整篇 md 原文当纯文本
  const looksLikeRawMd = /^#{1,6}\s+\S/m.test(h) || /\*\*[^*\n]+\*\*/.test(h)
  need(!looksLikeRawMd, 'no unrendered markdown syntax left')
  need(!h.includes('\u0000'), 'no leftover placeholder tokens')

  // 必须是 HTML 内容而不是下载文件
  need(!/text\/markdown/.test(h), 'does not declare itself as markdown')
}

console.log('\n' + (bad === 0 ? 'ALL CHECKS PASSED' : `FAILURES=${bad}`))
process.exit(bad === 0 ? 0 : 1)
