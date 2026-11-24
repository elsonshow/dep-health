// 站点访客计数（免注册），并区分「疑似人类」与「总加载」。
//
// 为什么需要两个计数器：
//   本轮实测发现 pageLoads 出现 +1，但无法判断是真实访客还是 IndexNow 之后
//   搜索引擎的抓取器。单看一个数字分不清，会把抓取当成用户。
//
// 做法：
//   主计数 ABACUS_TOTAL  —— 每次加载都 +1（总量）
//   次计数 ABACUS_HUMAN  —— 只有通过基础人类特征检查才 +1
//
// 人类特征检查（全部为简单启发式，不收集任何标识）：
//   - navigator.webdriver 为 false（排除自动化）
//   - 视口尺寸正常（无头浏览器常为 0 或异常小）
//   - 页面可见（document.visibilityState === 'visible'）
//   - 有 languages 且非空
//
// 明确局限：这些特征都可被伪造。所以 HUMAN 计数是「上限估计」，
// 真实人类数一定 <= 该数字。不要把它当成精确值。
//
// 隐私：不上报 IP / UA / referrer，不设 cookie，不收集任何可识别信息。
(function () {
  "use strict";

  var BASE = "https://abacus.jasoncameron.dev";
  var NS = "elsonshow-dephealth";
  var IMG_BASE = "https://hits.sh/github.com/elsonshow/dep-health-elsonshow";

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
      fetch(BASE + "/hit/" + NS + "/" + counter, {
        mode: "cors", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer"
      }).then(function (r) { return r.ok ? r.json() : null; }),
      4000
    );
  }

  /** 基础人类特征检查。返回 true 只表示「看起来像人」，不保证。 */
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

    // 主计数：hits.sh 徽章，每次加载 +1（不依赖 JS 执行）
    var img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.style.verticalAlign = "middle";
    img.style.height = "18px";
    img.src = IMG_BASE + ".svg?t=" + Date.now();
    slot.textContent = "";
    slot.appendChild(img);

    // 总加载计数 + 疑似人类计数
    bump("page-loads-total");
    if (looksHuman()) bump("page-loads-human");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
