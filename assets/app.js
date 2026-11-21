/* DepHealth UI + data collection.
 * All network calls go to public, CORS-enabled APIs. No backend, no cookies,
 * no third-party analytics. Nothing you paste leaves the browser. */
(function () {
  'use strict';

  var Eng = window.DepEngine;
  var MAX_DEPS = 25;
  var CONCURRENCY = 4;

  var el = {
    manifest: document.getElementById('manifest'),
    run: document.getElementById('btn-run'),
    sample: document.getElementById('btn-sample'),
    optDev: document.getElementById('opt-dev'),
    progress: document.getElementById('progress'),
    progressBar: document.getElementById('progress-bar'),
    progressText: document.getElementById('progress-text'),
    error: document.getElementById('error'),
    results: document.getElementById('results'),
    summary: document.getElementById('summary'),
    rows: document.getElementById('rows'),
    copyMd: document.getElementById('btn-copy-md'),
    copyJson: document.getElementById('btn-copy-json')
  };

  var state = { verdicts: [], summary: null, meta: null };

    /* ------------------------------------------------------------ network */

  // 采集逻辑只有一份实现，放在 collect.js，浏览器与 GitHub Action 共用。
  var collect = window.DepCollect.collectDep;
  var pool = window.DepCollect.pool;

  /* -------------------------------------------------------------- render */

  var LEVEL_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4, ok: 5 };

  function sortFindings(findings) {
    return findings.slice().sort(function (a, b) {
      return (LEVEL_ORDER[a.level] === undefined ? 9 : LEVEL_ORDER[a.level]) -
             (LEVEL_ORDER[b.level] === undefined ? 9 : LEVEL_ORDER[b.level]);
    });
  }

  function statusKey(v) {
    var s = v.status;
    return s === 'healthy' ? 4 : s === 'watch' ? 3 : s === 'risk' ? 2 : s === 'critical' ? 1 : 5;
  }

  function renderSummary(s) {
    var cards = [
      { k: '依赖总数', v: s.total },
      { k: '平均健康分', v: s.average === null ? '—' : s.average, small: '/100' },
      { k: '高危依赖', v: s.criticalCount, tone: s.criticalCount ? 'critical' : '' },
      { k: '需关注', v: (s.counts.watch || 0) + (s.counts.risk || 0) + (s.counts.critical || 0) }
    ];
    el.summary.innerHTML = cards.map(function (c) {
      return '<div class="card"><span class="k">' + c.k + '</span>' +
        '<span class="v"' + (c.tone ? ' style="color:var(--critical)"' : '') + '>' + c.v +
        (c.small ? '<small>' + c.small + '</small>' : '') + '</span></div>';
    }).join('');
  }

  function renderRows(verdicts) {
    var sorted = verdicts.slice().sort(function (a, b) {
      var sa = statusKey(a), sb = statusKey(b);
      if (sa !== sb) return sa - sb;
      return (a.score === null ? 999 : a.score) - (b.score === null ? 999 : b.score);
    });

    el.rows.innerHTML = sorted.map(function (v) {
      var f = sortFindings(v.findings).slice(0, 3);
      var problems = v.findings.length
        ? '<ul style="margin:0;padding-left:16px">' + f.map(function (x) {
            return '<li class="lvl ' + x.level + '">' + escapeHtml(x.text) + '</li>';
          }).join('') + '</ul>'
        : '<span class="lvl ok">无问题</span>';
      var scoreHtml = v.score === null ? '—' :
        '<span class="score" style="color:' + scoreColor(v.score) + '">' + v.score + '</span>';
      return '<tr>' +
        '<td><span class="name">' + escapeHtml(v.name) + '</span>' +
          (v.bucket !== 'runtime' ? '<br><span class="range" style="text-align:left">' + bucketLabel(v.bucket) + '</span>' : '') +
        '</td>' +
        '<td class="range">' + escapeHtml(v.range) + '</td>' +
        '<td class="latest">' + escapeHtml((v.data && v.data.latest) || '—') + '</td>' +
        '<td class="num">' + scoreHtml + '</td>' +
        '<td><span class="badge ' + v.status + '">' + Eng.labelOf(v.status) + '</span></td>' +
        '<td class="problems">' + problems + '</td>' +
        '</tr>';
    }).join('');
  }

  function scoreColor(n) {
    return n >= 85 ? 'var(--ok)' : n >= 65 ? 'var(--watch)' : n >= 40 ? 'var(--risk)' : 'var(--critical)';
  }

  function bucketLabel(b) {
    return { dev: 'devDependencies', peer: 'peerDependencies', optional: 'optionalDependencies' }[b] || b;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------------------------------------------------------- run */

  function setError(msg) {
    if (!msg) { el.error.hidden = true; el.error.textContent = ''; return; }
    el.error.hidden = false;
    el.error.textContent = msg;
  }

  function setBusy(b) {
    el.run.disabled = b;
    el.sample.disabled = b;
    el.run.textContent = b ? '体检中…' : '开始体检';
  }

  function run() {
    setError('');
    var text = el.manifest.value.trim();
    if (!text) { setError('先把 package.json 粘进来。'); return; }

    var parsed;
    try {
      parsed = Eng.parseManifest(text);
    } catch (e) {
      setError(e.message);
      return;
    }

    var deps = parsed.deps.filter(function (d) {
      if (d.bucket === 'dev' && !el.optDev.checked) return false;
      return true;
    });

    if (!deps.length) {
      setError('没有找到 dependencies / devDependencies，确认一下粘贴的是 package.json。');
      return;
    }
    var truncated = deps.length > MAX_DEPS;
    if (truncated) deps = deps.slice(0, MAX_DEPS);

    setBusy(true);
    el.progress.hidden = false;
    el.results.hidden = true;
    el.progressBar.style.width = '0%';
    el.progressText.textContent = '0 / ' + deps.length;

    pool(deps, CONCURRENCY, collect, function (done, total) {
      var pct = Math.round(done / total * 100);
      el.progressBar.style.width = pct + '%';
      el.progressText.textContent = done + ' / ' + total + ' 个依赖已检查';
    }).then(function (rows) {
      var now = new Date();
      var verdicts = rows.map(function (r) { return Eng.assess(r, now); });
      var summary = Eng.summarize(verdicts);
      state = { verdicts: verdicts, summary: summary, meta: { project: parsed.name, truncated: truncated } };

      renderSummary(summary);
      renderRows(verdicts);
      el.results.hidden = false;
      el.progress.hidden = true;
      setBusy(false);
      if (truncated) {
        setError('依赖超过 ' + MAX_DEPS + ' 个，本次只分析了前 ' + MAX_DEPS + ' 个（优先 runtime 依赖）。');
      }
      el.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (e) {
      setBusy(false);
      el.progress.hidden = true;
      setError('体检失败：' + (e.message || e));
    });
  }

  /* ------------------------------------------------------------ clipboard */

  function copy(text, btn) {
    function ok() {
      var old = btn.textContent;
      btn.textContent = '已复制 ✓';
      setTimeout(function () { btn.textContent = old; }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok).catch(function () { fallback(); });
    } else { fallback(); }

    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { /* noop */ }
      document.body.removeChild(ta);
    }
  }

  /* --------------------------------------------------------------- boot */

  el.run.addEventListener('click', run);
  el.sample.addEventListener('click', function () {
    var s = window.DepSamples[0];
    el.manifest.value = JSON.stringify(s.body, null, 2);
    run();
  });

  el.copyMd.addEventListener('click', function () {
    if (!state.summary) return;
    copy(Eng.toMarkdown(state.summary, state.verdicts, state.meta), el.copyMd);
  });

  el.copyJson.addEventListener('click', function () {
    if (!state.summary) return;
    var payload = {
      generatedAt: new Date().toISOString(),
      project: state.meta && state.meta.project,
      summary: state.summary,
      dependencies: state.verdicts.map(function (v) {
        return {
          name: v.name, range: v.range, bucket: v.bucket, status: v.status, score: v.score,
          latest: v.data && v.data.latest, publishedAt: v.data && v.data.publishedAt,
          weeklyDownloads: v.data && v.data.weeklyDownloads,
          vulns: (v.data && v.data.vulns || []).map(function (x) { return { id: x.id, severity: x.severity }; }),
          findings: v.findings.map(function (x) { return { level: x.level, text: x.text }; })
        };
      })
    };
    copy(JSON.stringify(payload, null, 2), el.copyJson);
  });

  // Ctrl/Cmd+Enter to run
  el.manifest.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run();
  });

  // Shareable demo link: ?autorun=1 runs the built-in sample immediately.
  if (/[?&]autorun=1/.test(location.search) && window.DepSamples && window.DepSamples.length) {
    el.manifest.value = JSON.stringify(window.DepSamples[0].body, null, 2);
    run();
  }
})();
