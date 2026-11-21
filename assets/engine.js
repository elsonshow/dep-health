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
    var status = score >= 85 ? 'healthy' : score >= 65 ? 'watch' : score >= 40 ? 'risk' : 'critical';

    return {
      name: d.name,
      range: d.range,
      bucket: d.bucket,
      status: status,
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
    var critical = verdicts.filter(function (v) {
      return v.findings.some(function (f) { return f.level === 'critical'; });
    }).length;
    return {
      total: verdicts.length,
      scored: known.length,
      average: avg,
      counts: counts,
      criticalCount: critical
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
      lines.push('| ' + v.name + ' | `' + v.range + '` | ' + (v.data && v.data.latest ? v.data.latest : '—') +
        ' | ' + (v.score === null ? '—' : v.score) + ' | ' + labelOf(v.status) + ' |');
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
    WEIGHTS: WEIGHTS
  };
});
