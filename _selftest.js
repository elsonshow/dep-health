const E = require('./assets/engine.js');
const cases = [
  ['^4.17.21','4.17.21'],['~1.2.3','1.2.3'],['1.2.3','1.2.3'],['>=1.2.3 <2','1.2.3'],
  ['4.x','4.0.0'],['*',null],['npm:foo@^2','2.0.0'],['1.0.0 || 2.0.0','1.0.0'],['>=18','18.0.0'],
  ['^0.21.1','0.21.1'],['latest',null],['2','2.0.0']
];
let fail = 0;
for (const [r, want] of cases) {
  const got = E.rangeMin(r);
  const g = got === null ? null : (got.nonRegistry ? 'NONREG' : E.fmt(got));
  const ok = g === want;
  if (!ok) fail++;
  console.log((ok?'ok  ':'FAIL') + '  ' + r.padEnd(16) + ' -> ' + g + (ok?'':'   expected '+want));
}
for (const [r, want] of [['git+https://x/y.git','NONREG'],['workspace:*','NONREG'],['file:../a','NONREG']]) {
  const got = E.rangeMin(r); const g = got && got.nonRegistry ? 'NONREG' : String(got);
  console.log((g===want?'ok  ':'FAIL') + '  ' + r.padEnd(16) + ' -> ' + g);
  if (g!==want) fail++;
}
// manifest
const m = E.parseManifest(JSON.stringify({name:'x',version:'1.0.0',dependencies:{a:'^1'},devDependencies:{b:'2'}}));
console.log('parseManifest deps:', JSON.stringify(m.deps));
// assess: deprecated + major lag
const v = E.assess({name:'request',range:'^2.88.2',bucket:'runtime',installed:E.parseVersion('2.88.2'),latest:'2.88.2',latestParsed:E.parseVersion('2.88.2'),deprecated:'request has been deprecated',publishedAt:'2020-01-01T00:00:00Z',weeklyDownloads:5000000,vulns:[{severity:'MODERATE'}],depCount:3,license:'Apache-2.0'}, new Date('2026-11-21'));
console.log('request score=' + v.score + ' status=' + v.status);
console.log(v.findings.map(f=>'  ['+f.level+'] '+f.text).join('\n'));
// assess: healthy
const h = E.assess({name:'zod',range:'^3.22.0',bucket:'runtime',installed:E.parseVersion('3.22.0'),latest:'3.25.76',latestParsed:E.parseVersion('3.25.76'),deprecated:'',publishedAt:'2026-10-01T00:00:00Z',weeklyDownloads:9000000,vulns:[],depCount:0,license:'MIT'}, new Date('2026-11-21'));
console.log('zod score=' + h.score + ' status=' + h.status + ' lag=' + h.lag.level);
const s = E.summarize([v,h]);
console.log('summary', JSON.stringify(s));
console.log(fail===0 ? '\nALL SEMVER CASES PASS' : '\n'+fail+' FAILURES');
