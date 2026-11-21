#!/usr/bin/env node
/**
 * 生成「npm 弃用包速查表」静态页。
 *
 * 原则：页面上的每一行都来自公开 API 的真实数据，不做人工判断、不编替代方案。
 * 流程：候选池 → 拉真实数据 → 只保留「已被 npm 标记弃用」或「最新版停更 ≥24 个月」的包
 *       → 按周下载量降序生成 HTML。
 *
 * 用法: node scripts/build-risk-index.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT_HTML = path.join(__dirname, '..', 'risk-index.html');
const OUT_JSON = path.join(__dirname, '..', 'data', 'risk-index.json');
const CONCURRENCY = 6;
const STALE_MONTHS = 24;

/** 候选池：跨年代、跨生态位的高知名度包（不预判结论，由数据筛选） */
const CANDIDATES = [
  'request', 'node-sass', 'tslint', 'moment', 'bower', 'gulp-util', 'nomnom',
  'left-pad', 'node-uuid', 'phantomjs-prebuilt', 'jade', 'coffee-script',
  'babel-preset-es2015', '@babel/polyfill', 'vue-resource', 'angular',
  'express-handlebars', 'body-parser', 'querystring', 'url', 'punycode',
  'os-homedir', 'os-tmpdir', 'inflight', 'rimraf', 'glob', 'graceful-fs',
  'har-validator', 'w3c-hr-time', 'domexception', 'abab', 'resolve-url',
  'source-map-resolve', 'source-map-url', 'urix', 'stable', 'worker-rpc',
  'metro-babel-transformer', 'apollo-server-core', 'subscriptions-transport-ws',
  'bluebird', 'q', 'when', 'promise', 'es6-promise', 'babel-core',
  'babel-eslint', 'eslint-loader', 'friendly-errors-webpack-plugin',
  'webpack-dev-middleware', 'uglifyjs-webpack-plugin', 'optimize-css-assets-webpack-plugin',
  'mkdirp-promise', 'ncp', 'cpy-cli', 'node-gyp', 'fibers', 'node-pre-gyp'
];

function monthsBetween(iso, now) {
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  return (now - t) / (1000 * 60 * 60 * 24 * 30.44);
}

function fmtDate(iso) {
  if (!iso) return '—';
  return String(iso).slice(0, 10);
}

