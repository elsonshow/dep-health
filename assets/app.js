/* DepHealth UI + data collection.
 * All network calls go to public, CORS-enabled APIs. No backend, no cookies,
 * no third-party analytics. Nothing you paste leaves the browser. */
(function () {
  'use strict';

  var Eng = window.DepEngine;
  var MAX_DEPS = 25;
  var CONCURRENCY = 4;
  var cache = new Map();

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

  function enc(s) { return encodeURIComponent(s); }

  function jsonFetch(url, opts) {
    return fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function cached(key, producer) {
    if (!cache.has(key)) cache.set(key, producer());
    return cache.get(key);
  }

  function getLatest(name) {
    return cached('latest:' + name, function () {
      return jsonFetch('https://registry.npmjs.org/' + enc(name) + '/latest')
        .catch(function () { return null; });
    });
  }

  function getReleaseInfo(name, version) {
    if (!version) return Promise.resolve(null);
    return cached('v:' + name + '@' + version, function () {
      return jsonFetch('https://api.deps.dev/v3/systems/npm/packages/' + enc(name) + '/versions/' + enc(version))
        .catch(function () { return null; });
    });
  }

  function getDownloads(name) {
    return cached('dl:' + name, function () {
      return jsonFetch('https://api.npmjs.org/downloads/point/last-week/' + enc(name))
        .then(function (d) { return typeof d.downloads === 'number' ? d.downloads : null; })
        .catch(function () { return null; });
    });
  }

  function severityOf(v) {
    var ds = v.database_specific || {};
    if (ds.severity) return String(ds.severity).toUpperCase();
    var sev = v.severity || [];
    for (var i = 0; i < sev.length; i++) {
      var s = parseFloat(sev[i].score);
      if (!isNaN(s)) return s >= 9 ? 'CRITICAL' : s >= 7 ? 'HIGH' : s >= 4 ? 'MODERATE' : 'LOW';
    }
    return 'MODERATE';
  }

  function getVulns(name, version) {
    if (!version) return Promise.resolve([]);
    return cached('osv:' + name + '@' + version, function () {
      return fetch('https://api.osv.dev/v1/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: { name: name, ecosystem: 'npm' }, version: version })
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) {
        return (d.vulns || []).map(function (v) {
          return {
            id: v.id,
            severity: severityOf(v),
            summary: (v.summary || v.details || '').slice(0, 200)
          };
        });
      }).catch(function () { return []; });
    });
  }

  /* ---------------------------------------------------------- collection */

  function collect(dep) {
    var row = { name: dep.name, range: dep.range, bucket: dep.bucket, error: null };
    var floor = Eng.rangeMin(dep.range);

    if (floor && floor.nonRegistry) {
      row.error = '非 registry 依赖（git / file / workspace），本工具不分析';
      return Promise.resolve(row);
    }
    row.installed = floor;

    return getLatest(dep.name).then(function (latest) {
      if (!latest || !latest.version) {
        row.error = 'npm registry 中查无此包';
        return row;
      }
      row.latest = latest.version;
      row.latestParsed = Eng.parseVersion(latest.version);
      row.deprecated = latest.deprecated || '';
      row.license = latest.license ||
        (latest.licenses && latest.licenses[0] && (latest.licenses[0].type || latest.licenses[0])) || '';
      row.depCount = latest.dependencies ? Object.keys(latest.dependencies).length : 0;
      row.repo = latest.repository && (latest.repository.url || latest.repository) || '';

      var auditVersion = row.installed ? Eng.fmt(row.installed) : row.latest;
      row.auditedVersion = auditVersion;

      return Promise.all([
        getReleaseInfo(dep.name, row.latest),
        getDownloads(dep.name),
        getVulns(dep.name, auditVersion)
      ]).then(function (res) {
        var rel = res[0];
        row.publishedAt = rel && rel.publishedAt || null;
        if (!row.deprecated && rel && rel.deprecatedReason) row.deprecated = rel.deprecatedReason;
        row.weeklyDownloads = res[1];
        row.vulns = res[2];
        return row;
      });
    }).catch(function (e) {
      row.error = e.message || String(e);
      return row;
    });
  }

  function pool(items, limit, worker, onProgress) {
    var i = 0, done = 0;
    var out = new Array(items.length);
    return new Promise(function (resolve) {
      var active = 0;

      function next() {
        if (i >= items.length && active === 0) return resolve(out);
        while (active < limit && i < items.length) {
          (function (idx) {
            active++;
            var item = items[idx];
            Promise.resolve(worker(item)).then(function (r) {
              out[idx] = r;
            }).catch(function (e) {
              out[idx] = { name: item.name, range: item.range, bucket: item.bucket, error: e.message };
            }).then(function () {
              active--; done++;
              if (onProgress) onProgress(done, items.length, item);
              next();
            });
          })(i++);
        }
      }
      next();
    });
  }

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
