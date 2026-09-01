(function () {
  var currentToken = "";
  var uiMock = null, officialInited = false;

  function initMock() {
    uiMock = window.SwaggerUIBundle({
      url: "/openapi.json",
      dom_id: "#swagger-mock",
      deepLinking: true,
      requestInterceptor: function (req) {
        if (currentToken) req.headers["Authorization"] = "Bearer " + currentToken;
        return req;
      }
    });
  }

  function initOfficial() {
    if (officialInited) return;
    officialInited = true;
    window.SwaggerUIBundle({
      url: "/openapi/official.json",
      dom_id: "#swagger-official",
      deepLinking: true,
      supportedSubmitMethods: []
    });
  }

  function start() {
    if (!window.SwaggerUIBundle) { setTimeout(start, 150); return; }
    initMock();
  }
  start();

  function show(mock) {
    document.getElementById("tab-mock").classList.toggle("active", mock);
    document.getElementById("tab-official").classList.toggle("active", !mock);
    document.getElementById("swagger-mock").style.display = mock ? "block" : "none";
    document.getElementById("swagger-official").style.display = mock ? "none" : "block";
    document.getElementById("authPanel").style.display = mock ? "block" : "none";
    document.getElementById("official-note").style.display = mock ? "none" : "block";
    if (!mock) initOfficial();
  }
  document.getElementById("tab-mock").addEventListener("click", function () { show(true); });
  document.getElementById("tab-official").addEventListener("click", function () { show(false); });

  function b64url(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return atob(s);
  }

  document.getElementById("a-btn").addEventListener("click", function () {
    var ncb = document.getElementById("a-ncb").value.trim() || "bdf";
    var client = document.getElementById("a-client").value;
    var body = new URLSearchParams({
      grant_type: "password",
      scope: "openid",
      client_id: client
    });
    if (client === "esydlt-backend-service") body.set("client_secret", "esydlt-backend-service");
    var st = document.getElementById("a-status");
    st.textContent = " requesting…";
    fetch("/iam/realms/" + encodeURIComponent(ncb) + "/protocol/openid-connect/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.access_token) {
          st.innerHTML = " <span class=\"pill err\">FAILED</span> " + (res.j.error_description || res.j.error || "no token");
          return;
        }
        currentToken = res.j.access_token;
        if (uiMock && uiMock.preauthorizeApiKey) uiMock.preauthorizeApiKey("bearerAuth", currentToken);
        st.innerHTML = " <span class=\"pill ok\">AUTHORIZED</span> token applied to Try-it-out";
        try {
          var p = JSON.parse(b64url(currentToken.split(".")[1]));
          document.getElementById("a-claims").innerHTML = "<table><tbody>" +
            "<tr><td class=\"k\">user</td><td>" + (p.preferred_username || "") + "</td></tr>" +
            "<tr><td class=\"k\">profile</td><td>" + (p.user_profile || "") + "</td></tr>" +
            "<tr><td class=\"k\">entity BIC</td><td>" + (p.entity_bic || "") + "</td></tr>" +
            "<tr><td class=\"k\">expires</td><td>" + (p.exp ? new Date(p.exp * 1000).toLocaleTimeString() : "") + "</td></tr>" +
            "</tbody></table>";
        } catch (e) { }
      })
      .catch(function (e) { st.innerHTML = " <span class=\"pill err\">ERROR</span> " + e; });
  });
})();
