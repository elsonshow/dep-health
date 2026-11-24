// 站点访客计数（免注册），区分「总加载」与「疑似人类」。
//
// 设计约束（本轮实测得出）：
//   - hits.sh：每次读 SVG 都 +1，稳定无缓存；但无法区分来源
//   - abacus.jasoncameron.dev：/hit 可 +1，/get 对不存在的 key 返回 404/500，
//     且历史上偶发 500 —— 不能作为唯一读数来源
//
// 因此：用 hits.sh 做「总量」（可靠），用 abacus 做「疑似人类」（次要、失败静默）。
// 两者之差不可直接读成「机器人」——也可能是 JS 未执行。
//
// 人类特征检查是可伪造的启发式，只能当上限：真实人类数 <= suspectedHuman。
// 隐私：不上报 IP / UA / referrer，不设 cookie。
(function () {
  "use strict";

  var ABACUS = "https://abacus.jasoncameron.dev";
  var NS = "elsonshow-dephealth";
  var HITS = "https://hits.sh/github.com/elsonshow/dep-health-elsonshow";

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

    // 总量：hits.sh 徽章，每次页面加载 +1（不依赖 JS 执行，最可靠）
    var img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.style.verticalAlign = "middle";
    img.style.height = "18px";
    img.src = HITS + ".svg?t=" + Date.now();
    slot.textContent = "";
    slot.appendChild(img);

    // 疑似人类：仅在通过检查时 +1（次要指标，失败静默）
    if (looksHuman()) bump("page-loads-human");
    // 总加载也记一份到 abacus，便于与 human 比较
    bump("page-loads-total");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
