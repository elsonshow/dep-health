// 站点访客计数（免注册）。
//
// 【设计原则】页面写入与脚本读取必须用同一套系统，否则读数永远对不上。
// 上一版犯了错：页面写 hits.sh、脚本读 abacus —— 两套系统，数据对不上。
//
// 【为什么选 abacus 作为计数系统】
//   - 有 /get 只读接口：脚本读数不会污染计数（hits.sh 每读一次就 +1，无法只读）
//   - /hit 由浏览器触发，ua 不参与
//   - 已知缺陷：成功率约 20%，所以脚本侧做了重试 + 缓存回退
//
// 【hits.sh 的角色】
//   仅作为页面上给人看的可见徽章，不参与任何测量。
//
// 【两个计数器】
//   page-loads-total —— 每次页面加载都 +1
//   page-loads-human —— 仅在通过基础人类特征检查时 +1
//
// 【局限】
//   人类特征是可伪造的启发式，human 只是上限：真实人类数 <= human。
//
// 【隐私】不上报 IP / UA / referrer，不设 cookie。
(function () {
  "use strict";

  var ABACUS = "https://abacus.jasoncameron.dev";
  var NS = "elsonshow-dephealth";
  // 仅用于页面可见徽章，不参与测量
  var BADGE = "https://hits.sh/github.com/elsonshow/dep-health-elsonshow.svg";

  function withTimeout(p, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, ms);
      p.then(
        function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
        function () { if (!done) { done = true; clearTimeout(t); resolve(null); } }
      );
    });
  }

  function bump(counter) {
    if (typeof fetch !== "function") return Promise.resolve(null);
    return withTimeout(
      fetch(ABACUS + "/hit/" + NS + "/" + counter, {
        mode: "cors", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer"
      }).then(function (r) { return r.ok ? r.json() : null; }),
      4000
    );
  }

  /** 基础人类特征检查。true 仅表示「看起来像人」，不保证。 */
  function looksHuman() {
    try {
      if (navigator.webdriver === true) return false;
      if (document.visibilityState && document.visibilityState !== "visible") return false;
      var w = window.innerWidth || 0;
      var h = window.innerHeight || 0;
      if (w < 200 || h < 200) return false;
      if (!navigator.languages || navigator.languages.length === 0) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function mount() {
    var slot = document.querySelector("[data-site-visits]");
    if (!slot) return;

    // 可见徽章（hits.sh，仅展示）
    var img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.style.verticalAlign = "middle";
    img.style.height = "18px";
    img.src = BADGE + "?t=" + Date.now();
    slot.textContent = "";
    slot.appendChild(img);

    // 测量：写入 abacus（与读数脚本同一系统）
    bump("page-loads-total");
    if (looksHuman()) bump("page-loads-human");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
