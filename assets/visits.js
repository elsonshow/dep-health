// 站点访客计数（免注册）。
//
// 严格说这不是"访客数"而是"页面被加载次数"，但它是唯一在本机约束下可测的数：
//   - GitHub traffic API 只统计**仓库页面**，不含 GitHub Pages 站点（已实测）
//   - 无 Cloudflare / GA token，注册账号是人工门禁
//
// 主计数用 hits.sh：加载一张 SVG 即 +1，不需要 JS 执行，no-store 不缓存。
// 次计数用 abacus：偶发 500，所以只当交叉参考，不作为结论依据。
//
// 隐私：不上报 IP/UA/referrer，不设 cookie，不收集任何标识。
(function () {
  "use strict";

  var IMG_BASE = "https://hits.sh/github.com/elsonshow/dep-health-elsonshow";
  var ABACUS = "https://abacus.jasoncameron.dev";
  var NS = "elsonshow-dephealth";
  var COUNTER = "pages-visits";

  function mount() {
    var slot = document.querySelector("[data-site-visits]");
    if (!slot) return;

    // 主计数：插入 img。每次加载 +1 由 hits.sh 自己记录。
    var img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.style.verticalAlign = "middle";
    img.style.height = "18px";
    img.src = IMG_BASE + ".svg?t=" + Date.now(); // 绕过任何中间缓存
    slot.textContent = "";
    slot.appendChild(img);

    // 次计数：尽力而为，失败静默
    if (typeof fetch === "function") {
      try {
        fetch(ABACUS + "/hit/" + NS + "/" + COUNTER, {
          mode: "cors",
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer"
        }).catch(function () {});
      } catch (e) {}
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
