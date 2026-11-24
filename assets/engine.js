/*!
 * DepHealth engine — pure functions, no network, no DOM.
 * Everything here is deterministic so it can be unit-tested in Node.
 * Every number the UI shows comes from these functions applied to real
 * registry data; nothing is hard-coded per package.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DepEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- semver */

  function parseVersion(v) {
    if (typeof v !== 'string') return null;
    var m = v.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.\-+]+))?/);
    if (!m) return null;
    return {
      major: Number(m[1]),
      minor: m[2] === undefined ? 0 : Number(m[2]),
      patch: m[3] === undefined ? 0 : Number(m[3]),
      pre: m[4] || ''
    };
  }

  function cmp(a, b) {
    if (!a || !b) return 0;
    if (a.major !== b.major) return a.major < b.major ? -1 : 1;
    if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
    if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
    if (a.pre === b.pre) return 0;
    if (!a.pre) return 1;
    if (!b.pre) return -1;
    return a.pre < b.pre ? -1 : 1;
  }

  function fmt(v) {
    if (!v) return '—';
    return v.major + '.' + v.minor + '.' + v.patch;
  }

  /**
   * Lowest version a range can resolve to. Advisory: package managers may
   * install anything inside the range, so the lowest allowed version is the
   * pessimistic case we audit against. Returns null for "*"/unknown and
   * {nonRegistry:true} for git/file/workspace deps.
   */
  function rangeMin(range) {
    if (!range) return null;
    var r = String(range).trim();
    if (!r) return null;
    var alias = r.match(/^npm:([^@]+)@?(.+)?$/);
    if (alias) return rangeMin(alias[2] || '*');
    if (/^(file:|link:|workspace:|git\+|git:|https?:|\.{1,2}[\\/]|github:|bitbucket:)/i.test(r)) {
      return { nonRegistry: true };
    }
    if (r === '*' || r === 'x' || r === 'X' || r === 'latest' || r === 'next') return null;
    var firstAlt = r.split('||')[0].trim();
    var m = firstAlt.match(/(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?/);
    if (!m) return null;
    var minor = (m[2] === undefined || /[xX*]/.test(m[2])) ? 0 : Number(m[2]);
    var patch = (m[3] === undefined || /[xX*]/.test(m[3])) ? 0 : Number(m[3]);
    return { major: Number(m[1]), minor: minor, patch: patch, pre: '' };
  }

  /* ---------------------------------------------------------- package.json */

  /**
   * Parse a package.json text into a flat dependency list.
   * Only the three real dependency buckets; devDeps are included but flagged.
   */
  function parseManifest(text) {
    var json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      var err = new Error('package.json 解析失败：' + e.message);
      err.code = 'BAD_JSON';
      throw err;
    }
    if (!json || typeof json !== 'object') throw new Error('不是合法的 package.json');
    var out = [];
    var buckets = [
      ['dependencies', 'runtime'],
      ['devDependencies', 'dev'],
      ['peerDependencies', 'peer'],
      ['optionalDependencies', 'optional']
    ];
    var seen = Object.create(null);
    buckets.forEach(function (b) {
      var obj = json[b[0]] || {};
      Object.keys(obj).forEach(function (name) {
        if (seen[name]) return;
        seen[name] = true;
        out.push({ name: name, range: String(obj[name]), bucket: b[1] });
      });
    });
    return { name: json.name || '(未命名项目)', version: json.version || '', deps: out };
  }

  /* -------------------------------------------------------------- scoring */

  var WEIGHTS = {
    deprecated: 90,
    majorLag: 22,
    minorLag: 7,
    patchLag: 2,
    stale: 18,
    lowDownloads: 12,
    vulns: 15,
    heavyDeps: 6,
    copyleft: 6
  };

  function monthsBetween(iso, now) {
    if (!iso) return null;
    var t = Date.parse(iso);
    if (isNaN(t)) return null;
    return (now - t) / (1000 * 60 * 60 * 24 * 30.44);
  }

  function severityRank(s) {
    var u = String(s || '').toUpperCase();
    if (u === 'CRITICAL') return 4;
    if (u === 'HIGH') return 3;
    if (u === 'MODERATE' || u === 'MEDIUM') return 2;
    if (u === 'LOW') return 1;
    return 0;
  }

  var COPYLEFT = /(^|[^a-z])(A?GPL|LGPL|MPL|EUPL|CDDL|OSL|CC-BY-SA)/i;

  /* ------------------------------------------------------- shareable link */
  /*
   * A shared report has to survive being pasted into WeChat / Slack / a PR
   * comment, so it carries only the verdict table (no long finding texts) and
   * is packed into the URL fragment. Nothing is uploaded anywhere.
   * Format v1: {v:1,p:project,t:iso,s:{a:avg,t:total,c:critical},d:[[name,range,latest,score,status,tag]]}
   */

  var SHARE_VERSION = 1;

  function compactTag(v) {
    var f = v.findings && v.findings[0];
    if (!f) return '';
    return String(f.text).replace(/\s+/g, ' ').slice(0, 80);
  }

  function encodeShare(summary, verdicts, meta) {
    var payload = {
      v: SHARE_VERSION,
      p: (meta && meta.project) || '',
      t: new Date().toISOString().slice(0, 16),
      s: { a: summary.average, t: summary.total, c: summary.criticalCount },
      d: verdicts.map(function (v) {
        return [
          v.name,
          v.range,
          (v.data && v.data.latest) || '',
          v.score === null ? -1 : v.score,
          v.status,
          compactTag(v)
        ];
      })
    };
    return toBase64Url(JSON.stringify(payload));
  }

  function decodeShare(str) {
    var json;
    try {
      json = fromBase64Url(str);
    } catch (e) {
      return null;
    }
    var p;
    try { p = JSON.parse(json); } catch (e) { return null; }
    if (!p || p.v !== SHARE_VERSION || !Array.isArray(p.d)) return null;

    var verdicts = p.d.map(function (row) {
      return {
        name: row[0],
        range: row[1],
        bucket: 'runtime',
        status: row[4],
        score: row[3] < 0 ? null : row[3],
        findings: row[5] ? [{ level: row[4] === 'critical' ? 'critical' : 'info', text: row[5] }] : [],
        data: { latest: row[2] }
      };
    });
    return {
      meta: { project: p.p, sharedAt: p.t },
      summary: {
        total: p.s.t,
        scored: verdicts.filter(function (v) { return v.score !== null; }).length,
        average: p.s.a,
        criticalCount: p.s.c,
        counts: countByStatus(verdicts)
      },
      verdicts: verdicts
    };
  }

  function countByStatus(verdicts) {
    var c = { critical: 0, risk: 0, watch: 0, healthy: 0, unknown: 0 };
    verdicts.forEach(function (v) { c[v.status] = (c[v.status] || 0) + 1; });
    return c;
  }

  // UTF-8 safe, URL-safe base64. Works in browsers and Node.
  function toBase64Url(s) {
    var bytes = encodeUtf8(s);
    return b64encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(s) {
    var b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return decodeUtf8(b64decode(b64));
  }

  function encodeUtf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    return Uint8Array.from(Buffer.from(str, 'utf8'));
  }

  function decodeUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    return Buffer.from(bytes).toString('utf8');
  }

  function b64encode(bytes) {
    if (typeof btoa === 'function') {
      var bin = '';
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }
    return Buffer.from(bytes).toString('base64');
  }

  function b64decode(b64) {
    if (typeof atob === 'function') {
      var bin = atob(b64);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return Uint8Array.from(Buffer.from(b64, 'base64'));
  }


  /**
   * Build the per-dependency verdict.
   * `d` is the raw collected data; `now` is a Date (injectable for tests).
   */
  function assess(d, now) {
    now = now || new Date();
    var findings = [];
    var score = 100;

    var installed = d.installed;
    var latest = d.latestParsed;

    if (d.error) {
      return {
        name: d.name,
        range: d.range,
        bucket: d.bucket,
        status: 'unknown',
        score: null,
        findings: [{ level: 'info', text: '未能获取数据：' + d.error }],
        data: d
      };
    }

    // 1. deprecation is an immediate, unambiguous problem
    if (d.deprecated) {
      score = Math.min(score, 12);
      findings.push({
        level: 'critical',
        text: 'npm 已标记弃用：' + String(d.deprecated).slice(0, 220)
      });
    }

    // 2. how far behind is the installed floor?
    var lag = { level: 'none', majors: 0 };
    if (installed && latest) {
      var c = cmp(installed, latest);
      if (c < 0) {
        if (installed.major < latest.major) {
          lag.level = 'major';
          lag.majors = latest.major - installed.major;
          score -= Math.min(WEIGHTS.majorLag * Math.min(lag.majors, 3), 60);
          findings.push({
            level: 'high',
            text: '落后 ' + lag.majors + ' 个大版本：区间下限 ' + fmt(installed) + ' → 最新 ' + fmt(latest)
          });
        } else if (installed.minor < latest.minor) {
          lag.level = 'minor';
          score -= WEIGHTS.minorLag;
          findings.push({
            level: 'medium',
            text: '小版本落后：' + fmt(installed) + ' → ' + fmt(latest)
          });
        } else if (installed.patch < latest.patch) {
          lag.level = 'patch';
          score -= WEIGHTS.patchLag;
          findings.push({
            level: 'low',
            text: '补丁版本落后：' + fmt(installed) + ' → ' + fmt(latest)
          });
        }
      } else if (c === 0) {
        findings.push({ level: 'ok', text: '已是最新版本 ' + fmt(latest) });
      } else {
        lag.level = 'ahead';
        findings.push({
          level: 'info',
          text: '区间下限高于当前 latest（可能是预发布或 pin 了内部版本）'
        });
      }
    }

    // 3. staleness of the latest release
    var age = monthsBetween(d.publishedAt, now);
    if (age !== null) {
      if (age >= 24) {
        score -= WEIGHTS.stale;
        findings.push({ level: 'high', text: '最新版本发布于 ' + Math.round(age) + ' 个月前，项目活跃度存疑' });
      } else if (age >= 12) {
        score -= Math.round(WEIGHTS.stale * 0.7);
        findings.push({ level: 'medium', text: '最新版本发布于 ' + Math.round(age) + ' 个月前' });
      } else if (age >= 6) {
        score -= Math.round(WEIGHTS.stale * 0.35);
        findings.push({ level: 'low', text: '最新版本发布于 ' + Math.round(age) + ' 个月前' });
      }
    }

    // 4. adoption signal
    if (typeof d.weeklyDownloads === 'number') {
      if (d.weeklyDownloads < 500) {
        score -= WEIGHTS.lowDownloads;
        findings.push({ level: 'high', text: '周下载量仅 ' + fmtNum(d.weeklyDownloads) + '，被弃坑/无人验证的风险高' });
      } else if (d.weeklyDownloads < 5000) {
        score -= Math.round(WEIGHTS.lowDownloads * 0.6);
        findings.push({ level: 'medium', text: '周下载量 ' + fmtNum(d.weeklyDownloads) + '，社区较小' });
      } else if (d.weeklyDownloads < 50000) {
        score -= Math.round(WEIGHTS.lowDownloads * 0.25);
      }
    }

    // 5. known vulnerabilities for the installed floor
    var vulns = d.vulns || [];
    if (vulns.length) {
      var worst = 0;
      vulns.forEach(function (v) { worst = Math.max(worst, severityRank(v.severity)); });
      var penalty = vulns.reduce(function (acc, v) {
        var r = severityRank(v.severity);
        return acc + (r >= 3 ? 12 : r === 2 ? 5 : 1);
      }, 0);
      score -= Math.min(penalty, 45);
      findings.push({
        level: worst >= 3 ? 'critical' : worst === 2 ? 'high' : 'low',
        text: '当前版本存在 ' + vulns.length + ' 个已知漏洞（最高 ' + (vulns.map(function (v) { return v.severity; }).sort().slice(-1)[0] || 'LOW') + '）'
      });
    }

    // 6. dependency weight
    if (typeof d.depCount === 'number' && d.depCount >= 20) {
      score -= WEIGHTS.heavyDeps;
      findings.push({ level: 'low', text: '最新版本自身依赖 ' + d.depCount + ' 个包，供应链面积较大' });
    }

    // 7. licence hygiene (informational; only penalised when copyleft in a runtime dep)
    if (d.license && COPYLEFT.test(d.license) && d.bucket === 'runtime') {
      score -= WEIGHTS.copyleft;
      findings.push({ level: 'medium', text: '运行时依赖使用 ' + d.license + ' 类许可证，商用分发前需确认合规' });
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    // 状态分两层，不能混为一谈：
    //
    //   securityStatus —— 只由「真实安全威胁」决定：已弃用、或存在 CRITICAL/HIGH 级漏洞。
    //                     这是 fail-on 应当依据的东西，也是唯一会阻断合并的信号。
    //   status         —— 综合健康度（含版本落后等维护性问题），用于展示与排序。
    //
    // 以前只有 status，且它完全由分数决定，于是「落后 3 个大版本」这种维护性问题
    // 会把分数压到 40 以下、被判成 critical，进而让 fail-on=critical 的 CI 失败。
    // 那是误报：版本落后不该阻断合并。
    var hasCriticalVuln = (d.vulns || []).some(function (v) {
      return severityRank(v.severity) >= 3;
    });
    var isDeprecated = !!(d.deprecated && String(d.deprecated).trim());
    var securityCritical = hasCriticalVuln || isDeprecated;

    var status = score >= 85 ? 'healthy' : score >= 65 ? 'watch' : score >= 40 ? 'risk' : 'critical';
    // 安全等级单独表达，避免被维护性扣分掩盖或夸大
    var securityStatus = securityCritical
      ? (hasCriticalVuln ? 'critical' : 'deprecated')
      : 'ok';

    return {
      name: d.name,
      range: d.range,
      bucket: d.bucket,
      status: status,
      securityStatus: securityStatus,
      score: score,
      lag: lag,
      findings: findings,
      data: d
    };
  }

  function fmtNum(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e8) return (n / 1e8).toFixed(1) + ' 亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万';
    return String(n);
  }

  /** Aggregate a set of verdicts into a project-level summary. */
  function summarize(verdicts) {
    var known = verdicts.filter(function (v) { return v.score !== null; });
    var avg = known.length
      ? Math.round(known.reduce(function (a, v) { return a + v.score; }, 0) / known.length)
      : null;
    var counts = { critical: 0, risk: 0, watch: 0, healthy: 0, unknown: 0 };
    verdicts.forEach(function (v) { counts[v.status] = (counts[v.status] || 0) + 1; });

    // securityCritical 只计「真实安全威胁」：已弃用或有 CRITICAL/HIGH 漏洞。
    // 它才是 fail-on 的依据。此前它按 findings 里是否有 critical 来数，
    // 会把「落后大版本」也算进去，导致 fail-on=critical 误杀正常项目。
    var securityCritical = verdicts.filter(function (v) {
      return v.securityStatus === 'critical' || v.securityStatus === 'deprecated';
    }).length;
    var deprecatedCount = verdicts.filter(function (v) { return v.securityStatus === 'deprecated'; }).length;
    var vulnCriticalCount = verdicts.filter(function (v) { return v.securityStatus === 'critical'; }).length;

    return {
      total: verdicts.length,
      scored: known.length,
      average: avg,
      counts: counts,
      criticalCount: securityCritical,
      securityCriticalCount: securityCritical,
      deprecatedCount: deprecatedCount,
      vulnCriticalCount: vulnCriticalCount
    };
  }

  /** Markdown export for pasting into a PR or a team doc. */
  function toMarkdown(summary, verdicts, meta) {
    var lines = [];
    lines.push('## 依赖体检报告' + (meta && meta.project ? '：' + meta.project : ''));
    lines.push('');
    lines.push('- 生成时间：' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
    lines.push('- 依赖数：' + summary.total + '，平均健康分：' + (summary.average === null ? '—' : summary.average + '/100'));
    lines.push('- 高危项：' + summary.criticalCount);
    lines.push('');
    lines.push('| 依赖 | 区间 | 当前最新 | 健康分 | 状态 |');
    lines.push('| --- | --- | --- | --- | --- |');
    verdicts.forEach(function (v) {
      // 「未知」必须带原因：一个查不到的包和「查得到但数据缺失」在表格里长得一样，
      // 用户会以为它没问题。原因来自该 verdict 的 info finding（engine 在无法取数时写入
      // 「未能获取数据：<error>」）。
      var statusText = labelOf(v.status);
      if (v.status === 'unknown') {
        var why = (v.findings || []).filter(function (f) {
          return f.level === 'info' && /未能获取数据/.test(f.text);
        }).map(function (f) { return f.text.replace(/^未能获取数据：?/, ''); })[0];
        if (why) statusText = labelOf(v.status) + '（' + String(why).slice(0, 60) + '）';
      }
      lines.push('| ' + v.name + ' | `' + v.range + '` | ' + (v.data && v.data.latest ? v.data.latest : '—') +
        ' | ' + (v.score === null ? '—' : v.score) + ' | ' + statusText + ' |');
    });
    lines.push('');
    lines.push('> 由 DepHealth 生成（浏览器本地计算，数据来自 npm registry / deps.dev / OSV.dev，未上传任何代码）');
    return lines.join('\n');
  }

  function labelOf(status) {
    return {
      healthy: '健康', watch: '关注', risk: '风险', critical: '高危', unknown: '未知'
    }[status] || status;
  }

  /* ----------------------------------------------------- deliverable report */
  /*
   * 这份 HTML 是「可交付物」：买断版承诺给的东西必须真实存在，而不是同一张表换个名字。
   * 与免费表格的差别只有两点，但都是实的：
   *   1. 给出**处理顺序**（先升哪个、后升哪个），免费表只是逐项结论
   *   2. 每条结论都附**证据行 + 数据来源**，能直接交给 tech lead 签字
   * 不编造「升级到 X 就修好了」这类无法从数据推出的结论。
   */

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function suggestedAction(v) {
    var out = [];
    var d = v.data || {};
    if (d.deprecated) {
      out.push('npm 已标记弃用：优先替换。弃用包的后续 patch 不再保证，继续使用需自行承担维护风险。');
    }
    if (v.lag && v.lag.level === 'major' && d.latest) {
      out.push('跨越大版本：先读 ' + v.name + ' 从 ' + fmt(v.data.installed) + ' 到 ' + d.latest + ' 的 breaking changes，再单独开 PR 升级。');
    }
    if (d.vulns && d.vulns.length) {
      out.push('存在已知漏洞：查对应 advisory 的修复版本，或评估能否先升级到无漏洞的版本。');
    }
    if (d.publishedAt) {
      var age = monthsBetween(d.publishedAt, new Date());
      if (age !== null && age >= 24) out.push('上游已 ' + Math.round(age) + ' 个月未发版：确认是否还有替代方案。');
    }
    if (!out.length) out.push('未发现需要立刻处理的问题，保持当前版本即可。');
    return out;
  }

  function priorityOrder(verdicts) {
    return verdicts.slice().sort(function (a, b) {
      var ca = a.findings.some(function (f) { return f.level === 'critical'; }) ? 0 : 1;
      var cb = b.findings.some(function (f) { return f.level === 'critical'; }) ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.score === null ? 101 : a.score) - (b.score === null ? 101 : b.score);
    });
  }

  function buildReportHtml(summary, verdicts, meta) {
    meta = meta || {};
    var now = new Date();
    var ordered = priorityOrder(verdicts);
    var top = ordered.slice(0, 5);

    var verdictLine = summary.average === null
      ? '无法计算平均分。'
      : summary.average >= 85 ? '整体健康状况良好，没有必须立刻处理的依赖。'
        : summary.average >= 65 ? '整体尚可，但存在需要排期处理的依赖。'
          : summary.average >= 40 ? '存在明显风险，建议在下次发布前排期处理。'
            : '风险较高，建议优先处理下列依赖再继续迭代。';

    var priorityHtml = top.map(function (v, i) {
      var acts = suggestedAction(v);
      var evidence = sortFindingsLocal(v.findings).slice(0, 3);
      return '<div class="p">' +
        '<div class="p-rank">' + (i + 1) + '</div>' +
        '<div class="p-body">' +
        '<h3>' + escHtml(v.name) + ' <span class="badge ' + v.status + '">' + escHtml(labelOf(v.status)) + '</span>' +
        '<span class="score">' + (v.score === null ? '—' : v.score) + '/100</span></h3>' +
        '<div class="meta">区间 <code>' + escHtml(v.range) + '</code>' +
        (v.data && v.data.latest ? ' · 最新 <code>' + escHtml(v.data.latest) + '</code>' : '') +
        (v.data && v.data.weeklyDownloads != null ? ' · 周下载 ' + escHtml(fmtNum(v.data.weeklyDownloads)) : '') +
        '</div>' +
        '<ul class="ev">' + evidence.map(function (f) {
          return '<li class="lvl ' + f.level + '">' + escHtml(f.text) + '</li>';
        }).join('') + '</ul>' +
        '<div class="act"><b>建议动作：</b>' + acts.map(function (a) { return escHtml(a); }).join(' ') + '</div>' +
        '</div></div>';
    }).join('');

    var rowsHtml = ordered.map(function (v) {
      var f = sortFindingsLocal(v.findings);
      return '<tr>' +
        '<td class="n">' + escHtml(v.name) + '</td>' +
        '<td class="c"><code>' + escHtml(v.range) + '</code></td>' +
        '<td class="c"><code>' + escHtml((v.data && v.data.latest) || '—') + '</code></td>' +
        '<td class="c">' + (v.score === null ? '—' : v.score) + '</td>' +
        '<td class="c"><span class="badge ' + v.status + '">' + escHtml(labelOf(v.status)) + '</span></td>' +
        '<td>' + (f.length ? '<ul class="ev">' + f.map(function (x) {
          return '<li class="lvl ' + x.level + '">' + escHtml(x.text) + '</li>';
        }).join('') + '</ul>' : '<span class="lvl ok">无问题</span>') + '</td>' +
        '</tr>';
    }).join('');

    return '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8">' +
      '<title>依赖体检报告 · ' + escHtml(meta.project || '未命名项目') + '</title>' +
      '<style>' +
      'body{font:15px/1.65 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#12161f;max-width:900px;margin:0 auto;padding:48px 28px;background:#fff}' +
      'h1{font-size:28px;margin:0 0 6px;letter-spacing:-.02em}h2{font-size:19px;margin:36px 0 12px;padding-bottom:6px;border-bottom:1px solid #e3e6ec}' +
      '.sub{color:#79818f;font-size:13px;margin-bottom:26px}' +
      '.kpis{display:flex;gap:14px;flex-wrap:wrap;margin:18px 0}' +
      '.kpi{border:1px solid #e3e6ec;border-radius:10px;padding:12px 16px;min-width:120px}' +
      '.kpi b{display:block;font-size:26px;letter-spacing:-.02em}.kpi span{font-size:12px;color:#79818f}' +
      '.p{display:flex;gap:14px;border:1px solid #e3e6ec;border-radius:10px;padding:14px 16px;margin-bottom:10px}' +
      '.p-rank{font:600 20px/1 ui-monospace,monospace;color:#2f6df6;flex:none;width:26px}' +
      '.p-body{flex:1}.p h3{margin:0 0 4px;font-size:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
      '.score{margin-left:auto;font:600 15px ui-monospace,monospace;color:#48505e}' +
      '.meta{font-size:12px;color:#79818f;margin-bottom:6px}' +
      'ul.ev{margin:4px 0;padding-left:18px;font-size:13px}ul.ev li{margin:2px 0}' +
      '.act{font-size:13px;background:#f7f8fa;border-radius:8px;padding:8px 10px;margin-top:6px}' +
      'table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}' +
      'th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#79818f;border-bottom:1px solid #e3e6ec;padding:8px 10px}' +
      'td{border-bottom:1px solid #f0f2f6;padding:10px;vertical-align:top}' +
      'td.n{font-family:ui-monospace,monospace;font-weight:600;white-space:nowrap}td.c{text-align:right;white-space:nowrap}' +
      '.badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600}' +
      '.badge.healthy{background:#e9f7ef;color:#157347}.badge.watch{background:#fdf8e3;color:#8a6b00}' +
      '.badge.risk{background:#fff4e5;color:#c26a00}.badge.critical{background:#fdecef;color:#c0263a}' +
      '.badge.unknown{background:#eef1f6;color:#79818f}' +
      '.lvl.critical,.lvl.high{color:#c0263a}.lvl.medium{color:#c26a00}.lvl.low{color:#48505e}.lvl.ok{color:#157347}.lvl.info{color:#79818f}' +
      '.note{font-size:12px;color:#79818f;border-top:1px solid #e3e6ec;margin-top:36px;padding-top:14px}' +
      '@media print{body{padding:0}.p{break-inside:avoid}}' +
      '</style></head><body>' +
      '<h1>依赖体检报告</h1>' +
      '<div class="sub">项目：<b>' + escHtml(meta.project || '未命名') + '</b> · 生成时间 ' +
      now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC · 引擎 v' + escHtml(meta.engineVersion || '0.1') + '</div>' +
      '<div class="kpis">' +
      '<div class="kpi"><b>' + (summary.average === null ? '—' : summary.average) + '</b><span>平均健康分 /100</span></div>' +
      '<div class="kpi"><b>' + summary.total + '</b><span>依赖总数</span></div>' +
      '<div class="kpi"><b style="color:#c0263a">' + summary.criticalCount + '</b><span>高危依赖</span></div>' +
      '<div class="kpi"><b>' + (summary.counts.watch || 0) + '</b><span>需关注</span></div>' +
      '</div>' +
      '<p>' + escHtml(verdictLine) + '</p>' +
      '<h2>建议处理顺序</h2>' +
      '<p class="sub" style="margin-bottom:12px">按「是否高危 → 健康分从低到高」排序。跨大版本的建议单独开 PR，不要和功能改动混在一起。</p>' +
      (priorityHtml || '<p>没有依赖需要处理。</p>') +
      '<h2>全部依赖明细</h2>' +
      '<table><thead><tr><th>依赖</th><th>区间</th><th>最新</th><th>分数</th><th>状态</th><th>结论与证据</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table>' +
      '<h2>数据来源与口径</h2>' +
      '<p class="sub" style="margin:0">最新版本/弃用标记/许可证：registry.npmjs.org；版本发布时间：api.deps.dev；周下载量：api.npmjs.org；已知漏洞：api.osv.dev（针对「区间下限」版本查询）。' +
      '健康分模型公开：弃用压到 ≤12，跨大版本每级 −22（最多 −60），停更最多 −18，下载量低最多 −12，漏洞最多 −45。</p>' +
      '<div class="note">本报告是启发式建议，不是安全认证。漏洞数据依赖 OSV 的上游报告，可能存在延迟；「区间下限」是你声明的最低可解析版本，包管理器实际安装的可能更高。' +
      '上线前仍应以 <code>npm audit</code> 与人工评审为准。生成工具：依赖体检 DepHealth（https://elsonshow.github.io/dep-health/）。</div>' +
      '</body></html>';
  }

  function sortFindingsLocal(findings) {
    var order = { critical: 0, high: 1, medium: 2, low: 3, info: 4, ok: 5 };
    return (findings || []).slice().sort(function (a, b) {
      return (order[a.level] === undefined ? 9 : order[a.level]) -
             (order[b.level] === undefined ? 9 : order[b.level]);
    });
  }


  return {
    parseVersion: parseVersion,
    cmp: cmp,
    fmt: fmt,
    fmtNum: fmtNum,
    rangeMin: rangeMin,
    parseManifest: parseManifest,
    assess: assess,
    summarize: summarize,
    toMarkdown: toMarkdown,
    labelOf: labelOf,
    encodeShare: encodeShare,
    decodeShare: decodeShare,
    buildReportHtml: buildReportHtml,
    WEIGHTS: WEIGHTS
  };
});
