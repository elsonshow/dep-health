// 站点访客计数（免注册），区分「总加载」与「疑似人类」。
//
// 为什么不再用 abacus（EXP-035 实测结论）：
//   连续 5 次请求只有 1 次成功（200），其余是 timeout 或 500。
//   成功率约 20%，不可作为数据源——读不到时只能写 null，长期等于没有这个指标。
//
// 改用两个独立的 hits.sh 路径（实测连续 3 次均 200，稳定）：
//   dep-health-elsonshow        —— 总加载（每页每次加载 +1）
//   dep-health-human-elsonshow  —— 疑似人类（仅在通过基础特征检查时 +1）
//
// 局限（必须记住）：
//   - 人类特征是启发式，可被伪造；human 只能当上限：真实人类数 <= human
//   - hits.sh 读一次就 +1，因此只能靠「减去已知的自己调用次数」推断增量
//   - 两者之差不可直接读成「机器人」，也可能是 JS 未执行
//
// 隐私：不上报 IP / UA / referrer，不设 cookie，不收集任何标识。
(function () {
  "use strict";

  var TOTAL = "https://hits.sh/github.com/elsonshow/dep-health-elsonshow.svg";
  var HUMAN = "https://hits.sh/github.com/elsonshow/dep-health-human-elsonshow.svg";

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

  function badge(url) {
    var img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.style.height = "18px";
    img.style.verticalAlign = "middle";
    img.src = url + "?t=" + Date.now();
    return img;
  }

  function mount() {
    var slot = document.querySelector("[data-site-visits]");
    if (!slot) return;

    // 总加载：可见徽章
    slot.textContent = "";
    slot.appendChild(badge(TOTAL));

    // 疑似人类：不可见像素，仅通过检查时加载（加载即 +1）
    if (looksHuman()) {
      var h = badge(HUMAN);
      h.style.position = "absolute";
      h.style.width = "1px";
      h.style.height = "1px";
      h.style.opacity = "0";
      slot.appendChild(h);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
