(function () {
  var path = location.pathname || "/";
  var body = JSON.stringify({ path: path, referrer: document.referrer || "" });
  fetch("/api/collect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body,
    keepalive: true,
  }).catch(function () {});
})();
