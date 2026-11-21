/*!
 * DepHealth collector — the network glue, shared by the browser app and the
 * GitHub Action so the two can never drift apart.
 * No DOM, no Node-only APIs: uses plain fetch, works in both runtimes.
 */
(function (root, factory) {
  var isNode = typeof module === 'object' && !!module.exports;
  var engine = isNode ? require('./engine.js') : root.DepEngine;
  var api = factory(engine);
  if (isNode) module.exports = api;
  root.DepCollect = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Eng) {
  'use strict';

  var cache = new Map();

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

  /** Collect raw data for one dependency (name + range). Never rejects. */
  function collectDep(dep) {
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
        row.vulns = res[2] || [];
        return row;
      });
    }).catch(function (e) {
      row.error = (e && e.message) || String(e);
      return row;
    });
  }

  /** Bounded-concurrency map that never rejects. */
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
              out[idx] = { name: item.name, range: item.range, bucket: item.bucket, error: (e && e.message) || String(e) };
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

  return {
    collectDep: collectDep,
    pool: pool,
    _cache: cache
  };
});
