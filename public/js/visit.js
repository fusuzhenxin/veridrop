(function () {
  if (window.__vdVisit) return;
  window.__vdVisit = 1;
  if (location.protocol === "file:") return;
  if (navigator.webdriver) return;

  var script = document.currentScript;
  if (!script || !script.getAttribute) {
    var nodes = document.querySelectorAll("script[data-site]");
    script = null;
    for (var n = nodes.length - 1; n >= 0; n -= 1) {
      var src = nodes[n].getAttribute("src") || "";
      if (src.indexOf("visit.js") >= 0) {
        script = nodes[n];
        break;
      }
    }
  }
  var siteAttr = script && script.getAttribute("data-site");
  var site = siteAttr && /^[a-z0-9]{1,24}$/.test(siteAttr) ? siteAttr : "";
  var endpointAttr = script && script.getAttribute("data-endpoint");
  var endpoint = "/api/visit";
  if (endpointAttr === "https://www.veridrop.cn/api/visit") endpoint = endpointAttr;

  var ua = navigator.userAgent || "";
  if (/ahrefs|mj12bot|bingbot|yandex|shapbot|applebot|googlebot|google-inspectiontool|google-extended|petalbot|bytespider|baiduspider|semrush|dotbot|sogou|360spider|yisouspider|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-searchbot|claude-user|anthropic-ai|perplexity|ccbot|amazonbot|meta-externalagent|meta-externalfetcher|cohere-ai|diffbot|youbot|curl\/|wget\/|python-requests|go-http-client|headlesschrome|local-mirror|scrapy|httpclient|spider|crawler|slurp|\bbot\b/i.test(ua)) return;

  function dayKey() {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    } catch (err) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function kind() {
    var path = location.pathname || "/";
    if (path.length > 1 && path.charAt(path.length - 1) === "/") path = path.slice(0, -1);
    if (path === "/" || path === "") return "home";
    if (path === "/check" || path.indexOf("/check/") === 0) return "check";
    if (path.indexOf("/cat/") === 0) return "cat";
    if (path.indexOf("/site/") === 0) return "site";
    if (path.indexOf("/model/") === 0 || path === "/model") return "model";
    if (path.indexOf("/official/") === 0) return "official";
    if (path === "/apply") return "apply";
    return "other";
  }

  function visitorId() {
    var key = "vd-visit-id";
    try {
      var existing = localStorage.getItem(key) || "";
      if (/^[a-z0-9]{16,48}$/.test(existing)) return existing;
      var bytes = new Uint8Array(18);
      crypto.getRandomValues(bytes);
      var alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
      var id = "";
      for (var i = 0; i < bytes.length; i += 1) id += alphabet[bytes[i] % alphabet.length];
      localStorage.setItem(key, id);
      return id;
    } catch (err) {
      return "";
    }
  }

  function seenName(acted) {
    return acted ? "vd-visit-act" : "vd-visit-open";
  }

  function already(acted, today) {
    try {
      if (localStorage.getItem(seenName(acted)) === today) return true;
      if (acted && localStorage.getItem("vd-visit-day") === today) return true;
      return false;
    } catch (err) {
      return true;
    }
  }

  function post(acted) {
    var today = dayKey();
    if (already(acted, today)) return Promise.resolve();
    var id = visitorId();
    if (!id || typeof fetch !== "function") return Promise.resolve();
    var payload = { id: id, acted: acted };
    if (site) payload.site = site;
    else payload.kind = kind();
    return fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    })
      .then(function (res) {
        if (res && res.ok) {
          try {
            localStorage.setItem(seenName(acted), today);
          } catch (err) {
            /* the next page can send again; the server keeps one row per day */
          }
        }
      })
      .catch(function () {});
  }

  var tail = Promise.resolve();
  function send(acted) {
    tail = tail.then(
      function () {
        return post(acted);
      },
      function () {
        return post(acted);
      }
    );
  }

  function adTarget(node) {
    while (node && node !== document) {
      if (node.tagName === "A" && /(?:^|\s)sponsored(?:\s|$)/.test(node.getAttribute("rel") || "")) return node;
      node = node.parentNode;
    }
    return null;
  }

  function postAd() {
    var today = dayKey();
    try {
      if (localStorage.getItem("vd-visit-ad") === today) return Promise.resolve();
    } catch (err) {
      return Promise.resolve();
    }
    var id = visitorId();
    if (!id || typeof fetch !== "function") return Promise.resolve();
    var payload = { id: id, ad: true, kind: kind() };
    if (site) payload.site = site;
    return fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    })
      .then(function (res) {
        if (res && res.ok) {
          try {
            localStorage.setItem("vd-visit-ad", today);
          } catch (err) {
            /* the server still keeps one ad click per browser per day */
          }
        }
      })
      .catch(function () {});
  }

  document.addEventListener("click", function (ev) {
    if (!ev || ev.isTrusted === false || !adTarget(ev.target)) return;
    tail = tail.then(postAd, postAd);
  }, true);

  var opts = { capture: true, passive: true };
  function once(ev) {
    if (!ev || ev.isTrusted === false) return;
    window.removeEventListener("pointerdown", once, true);
    window.removeEventListener("keydown", once, true);
    window.removeEventListener("scroll", once, opts);
    send(true);
  }
  window.addEventListener("pointerdown", once, true);
  window.addEventListener("keydown", once, true);
  window.addEventListener("scroll", once, opts);
  send(false);
})();
