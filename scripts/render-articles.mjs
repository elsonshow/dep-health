#!/usr/bin/env node
/**
 * 把 Markdown 文章渲染成可直接阅读的 HTML 页面。
 *
 * 为什么必须做：GitHub Pages 对 .md 返回 `text/markdown`，
 * 浏览器会当纯文本/下载处理，搜索引擎不把它当正文页面收录。
 * 两篇文章这样发布，等于从未真正"可读"。
 *
 * 只支持本文用到的 Markdown 子集：标题、段落、粗体、行内代码、代码块、
 * 有序/无序列表、引用、链接、表格分隔线（跳过）、水平线。
 * 不引入任何依赖，避免为了渲染去装包。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 用脚本自身位置定位仓库根，避免依赖调用时的 cwd
const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inline(s) {
  let out = esc(s)
  // 行内代码优先（避免其中的 * _ 被当作强调）
  const codes = []
  out = out.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c)
    return `\u0000CODE${codes.length - 1}\u0000`
  })
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`)
  return out
}

function render(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out = []
  let i = 0
  let inCode = false
  let codeLang = ''
  let codeBuf = []
  let listType = null

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null }
  }

  while (i < lines.length) {
    const line = lines[i]

    // 代码块
    if (/^```/.test(line)) {
      if (!inCode) {
        closeList()
        inCode = true
        codeLang = line.slice(3).trim()
        codeBuf = []
      } else {
        inCode = false
        out.push(`<pre><code${codeLang ? ` class="lang-${esc(codeLang)}"` : ''}>${esc(codeBuf.join('\n'))}</code></pre>`)
      }
      i++
      continue
    }
    if (inCode) { codeBuf.push(line); i++; continue }

    // 空行
    if (!line.trim()) { closeList(); i++; continue }

    // 水平线
    if (/^---+$/.test(line.trim())) { closeList(); out.push('<hr>'); i++; continue }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      closeList()
      const lvl = h[1].length
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`)
      i++
      continue
    }

    // 引用
    if (/^>\s?/.test(line)) {
      closeList()
      const buf = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`)
      continue
    }

    // 表格（跳过对齐行，把其余行当普通段落处理，保持可读）
    if (/^\|/.test(line)) {
      closeList()
      const buf = []
      while (i < lines.length && /^\|/.test(lines[i])) { buf.push(lines[i]); i++ }
      const rows = buf.filter((r) => !/^\|[\s:|-]+\|$/.test(r))
      let table = '<table>'
      rows.forEach((r, idx) => {
        const cells = r.split('|').slice(1, -1).map((c) => c.trim())
        const tag = idx === 0 ? 'th' : 'td'
        table += '<tr>' + cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join('') + '</tr>'
      })
      table += '</table>'
      out.push(table)
      continue
    }

    // 列表
    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    const ol = line.match(/^\s*\d+\.\s+(.*)$/)
    if (ul || ol) {
      const want = ul ? 'ul' : 'ol'
      if (listType !== want) { closeList(); out.push(`<${want}>`); listType = want }
      out.push(`<li>${inline((ul || ol)[1])}</li>`)
      i++
      continue
    }

    // 段落
    closeList()
    out.push(`<p>${inline(line)}</p>`)
    i++
  }
  closeList()
  if (inCode) out.push(`<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`)
  return out.join('\n')
}

const CSS = `
:root{--bg:#f7f2e8;--fg:#2b2824;--mut:#6b6157;--line:#e8ddcd;--acc:#a65b38;--code-bg:#f0e9dc}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.85 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:760px;margin:0 auto;padding:48px 22px 96px}
h1{font-size:30px;line-height:1.35;margin:0 0 20px;letter-spacing:-.01em}
h2{font-size:22px;margin:40px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--line)}
h3{font-size:18px;margin:28px 0 10px}
p{margin:14px 0}
ul,ol{margin:14px 0;padding-left:24px}
li{margin:7px 0}
code{background:var(--code-bg);padding:2px 6px;border-radius:4px;font:14px/1.6 ui-monospace,Consolas,monospace}
pre{background:var(--code-bg);padding:16px;border-radius:8px;overflow-x:auto;border:1px solid var(--line)}
pre code{background:none;padding:0;font-size:13.5px}
blockquote{margin:20px 0;padding:12px 18px;border-left:3px solid var(--acc);background:#fbf7ef;color:var(--mut)}
table{border-collapse:collapse;width:100%;margin:20px 0;font-size:14.5px}
th,td{border:1px solid var(--line);padding:9px 12px;text-align:left;vertical-align:top}
th{background:#f0e9dc;font-weight:600}
a{color:var(--acc)}
hr{border:0;border-top:1px solid var(--line);margin:36px 0}
.top{margin-bottom:28px;font:13px ui-monospace,Consolas,monospace}
.top a{text-decoration:none}
footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);color:var(--mut);font-size:13.5px}
`

function page(title, desc, bodyHtml, canonical) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${canonical}">
<style>${CSS}</style>
</head>
<body>
<main>
<div class="top"><a href="./">← 依赖体检 DepHealth</a></div>
<article>
${bodyHtml}
</article>
<footer>数据与脚本开源：<a href="https://github.com/elsonshow/dep-health">github.com/elsonshow/dep-health</a></footer>
</main>
</body>
</html>
`
}

const ARTICLES = [
  {
    src: 'DEPRECATED-警告要不要管.md',
    out: 'deprecated-warning.html',
    title: '依赖里出现 deprecated 警告，到底要不要管？48 个包的实测答案',
    desc: '看到 npm deprecated 警告要不要处理？按「不用管 / 值得排期 / 必须尽快处理」三档给出具体动作，附 30 秒自查命令。数据来自 npm registry 公开接口，可复现。',
    canonical: 'https://elsonshow.github.io/dep-health/deprecated-warning.html'
  },
  {
    src: 'NPM-DEPRECATED-2026-11.md',
    out: 'npm-deprecated-2026-11.html',
    title: 'npm 依赖现状实测：34 个「已被官方弃用」的包，每周仍被下载 6.92 亿次',
    desc: '2026-11-24 实测 npm registry：48 个高知名度包中 34 个已被官方标记弃用，合计周下载 6.92 亿次。全部数字可复现。',
    canonical: 'https://elsonshow.github.io/dep-health/npm-deprecated-2026-11.html'
  }
]

for (const a of ARTICLES) {
  const srcPath = path.join(SRC_DIR, a.src)
  if (!fs.existsSync(srcPath)) { console.error('missing ' + srcPath); process.exit(1) }
  const md = fs.readFileSync(srcPath, 'utf8')
  const body = render(md)
  const html = page(a.title, a.desc, body, a.canonical)
  fs.writeFileSync(path.join(SRC_DIR, a.out), html, 'utf8')
  console.log(`rendered ${a.src} -> ${a.out} (${Buffer.byteLength(html, 'utf8')} bytes)`)
}
console.log('\ndone')
