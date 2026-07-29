(function () {
  function row(k, v) {
    return "<tr><td class=\"k\">" + k + "</td><td>" + v + "</td></tr>";
  }

  fetch("/ui/config.json")
    .then(function (r) { return r.json(); })
    .then(function (c) {
      var version = document.getElementById("version");
      if (version) version.textContent = "v" + c.version;

      var redis = c.runtime.redis
        ? "<span class=\"pill ok\">on</span>"
        : "<span class=\"pill\">off (in-memory)</span>";

      document.getElementById("cfg").innerHTML =
        row("Release version", "<code>" + c.version + "</code>" + (c.commit ? " <span class=\"hint\">(" + c.commit + ")</span>" : "")) +
        row("External URL", "<code>" + c.externalUrl + "</code>") +
        row("Base URL", "<code>" + c.baseUrl + "</code>") +
        row("Default NCB / ORG", "<code>" + c.ncb + "</code>") +
        row("Port", "<code>" + c.runtime.port + "</code>") +
        row("User persistence", redis);

      var E = c.endpoints;
      var h = document.getElementById("e-health"); h.href = E.health; h.textContent = E.health;
      var ip = document.getElementById("e-ip"); ip.href = E.checkIp; ip.textContent = E.checkIp;
      var m = document.getElementById("e-mtls"); m.href = E.checkMtls; m.textContent = E.checkMtls;
      document.getElementById("e-csr").textContent = "POST " + E.csr;
      document.getElementById("e-token").textContent = "POST " + E.token;
      var o = document.getElementById("e-openapi"); o.href = E.openapi; o.textContent = E.openapi;
    })
    .catch(function (e) {
      document.getElementById("cfg").innerHTML = "<tr><td class=\"hint\">config error: " + e + "</td></tr>";
    });

  // Business window (issue #81): show the stored day + the live current window,
  // and how to change it via POST /admin/business-window.
  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }
  fetch("/admin/business-window")
    .then(function (r) { return r.json(); })
    .then(function (b) {
      var state = document.getElementById("bw-state");
      if (state) {
        state.textContent = b.isOpen ? "open" : "closed";
        state.className = "pill " + (b.isOpen ? "ok" : "");
      }
      document.getElementById("bw").innerHTML =
        row("Current window", "<code>" + esc(b.windowName) + "</code> <span class=\"hint\">(" + esc(b.windowStartTime) + "–" + esc(b.windowEndTime) + " Europe/Berlin)</span>") +
        row("Next window", "<code>" + esc(b.nextWindowName) + "</code>") +
        row("Business date", "<code>" + esc(b.businessDate) + "</code>") +
        row("Start of Day starts", "<code>" + esc(b.sodStart) + "</code>") +
        row("Open for All starts", "<code>" + esc(b.ofaStart) + "</code>") +
        row("Open for All ends", "<code>" + esc(b.ofaEnd) + "</code>") +
        row("End of Day ends", "<code>" + esc(b.eodEnd) + "</code>");
      var help = document.getElementById("bw-help");
      if (help) {
        help.innerHTML =
          "The current window is derived from the Frankfurt-local time. " +
          "Change one or more day fields (times must stay in increasing order) with, e.g.:<br>" +
          "<code>curl -X POST " + location.origin + "/admin/business-window " +
          "-H 'content-type: application/json' " +
          "-d '{\"sodStart\":\"07:00\",\"ofaStart\":\"09:00\",\"ofaEnd\":\"17:00\",\"eodEnd\":\"18:00\"}'</code> " +
          "(add <code>-H 'authorization: Bearer &lt;ADMIN_TOKEN&gt;'</code> when the admin token is set).";
      }
    })
    .catch(function (e) {
      document.getElementById("bw").innerHTML = "<tr><td class=\"hint\">business-window error: " + e + "</td></tr>";
    });
})();
