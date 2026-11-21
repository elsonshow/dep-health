#!/usr/bin/env node
/**
 * DepHealth GitHub Action
 *
 * 在 CI 里跑依赖体检：读取 package.json → 用公开接口取真实数据 → 打分 →
 * 写 Job Summary（PR 页面直接可见）→ 按 fail-on 决定是否让 job 失败。
 *
 * 设计约束：
 *   - 零依赖（只用 Node 内置 fetch），不需要 npm install
 *   - 不需要任何 token、不需要账号（只调用公开只读 API）
 *   - 采集与评分逻辑复用站点同一份代码，避免两边结论不一致
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Eng = require('../assets/engine.js');
const Collect = require('../assets/collect.js');

const CONCURRENCY = 5;

function input(name, fallback) {
  const v = process.env['INPUT_' + name.replace(/-/g, '_').toUpperCase()];
  return v === undefined || v === '' ? fallback : String(v);
}

function bool(v, fallback) {
  if (v === undefined) return fallback;
  return /^(true|1|yes|on)$/i.test(String(v).trim());
}

function writeOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  const s = String(value);
  if (!file) return;
  if (s.includes('\n')) {
    const delim = 'EOF_' + Math.random().toString(36).slice(2);
    fs.appendFileSync(file, `${key}<<${delim}\n${s}\n${delim}\n`);
  } else {
    fs.appendFileSync(file, `${key}=${s}\n`);
  }
}

function appendSummary(md) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) fs.appendFileSync(file, md + '\n');
  else process.stdout.write(md + '\n');
}

async function main() {
  const manifestPath = path.resolve(process.cwd(), input('path', 'package.json'));
  const failOn = String(input('fail-on', 'none')).toLowerCase();
  const maxDeps = Number(input('max-deps', '25')) || 0;
  const includeDev = bool(input('include-dev', 'true'), true);

  if (!['none', 'critical', 'risk'].includes(failOn)) {
    console.error(`::error::fail-on 只能是 none / critical / risk，收到 "${failOn}"`);
    process.exit(1);
  }

  if (!fs.existsSync(manifestPath)) {
    console.error(`::error::找不到 ${manifestPath}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = Eng.parseManifest(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }

  let deps = parsed.deps.filter((d) => includeDev || d.bucket !== 'dev');
  if (!deps.length) {
    appendSummary('# 依赖体检\n\n没有找到 dependencies / devDependencies。');
    console.log('没有可分析的依赖');
    writeOutput('score', '');
    writeOutput('critical', '0');
    writeOutput('report', '{}');
    return;
  }

  const truncated = maxDeps > 0 && deps.length > maxDeps;
  if (truncated) deps = deps.slice(0, maxDeps);

  console.log(`分析 ${deps.length} 个依赖（${manifestPath}）…`);
  const rows = await Collect.pool(deps, CONCURRENCY, Collect.collectDep, (done, total, item) => {
    if (done % 5 === 0 || done === total) console.log(`  ${done}/${total} ${item.name}`);
  });

  const verdicts = rows.map((r) => Eng.assess(r, new Date()));
  const summary = Eng.summarize(verdicts);

  const criticalVerdicts = verdicts.filter((v) =>
    v.findings.some((f) => f.level === 'critical'));
  const hasCritical = criticalVerdicts.length > 0;
  const risky = summary.average !== null && summary.average < 65;

  const failed = failOn === 'critical' ? hasCritical : failOn === 'risk' ? (hasCritical || risky) : false;

  // ---- Job Summary ----
  const lines = [];
  lines.push('## 依赖体检报告' + (parsed.name ? `：${parsed.name}` : ''));
  lines.push('');
  lines.push(`**平均健康分 ${summary.average === null ? '—' : summary.average}/100** · ` +
    `依赖 ${summary.total} 个 · 高危 ${summary.criticalCount} · 关注 ` +
    `${(summary.counts.watch || 0) + (summary.counts.risk || 0)}`);
  lines.push('');

  if (criticalVerdicts.length) {
    lines.push('### 必须先处理');
    lines.push('');
    criticalVerdicts.slice(0, 5).forEach((v) => {
      const worst = v.findings.find((f) => f.level === 'critical');
      lines.push(`- **${v.name}** \`${v.range}\` → ${worst ? worst.text : '高危'}`);
    });
    lines.push('');
  }

  lines.push(Eng.toMarkdown(summary, verdicts, { project: parsed.name })
    .replace(/^## 依赖体检报告[^\n]*\n+/, ''));
  lines.push('');
  if (truncated) lines.push(`> 依赖超过 ${maxDeps} 个，本次只分析了前 ${maxDeps} 个。`);
  lines.push('> 由 [依赖体检 DepHealth](https://elsonshow.github.io/dep-health/) 生成 · 数据来自 npm registry / deps.dev / OSV.dev');
  appendSummary(lines.join('\n'));

  writeOutput('score', summary.average === null ? '' : summary.average);
  writeOutput('critical', summary.criticalCount);
  writeOutput('report', JSON.stringify({
    project: parsed.name,
    summary,
    dependencies: verdicts.map((v) => ({
      name: v.name, range: v.range, status: v.status, score: v.score,
      latest: v.data && v.data.latest,
      vulns: (v.data && v.data.vulns ? v.data.vulns : []).length,
      findings: v.findings.map((f) => ({ level: f.level, text: f.text }))
    }))
  }));

  console.log(`\n平均健康分 ${summary.average}/100，高危 ${summary.criticalCount} 个。`);

  if (failed) {
    console.error(`::error::依赖体检未通过门禁（fail-on=${failOn}）：平均分 ${summary.average}，高危 ${criticalVerdicts.length} 个`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('::error::' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