function fmtNum(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e8) return (n / 1e8).toFixed(1) + ' 亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万';
  return String(n);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function getJson(url, timeoutMs = 20000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

async function inspect(name) {
  const latest = await getJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`);
  if (!latest || !latest.version) return { name, ok: false };

  const [release, dl] = await Promise.all([
    getJson(`https://api.deps.dev/v3/systems/npm/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(latest.version)}`),
    getJson(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`)
  ]);

  return {
    name,
    ok: true,
    version: latest.version,
    deprecated: (release && release.deprecatedReason) || latest.deprecated || '',
    publishedAt: release && release.publishedAt || null,
    license: (release && release.licenses && release.licenses[0]) ||
      (typeof latest.license === 'string' ? latest.license : '') || '',
    weeklyDownloads: dl && typeof dl.downloads === 'number' ? dl.downloads : null,
    repo: latest.repository && (latest.repository.url || latest.repository) || ''
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

function page(rows, meta) {
  const trs = rows.map((r) => {
    const badges = [];
    if (r.deprecated) badges.push('<span class="badge critical">已弃用</span>');
    if (r.stale) badges.push('<span class="badge watch">停更 ' + r.staleMonths + ' 个月</span>');
    return `<tr>
      <td><span class="name">${esc(r.name)}</span></td>
      <td class="latest">${esc(r.version)}</td>
      <td>${badges.join(' ')}</td>
      <td>${esc(fmtDate(r.publishedAt))}</td>
      <td class="num">${esc(fmtNum(r.weeklyDownloads))}</td>
      <td class="msg">${r.deprecated ? esc(r.deprecated) : '<span class="lvl info">—</span>'}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>npm 弃用包速查表（${meta.month}）：${meta.deprecatedCount} 个已被标记弃用的依赖</title>
<meta name="description" content="从 npm registry 实时筛出的 ${rows.length} 个已弃用或停更超过 24 个月的知名 npm 包，含最后发布时间、周下载量与 npm 官方弃用原因。附带一键检查你自己 package.json 的工具。">
<meta property="og:title" content="npm 弃用包速查表">
<meta property="og:description" content="${meta.deprecatedCount} 个已被 npm 标记弃用的包，和它们真实的停更时长。">
<link rel="canonical" href="https://elsonshow.github.io/dep-health/risk-index.html">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🩺</text></svg>">
<link rel="stylesheet" href="assets/styles.css">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Dataset","name":"npm 弃用包速查表",
"description":"从 npm registry 公开数据筛出的已弃用或长期停更的知名 npm 包。",
"datePublished":"${meta.date}","creator":{"@type":"Organization","name":"DepHealth"}}
</script>
</head>
<body>
<header class="site-header">
  <a class="brand" href="./"><span class="brand-mark" aria-hidden="true">🩺</span><span class="brand-text">依赖体检 <b>DepHealth</b></span></a>
  <nav class="site-nav">
    <a href="./">依赖检查工具</a>
    <a href="#method">数据口径</a>
    <a href="https://github.com/elsonshow/dep-health" rel="noopener">GitHub</a>
  </nav>
</header>
<main>
  <section class="hero">
    <p class="eyebrow">数据页 · ${meta.month} 更新</p>
    <h1>npm 弃用包速查表</h1>
    <p class="lede">
      从 ${meta.candidates} 个高知名度 npm 包里，用公开接口筛出 <b>${rows.length} 个</b>已经
      <b>被 npm 官方标记弃用</b>或<b>最新版停更超过 ${STALE_MONTHS} 个月</b>的包。
      其中 ${meta.deprecatedCount} 个带官方弃用说明 —— 说明里通常会直接写出替代方案。
    </p>
    <p><a class="btn primary" href="./">→ 粘贴你的 package.json，检查有没有踩到这些包</a></p>
  </section>

  <div class="table-wrap">
    <table class="deps-table">
      <thead><tr>
        <th>包名</th><th class="num">最新版</th><th>状态</th><th>最后发布</th><th class="num">周下载</th><th>npm 官方弃用原因</th>
      </tr></thead>
      <tbody>
${trs}
      </tbody>
    </table>
  </div>

  <section class="method" id="method">
    <h2>这些数据是怎么来的</h2>
    <p class="section-lede">
      本页由脚本生成，没有人工挑选结论：<code>scripts/build-risk-index.js</code> 对候选池里的每个包调用
      npm registry 的 <code>/latest</code>、deps.dev 的版本详情、以及 npm downloads 接口，
      然后按固定规则筛选。数据抓取时间：<b>${meta.collectedAt}</b>。
    </p>
    <table class="weights">
      <thead><tr><th>字段</th><th>来源</th></tr></thead>
      <tbody>
        <tr><td>弃用原因</td><td>npm registry 的 <code>deprecated</code> 字段（原样展示，不改写）</td></tr>
        <tr><td>最后发布时间</td><td>api.deps.dev 的版本 <code>publishedAt</code></td></tr>
        <tr><td>周下载量</td><td>api.npmjs.org download counts</td></tr>
      </tbody>
    </table>
    <p class="section-lede small">
      「停更」只说明最新版本发布时间久，不等于不能用；「已弃用」是 npm 维护者的正式标记。
      两者都不构成安全评价 —— 用工具跑一遍你自己的依赖，才知道具体影响。
    </p>
  </section>
</main>
<footer class="site-footer">
  <p>依赖体检 DepHealth · <a href="./">检查我的依赖</a> · <a href="https://github.com/elsonshow/dep-health" rel="noopener">源码</a></p>
  <p class="fineprint">数据来自公开接口，页面不收集个人信息、不加载第三方追踪脚本。</p>
</footer>
</body>
</html>`;
}

(async () => {
  const now = new Date();
  console.log(`候选池 ${CANDIDATES.length} 个，开始拉取真实数据…`);
  const results = await mapLimit(CANDIDATES, CONCURRENCY, inspect);
  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  const usable = results.filter((r) => r.ok).map((r) => {
    const m = monthsBetween(r.publishedAt, now);
    const stale = m !== null && m >= STALE_MONTHS;
    return Object.assign({}, r, {
      stale,
      staleMonths: m === null ? null : Math.round(m),
      deprecated: (r.deprecated || '').trim()
    });
  });

  const hits = usable
    .filter((r) => r.deprecated || r.stale)
    .sort((a, b) => (b.weeklyDownloads || 0) - (a.weeklyDownloads || 0));

  const meta = {
    date: now.toISOString().slice(0, 10),
    month: `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`,
    collectedAt: now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    candidates: CANDIDATES.length,
    deprecatedCount: hits.filter((r) => r.deprecated).length
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_HTML, page(hits, meta), 'utf8');
  fs.writeFileSync(OUT_JSON, JSON.stringify({ meta, failed, rows: hits }, null, 2), 'utf8');

  console.log(`可用 ${usable.length} / ${CANDIDATES.length}${failed.length ? `，失败: ${failed.join(', ')}` : ''}`);
  console.log(`命中 ${hits.length} 个（已弃用 ${meta.deprecatedCount} 个）`);
  console.log(`写入 ${OUT_HTML}`);
  console.log(`写入 ${OUT_JSON}`);
  console.log('\n前 10 个：');
  hits.slice(0, 10).forEach((r) => {
    console.log(`  ${r.name.padEnd(28)} ${String(r.weeklyDownloads ?? '—').padStart(12)}  ${r.deprecated ? 'DEPRECATED' : 'stale ' + r.staleMonths + 'mo'}`);
  });
})();
