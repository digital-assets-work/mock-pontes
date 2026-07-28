(function () {
  function row(k, v) {
    return "<tr><td class=\"k\">" + k + "</td><td>" + v + "</td></tr>";
  }

  fetch("/ui/config.json")
    .then(function (r) { return r.json(); })
    .then(function (c) {
      var version = document.getElementById("version");
      if (version) version.textContent = "v" + c.version;

      var strict = c.runtime.strictProfile
        ? "<span class=\"pill ok\">STRICT</span>"
        : "<span class=\"pill warn\">LENIENT</span>";
      var redis = c.runtime.redis
        ? "<span class=\"pill ok\">on</span>"
        : "<span class=\"pill\">off (in-memory)</span>";

      document.getElementById("cfg").innerHTML =
        row("Release version", "<code>" + c.version + "</code>" + (c.commit ? " <span class=\"hint\">(" + c.commit + ")</span>" : "")) +
        row("External URL", "<code>" + c.externalUrl + "</code>") +
        row("Base URL", "<code>" + c.baseUrl + "</code>") +
        row("Default NCB / ORG", "<code>" + c.ncb + "</code>") +
        row("Port", "<code>" + c.runtime.port + "</code>") +
        row("Profile enforcement", strict) +
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
})();
