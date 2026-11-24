// 站点访客计数（免注册）。
//
// 为什么需要它：GitHub 的 traffic API 只统计**仓库页面**，不含 GitHub Pages 站点。
// 两轮以来我看到的 "7 views / 2 uniques" 全部是仓库页，站点访客一直是不可知的。
// 这直接导致「没人来」和「有人来了但不买」无法区分。
//
// 用 abacus.jasoncameron.dev：匿名命名空间、无需注册、无需 key、CORS 为 *，
// 可浏览器直接调用。实测 /hit 会 +1，/get 只读不增加。
//
// 隐私：只上报一个每次加载的 +1，不收集 IP、UA、referrer 或任何标识。
// 失败必须静默：统计坏掉不能影响用户使用工具。
(function () {
  "use strict";

  var NAMESPACE = "elsonshow-dephealth";
  var COUNTER = "pages-visits";
  var BASE = "https://abacus.jasoncameron.dev";

  function withTimeout(promise, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () {
        if (!done) { done = true; resolve(null); }
      }, ms);
      promise.then(
        function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
        function () { if (!done) { done = true; clearTimeout(t); resolve(null); } }
      );
    });
  }

  function hit() {
    if (typeof fetch !== "function") return Promise.resolve(null);
    return withTimeout(
      fetch(BASE + "/hit/" + NAMESPACE + "/" + COUNTER, {
        method: "GET",
        mode: "cors",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      }).then(function (r) { return r.ok ? r.json() : null; }),
      4000
    );
  }

  function show(root, value) {
    if (!root || typeof value !== "number" || !isFinite(value)) return;
    root.textContent = value.toLocaleString("zh-CN");
    root.setAttribute("data-visits", String(value));
  }

  function mount() {
    var el = document.querySelector("[data-site-visits]");
    if (!el) return;
    hit().then(function (data) {
      if (data && typeof data.value === "number") show(el, data.value);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
