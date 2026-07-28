(function () {
  var issuedPem = "", issuedName = "certificate";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }

  function pill(p) {
    if (!p) return "<span class=\"pill\">n/a</span>";
    var cls = p === "2E" ? "ok" : "warn";
    return "<span class=\"pill " + cls + "\">" + esc(p) + "</span>";
  }

  function detailsTable(d) {
    if (!d || d.valid === false) return "<p class=\"hint\">Invalid: " + esc(d && d.error) + "</p>";
    function r(k, v) {
      return v == null || v === "" ? "" : "<tr><td class=\"k\">" + k + "</td><td>" + v + "</td></tr>";
    }
    var priv = d.privilege
      ? pill(d.privilege) + (d.privilege === "2E"
        ? " <span class=\"hint\">(A2A ✓)</span>"
        : " <span class=\"hint\">(U2A/human — wrong for A2A)</span>")
      : null;
    var exts = (d.extensions || []).map(function (e) { return e.oid; }).join(", ");
    return "<table><tbody>" +
      r("Type", "<span class=\"pill ok\">" + esc(d.type) + "</span>") +
      r("Common Name (CN)", "<code>" + esc(d.commonName) + "</code>") +
      r("Country (C)", esc(d.country)) +
      r("Organization (O)", esc(d.organization)) +
      r("Org Unit (OU)", esc(d.organizationalUnit)) +
      r("Privilege", priv) +
      r("MSPID", d.mspid ? "<code>" + esc(d.mspid) + "</code>" : null) +
      r("Public key", (d.publicKeyType ? esc(d.publicKeyType) : "") + (d.curve ? " / " + esc(d.curve) : "")) +
      r("Issuer", d.issuer ? "<code>" + esc(d.issuer) + "</code>" : null) +
      r("Valid from", esc(d.notBefore)) +
      r("Valid to", esc(d.notAfter)) +
      r("Serial", d.serialNumber ? "<code>" + esc(d.serialNumber) + "</code>" : null) +
      r("Extensions", exts ? "<code>" + esc(exts) + "</code>" : null) +
      "</tbody></table>";
  }

  function inspect(pem, targetId) {
    return fetch("/ui/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pem: pem })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { document.getElementById(targetId).innerHTML = detailsTable(d); return d; });
  }

  document.getElementById("csrFile").addEventListener("change", function (ev) {
    var f = ev.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      document.getElementById("csr").value = reader.result;
      inspect(reader.result, "csrDetails").then(function (d) {
        if (d && d.commonName && !document.getElementById("username").value) document.getElementById("username").value = d.commonName;
        if (d && (d.mspid || d.organization) && !document.getElementById("entityBIC").value) document.getElementById("entityBIC").value = d.mspid || d.organization;
      });
    };
    reader.readAsText(f);
  });

  document.getElementById("btnInspect").addEventListener("click", function () {
    var csr = document.getElementById("csr").value.trim();
    if (!csr) return;
    inspect(csr, "csrDetails").then(function (d) {
      if (d && d.commonName && !document.getElementById("username").value) document.getElementById("username").value = d.commonName;
      if (d && (d.mspid || d.organization) && !document.getElementById("entityBIC").value) document.getElementById("entityBIC").value = d.mspid || d.organization;
    });
  });

  document.getElementById("btnEnroll").addEventListener("click", function () {
    var ncb = document.getElementById("ncb").value.trim() || "bdf";
    var body = {
      username: document.getElementById("username").value.trim(),
      password: document.getElementById("password").value,
      profile: document.getElementById("profile").value,
      entityBIC: document.getElementById("entityBIC").value.trim(),
      csr: document.getElementById("csr").value.trim()
    };
    var status = document.getElementById("enrollStatus");
    status.textContent = " enrolling…";
    fetch("/iam/realms/" + encodeURIComponent(ncb) + "/protocol/openid-connect/csr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.certificate) {
          status.innerHTML = " <span class=\"pill err\">FAILED</span> " + esc(res.j.error_description || res.j.error || "unknown error");
          return;
        }
        status.innerHTML = " <span class=\"pill ok\">ISSUED</span>";
        issuedPem = res.j.certificate;
        issuedName = (body.username || "certificate") + "_cert.pem";
        document.getElementById("certPem").textContent = issuedPem;
        document.getElementById("certCard").style.display = "block";
        inspect(issuedPem, "certDetails");
      })
      .catch(function (e) { status.innerHTML = " <span class=\"pill err\">ERROR</span> " + esc(e); });
  });

  document.getElementById("btnDownload").addEventListener("click", function () {
    if (!issuedPem) return;
    var blob = new Blob([issuedPem], { type: "application/x-pem-file" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = issuedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  });

  document.getElementById("p12keyFile").addEventListener("change", function (ev) {
    var f = ev.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () { document.getElementById("p12key").value = rd.result; };
    rd.readAsText(f);
  });

  document.getElementById("btnP12").addEventListener("click", function () {
    var st = document.getElementById("p12status");
    if (!issuedPem) { st.innerHTML = " <span class=\"pill err\">no certificate</span> enroll first"; return; }
    var key = document.getElementById("p12key").value.trim();
    if (!key) { st.innerHTML = " <span class=\"pill err\">need private key</span>"; return; }
    var name = document.getElementById("username").value.trim() || "pontes-user";
    st.textContent = " building…";
    fetch("/ui/p12", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyPem: key, certPem: issuedPem, password: document.getElementById("p12pw").value, name: name })
    })
      .then(function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(j.detail || j.error || "failed"); }); return r.blob(); })
      .then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name + ".p12";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        st.innerHTML = " <span class=\"pill ok\">downloaded</span>";
      })
      .catch(function (e) { st.innerHTML = " <span class=\"pill err\">ERROR</span> " + esc(e); });
  });
})();
