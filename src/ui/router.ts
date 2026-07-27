/**
 * Native (no-build) UI served directly from the mock-pontes backend.
 *
 * Routes (all unauthenticated — dev only):
 *   GET  /                     → redirect to /ui
 *   GET  /ui                   → home: runtime config + connectivity URLs
 *   GET  /ui/docs              → embedded Swagger UI (OpenAPI "try it out")
 *   GET  /ui/enroll            → upload a CSR, enroll a user, download the signed cert
 *   GET  /openapi.json         → OpenAPI spec (consumed by Swagger UI)
 *   GET  /openapi.yaml         → OpenAPI spec as YAML
 *   GET  /openapi/official.json → vendored official ECB Pontes spec
 *   GET  /openapi/official.yaml → vendored official ECB Pontes spec as YAML
 *   GET  /ui/config.json       → runtime config as JSON (consumed by the home page)
 *   POST /ui/inspect           → parse a submitted PEM (CSR/cert) and return details
 *
 * The HTML/CSS/JS is embedded as strings so esbuild bundles it (no static assets).
 * Client-side JS deliberately avoids `${...}` so these TS template literals stay literal.
 */

import {
  createRouter,
  defineEventHandler,
  getRequestURL,
  readBody,
  sendRedirect,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { buildServedSpec } from "./openapi.js";
import { inspectPem } from "./inspect.js";
import { buildP12 } from "./p12.js";
import { stringify as stringifyYaml } from "yaml";
// Official ECB Pontes OpenAPI v1.0 (EII API), vendored as JSON.
// Source: https://www.ecb.europa.eu/paym/target/target-professional-use-documents-links/pontes/shared/pdf/ecb.pontes26_05_15_OpenAPI_Document_v1.0_Pontes_Pilot.en.zip
// Retrieved 2026-07-24; pristine (converted from YAML). Refresh from that URL when ECB updates the spec.
import officialSpec from "./spec/pontes-official-v1.0.json";

/** Release version — from the release build's baked git ref, falling back to the
 *  npm package version (dev) so the UI always shows something meaningful. */
function mockVersion(): string {
  const ref = process.env.PUBLIC_GIT_REF_NAME;
  if (ref && ref !== "no_ref_name") return ref.replace(/^v/, "");
  return process.env.npm_package_version || "dev";
}
/** Short commit hash baked at build time, when available. */
function mockCommit(): string | undefined {
  const c = process.env.PUBLIC_COMMIT_HASH;
  return c && c !== "no_commit_hash" ? c.slice(0, 7) : undefined;
}

// The served spec is derived from the official spec + the route registry, so it
// must be built AFTER all routes are registered. Build lazily on first request
// and memoize (routes are stable once the app has started). `info.version` is
// stamped with the running release so the docs match the build.
let _servedSpec: ReturnType<typeof buildServedSpec> | undefined;
let _openapiYaml: string | undefined;
function getServedSpec(): ReturnType<typeof buildServedSpec> {
  if (!_servedSpec) _servedSpec = buildServedSpec(mockVersion());
  return _servedSpec;
}
function getOpenapiYaml(): string {
  if (_openapiYaml === undefined) {
    _openapiYaml = stringifyYaml(getServedSpec(), { lineWidth: 0 });
  }
  return _openapiYaml;
}
const officialYaml = stringifyYaml(officialSpec, { lineWidth: 0 });

function baseUrlFor(event: Parameters<typeof getRequestURL>[0]): string {
  const envUrl = process.env.PUBLIC_EXTERNAL_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  try {
    const u = getRequestURL(event);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

const NAV = `
<header class="nav">
  <div class="brand">🅜 Mock Pontes</div>
  <nav>
    <a href="/ui">Home</a>
    <a href="/ui/enroll">Enroll (CSR)</a>
    <a href="/ui/docs">API Docs</a>
  </nav>
</header>`;

const STYLE = `
<style>
  :root { --bg:#0f172a; --card:#1e293b; --line:#334155; --fg:#e2e8f0; --muted:#94a3b8; --accent:#38bdf8; --ok:#4ade80; --warn:#fbbf24; --err:#f87171; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:var(--bg); color:var(--fg); }
  .nav { display:flex; align-items:center; justify-content:space-between; padding:12px 24px; background:var(--card); border-bottom:1px solid var(--line); }
  .brand { font-weight:700; }
  .nav nav a { color:var(--fg); text-decoration:none; margin-left:18px; padding:6px 10px; border-radius:8px; }
  .nav nav a:hover { background:var(--line); color:var(--accent); }
  main { max-width: 960px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 28px; color: var(--accent); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; margin:16px 0; }
  label { display:block; font-size:.8rem; color:var(--muted); margin:10px 0 4px; }
  input, select, textarea { width:100%; background:#0b1220; color:var(--fg); border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:.85rem; }
  textarea { min-height:150px; resize:vertical; }
  button { background:var(--accent); color:#04283a; border:0; border-radius:8px; padding:9px 16px; font-weight:600; cursor:pointer; margin-top:12px; }
  button.secondary { background:var(--line); color:var(--fg); }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .row { display:flex; gap:14px; flex-wrap:wrap; } .row > div { flex:1; min-width:180px; }
  table { width:100%; border-collapse:collapse; font-size:.85rem; }
  td { padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  td.k { color:var(--muted); width:190px; white-space:nowrap; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre { background:#0b1220; border:1px solid var(--line); border-radius:8px; padding:12px; overflow:auto; font-size:.78rem; white-space:pre-wrap; word-break:break-all; }
  a.link { color:var(--accent); }
  .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:.72rem; font-weight:600; }
  .pill.ok { background:rgba(74,222,128,.15); color:var(--ok); }
  .pill.warn { background:rgba(251,191,36,.15); color:var(--warn); }
  .pill.err { background:rgba(248,113,113,.15); color:var(--err); }
  .hint { color:var(--muted); font-size:.8rem; }
  .tabs { display:flex; gap:8px; margin-bottom:4px; }
  .tab { margin-top:0; background:var(--line); color:var(--fg); }
  .tab.active { background:var(--accent); color:#04283a; }
</style>`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Mock Pontes</title>${STYLE}</head>
<body>${NAV}<main>${body}</main></body></html>`;
}

const HOME_BODY = `
<h1>Mock Pontes — control panel <span class="pill ok" style="font-size:13px;vertical-align:middle">v${mockVersion()}</span></h1>
<p class="hint">Local mock of the ECB Pontes A2A API. No authentication (dev only).</p>

<div class="card">
  <h2>Runtime configuration</h2>
  <table id="cfg"><tbody><tr><td class="hint">loading…</td></tr></tbody></table>
</div>

<div class="card">
  <h2>Connectivity endpoints</h2>
  <table><tbody>
    <tr><td class="k">Health</td><td><a class="link" id="e-health" target="_blank"></a></td></tr>
    <tr><td class="k">IP check</td><td><a class="link" id="e-ip" target="_blank">/check/ip</a></td></tr>
    <tr><td class="k">mTLS check</td><td><a class="link" id="e-mtls" target="_blank">/check/mtls</a> <span class="hint">(requires a client cert)</span></td></tr>
    <tr><td class="k">CSR enrollment</td><td><code id="e-csr"></code></td></tr>
    <tr><td class="k">Token</td><td><code id="e-token"></code></td></tr>
    <tr><td class="k">OpenAPI</td><td><a class="link" id="e-openapi" target="_blank">/openapi.json</a> · <a class="link" href="/openapi.yaml" target="_blank">/openapi.yaml</a></td></tr>
    <tr><td class="k">Official spec</td><td><a class="link" href="/openapi/official.json" target="_blank">/openapi/official.json</a> · <a class="link" href="/openapi/official.yaml" target="_blank">/openapi/official.yaml</a></td></tr>
  </tbody></table>
</div>

<script>
(function(){
  function row(k,v){ return "<tr><td class=\\"k\\">"+k+"</td><td>"+v+"</td></tr>"; }
  fetch("/ui/config.json").then(function(r){return r.json();}).then(function(c){
    var strict = c.runtime.strictProfile ? "<span class=\\"pill ok\\">STRICT</span>" : "<span class=\\"pill warn\\">LENIENT</span>";
    var redis = c.runtime.redis ? "<span class=\\"pill ok\\">on</span>" : "<span class=\\"pill\\">off (in-memory)</span>";
    document.getElementById("cfg").innerHTML =
      row("Release version", "<code>"+c.version+"</code>"+(c.commit?" <span class=\\"hint\\">("+c.commit+")</span>":"")) +
      row("External URL", "<code>"+c.externalUrl+"</code>") +
      row("Base URL", "<code>"+c.baseUrl+"</code>") +
      row("Default NCB / ORG", "<code>"+c.ncb+"</code>") +
      row("Port", "<code>"+c.runtime.port+"</code>") +
      row("Profile enforcement", strict) +
      row("User persistence", redis);
    var E = c.endpoints;
    var h=document.getElementById("e-health"); h.href=E.health; h.textContent=E.health;
    var ip=document.getElementById("e-ip"); ip.href=E.checkIp; ip.textContent=E.checkIp;
    var m=document.getElementById("e-mtls"); m.href=E.checkMtls; m.textContent=E.checkMtls;
    document.getElementById("e-csr").textContent="POST "+E.csr;
    document.getElementById("e-token").textContent="POST "+E.token;
    var o=document.getElementById("e-openapi"); o.href=E.openapi; o.textContent=E.openapi;
  }).catch(function(e){ document.getElementById("cfg").innerHTML = "<tr><td class=\\"hint\\">config error: "+e+"</td></tr>"; });
})();
</script>`;

const ENROLL_BODY = `
<h1>CSR enrollment</h1>
<p class="hint">Upload or paste a PKCS#10 CSR, declare the user, and download the signed certificate.
Inspect either the CSR or the issued certificate (subject, key, and the Pontes <code>privilege</code> attribute).</p>

<div class="card">
  <h2>1 · Certificate Signing Request</h2>
  <label>Upload a .csr / .pem file</label>
  <input type="file" id="csrFile" accept=".csr,.pem,.txt">
  <label>…or paste the CSR (PEM)</label>
  <textarea id="csr" placeholder="-----BEGIN CERTIFICATE REQUEST-----"></textarea>
  <button class="secondary" id="btnInspect" type="button">Inspect CSR</button>
  <div id="csrDetails"></div>
</div>

<div class="card">
  <h2>2 · User declaration</h2>
  <div class="row">
    <div><label>NCB / ORG (realm)</label><input id="ncb" value="bdf"></div>
    <div><label>Username (= CSR Common Name)</label><input id="username" placeholder="PFRBSUIFRPPXXX0001"></div>
  </div>
  <div class="row">
    <div><label>Password</label><input id="password" value="initiator-secret"></div>
    <div><label>Entity BIC (MSPID)</label><input id="entityBIC" placeholder="BSUIFRPPXXX"></div>
    <div><label>Profile</label>
      <select id="profile">
        <option>PILOT_READ_WRITE</option>
        <option>PILOT_READ_ONLY</option>
        <option>EXTERNAL_USER</option>
        <option>REFERENTIAL_READ_WRITE</option>
        <option>REFERENTIAL_READ_ONLY</option>
      </select>
    </div>
  </div>
  <button id="btnEnroll" type="button">Enroll &amp; issue certificate</button>
  <span class="hint" id="enrollStatus"></span>
</div>

<div class="card" id="certCard" style="display:none">
  <h2>3 · Issued certificate</h2>
  <div id="certDetails"></div>
  <button id="btnDownload" type="button">⬇ Download certificate (.pem)</button>
  <label>PEM</label>
  <pre id="certPem"></pre>
</div>

<div class="card" id="p12Card">
  <h2>4 · Download as PKCS#12 (.p12)</h2>
  <p class="hint">Bundle the issued certificate with your private key for import into Keychain / a browser.
  ⚠️ Your private key is sent to this <b>local</b> mock only to assemble the bundle (never stored). For real keys, prefer the command line below.</p>
  <label>Private key (PEM) — upload or paste</label>
  <input type="file" id="p12keyFile" accept=".pem,.key,.txt">
  <textarea id="p12key" placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
  <label>Export password</label>
  <input id="p12pw" type="password" placeholder="choose a password">
  <button id="btnP12" type="button">Build &amp; download .p12</button>
  <span class="hint" id="p12status"></span>
</div>

<div class="card">
  <h2>5 · Create &amp; install from the command line</h2>
  <p class="hint">Recommended for real keys — the private key never leaves your machine.</p>
  <label>Create the .p12 (you'll be prompted for an export password)</label>
  <pre>openssl pkcs12 -export \\
  -inkey &lt;your_private_key&gt;.pem \\
  -in    &lt;your_cert&gt;.pem \\
  -name  "PFRBSUIFRPPXXX0001" \\
  -out   PFRBSUIFRPPXXX0001.p12</pre>
  <label>Install — macOS Keychain (Safari / Chrome / Edge)</label>
  <pre>security import PFRBSUIFRPPXXX0001.p12 -k ~/Library/Keychains/login.keychain-db
# verify:
security find-identity -v ~/Library/Keychains/login.keychain-db | grep PFRBSUIFRPPXXX0001</pre>
  <label>Install — Firefox (separate certificate store)</label>
  <pre>Settings → Privacy &amp; Security → Certificates → View Certificates
  → Your Certificates → Import… → select the .p12</pre>
  <label>Use directly for CLI / app mTLS (no install)</label>
  <pre>curl --cert &lt;your_cert&gt;.pem --key &lt;your_private_key&gt;.pem \\
     -k https://localhost:3001/check/mtls</pre>
</div>

<script>
(function(){
  var issuedPem = "", issuedName = "certificate";
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>]/g, function(c){ return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"; }); }
  function pill(p){
    if (!p) return "<span class=\\"pill\\">n/a</span>";
    var cls = p === "2E" ? "ok" : "warn";
    return "<span class=\\"pill "+cls+"\\">"+esc(p)+"</span>";
  }
  function detailsTable(d){
    if (!d || d.valid === false) return "<p class=\\"hint\\">Invalid: "+esc(d && d.error)+"</p>";
    function r(k,v){ return v == null || v === "" ? "" : "<tr><td class=\\"k\\">"+k+"</td><td>"+v+"</td></tr>"; }
    var priv = d.privilege ? pill(d.privilege) + (d.privilege === "2E" ? " <span class=\\"hint\\">(A2A ✓)</span>" : " <span class=\\"hint\\">(U2A/human — wrong for A2A)</span>") : null;
    var exts = (d.extensions || []).map(function(e){ return e.oid; }).join(", ");
    return "<table><tbody>" +
      r("Type", "<span class=\\"pill ok\\">"+esc(d.type)+"</span>") +
      r("Common Name (CN)", "<code>"+esc(d.commonName)+"</code>") +
      r("Country (C)", esc(d.country)) +
      r("Organization (O)", esc(d.organization)) +
      r("Org Unit (OU)", esc(d.organizationalUnit)) +
      r("Privilege", priv) +
      r("MSPID", d.mspid ? "<code>"+esc(d.mspid)+"</code>" : null) +
      r("Public key", (d.publicKeyType ? esc(d.publicKeyType) : "") + (d.curve ? " / "+esc(d.curve) : "")) +
      r("Issuer", d.issuer ? "<code>"+esc(d.issuer)+"</code>" : null) +
      r("Valid from", esc(d.notBefore)) +
      r("Valid to", esc(d.notAfter)) +
      r("Serial", d.serialNumber ? "<code>"+esc(d.serialNumber)+"</code>" : null) +
      r("Extensions", exts ? "<code>"+esc(exts)+"</code>" : null) +
      "</tbody></table>";
  }
  function inspect(pem, targetId){
    return fetch("/ui/inspect", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ pem: pem }) })
      .then(function(r){ return r.json(); })
      .then(function(d){ document.getElementById(targetId).innerHTML = detailsTable(d); return d; });
  }

  document.getElementById("csrFile").addEventListener("change", function(ev){
    var f = ev.target.files[0]; if (!f) return;
    var reader = new FileReader();
    reader.onload = function(){
      document.getElementById("csr").value = reader.result;
      inspect(reader.result, "csrDetails").then(function(d){
        if (d && d.commonName && !document.getElementById("username").value) document.getElementById("username").value = d.commonName;
        if (d && (d.mspid || d.organization) && !document.getElementById("entityBIC").value) document.getElementById("entityBIC").value = d.mspid || d.organization;
      });
    };
    reader.readAsText(f);
  });

  document.getElementById("btnInspect").addEventListener("click", function(){
    var csr = document.getElementById("csr").value.trim();
    if (!csr) return;
    inspect(csr, "csrDetails").then(function(d){
      if (d && d.commonName && !document.getElementById("username").value) document.getElementById("username").value = d.commonName;
      if (d && (d.mspid || d.organization) && !document.getElementById("entityBIC").value) document.getElementById("entityBIC").value = d.mspid || d.organization;
    });
  });

  document.getElementById("btnEnroll").addEventListener("click", function(){
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
    fetch("/iam/realms/"+encodeURIComponent(ncb)+"/protocol/openid-connect/csr", {
      method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(body)
    }).then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
      .then(function(res){
        if (!res.ok || !res.j.certificate){
          status.innerHTML = " <span class=\\"pill err\\">FAILED</span> " + esc(res.j.error_description || res.j.error || "unknown error");
          return;
        }
        status.innerHTML = " <span class=\\"pill ok\\">ISSUED</span>";
        issuedPem = res.j.certificate;
        issuedName = (body.username || "certificate") + "_cert.pem";
        document.getElementById("certPem").textContent = issuedPem;
        document.getElementById("certCard").style.display = "block";
        inspect(issuedPem, "certDetails");
      }).catch(function(e){ status.innerHTML = " <span class=\\"pill err\\">ERROR</span> " + esc(e); });
  });

  document.getElementById("btnDownload").addEventListener("click", function(){
    if (!issuedPem) return;
    var blob = new Blob([issuedPem], { type:"application/x-pem-file" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = issuedName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  });

  document.getElementById("p12keyFile").addEventListener("change", function(ev){
    var f = ev.target.files[0]; if (!f) return;
    var rd = new FileReader(); rd.onload = function(){ document.getElementById("p12key").value = rd.result; }; rd.readAsText(f);
  });

  document.getElementById("btnP12").addEventListener("click", function(){
    var st = document.getElementById("p12status");
    if (!issuedPem){ st.innerHTML = " <span class=\\"pill err\\">no certificate</span> enroll first"; return; }
    var key = document.getElementById("p12key").value.trim();
    if (!key){ st.innerHTML = " <span class=\\"pill err\\">need private key</span>"; return; }
    var name = document.getElementById("username").value.trim() || "pontes-user";
    st.textContent = " building…";
    fetch("/ui/p12", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ keyPem:key, certPem:issuedPem, password: document.getElementById("p12pw").value, name:name }) })
      .then(function(r){ if(!r.ok) return r.json().then(function(j){ throw new Error(j.detail||j.error||"failed"); }); return r.blob(); })
      .then(function(blob){
        var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name+".p12";
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
        st.innerHTML = " <span class=\\"pill ok\\">downloaded</span>";
      })
      .catch(function(e){ st.innerHTML = " <span class=\\"pill err\\">ERROR</span> " + esc(e); });
  });
})();
</script>`;

const DOCS_BODY = `
<h1>API documentation</h1>

<div class="tabs">
  <button id="tab-mock" class="tab active" type="button">Mock endpoints (testable)</button>
  <button id="tab-official" class="tab" type="button">Official Pontes API v1.0 (reference)</button>
</div>

<div class="card" id="authPanel">
  <h2>Authentication</h2>
  <p class="hint">Get a JWT from the mock token endpoint and apply it automatically to the “Try it out” calls below.
  Requires your client certificate to be installed &amp; selected for this origin (mTLS).</p>
  <div class="row">
    <div><label>NCB / ORG</label><input id="a-ncb" value="bdf"></div>
    <div><label>Username</label><input id="a-user" placeholder="PFRBSUIFRPPXXX0001"></div>
    <div><label>Password</label><input id="a-pass" type="password"></div>
    <div><label>Client ID</label>
      <select id="a-client">
        <option>esydlt-web-app</option>
        <option>esydlt-backend-service</option>
      </select>
    </div>
  </div>
  <button id="a-btn" type="button">Get token &amp; authorize</button>
  <span class="hint" id="a-status"></span>
  <div id="a-claims"></div>
</div>

<div class="card" id="official-note" style="display:none">
  <b>Reference only.</b> The official ECB OpenAPI v1.0 (EII API) — for browsing the real contract.
  “Try it out” is disabled: the mock implements a subset. Use the <b>Mock endpoints</b> tab to test.
</div>

<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
<div id="swagger-mock" style="background:#fff;border-radius:12px;overflow:hidden"></div>
<div id="swagger-official" style="background:#fff;border-radius:12px;overflow:hidden;display:none"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
(function(){
  var currentToken = '';
  var uiMock = null, officialInited = false;

  function initMock(){
    uiMock = window.SwaggerUIBundle({
      url: '/openapi.json', dom_id: '#swagger-mock', deepLinking: true,
      requestInterceptor: function(req){ if (currentToken) req.headers['Authorization'] = 'Bearer ' + currentToken; return req; }
    });
  }
  function initOfficial(){
    if (officialInited) return; officialInited = true;
    window.SwaggerUIBundle({ url: '/openapi/official.json', dom_id: '#swagger-official', deepLinking: true, supportedSubmitMethods: [] });
  }
  function start(){ if (!window.SwaggerUIBundle){ setTimeout(start, 150); return; } initMock(); }
  start();

  function show(mock){
    document.getElementById('tab-mock').classList.toggle('active', mock);
    document.getElementById('tab-official').classList.toggle('active', !mock);
    document.getElementById('swagger-mock').style.display = mock ? 'block' : 'none';
    document.getElementById('swagger-official').style.display = mock ? 'none' : 'block';
    document.getElementById('authPanel').style.display = mock ? 'block' : 'none';
    document.getElementById('official-note').style.display = mock ? 'none' : 'block';
    if (!mock) initOfficial();
  }
  document.getElementById('tab-mock').addEventListener('click', function(){ show(true); });
  document.getElementById('tab-official').addEventListener('click', function(){ show(false); });

  function b64url(s){ s = s.replace(/-/g,'+').replace(/_/g,'/'); while (s.length % 4) s += '='; return atob(s); }
  document.getElementById('a-btn').addEventListener('click', function(){
    var ncb = document.getElementById('a-ncb').value.trim() || 'bdf';
    var client = document.getElementById('a-client').value;
    var body = new URLSearchParams({ grant_type:'password', username: document.getElementById('a-user').value.trim(), password: document.getElementById('a-pass').value, scope:'openid', client_id: client });
    if (client === 'esydlt-backend-service') body.set('client_secret', 'esydlt-backend-service');
    var st = document.getElementById('a-status'); st.textContent = ' requesting…';
    fetch('/iam/realms/' + encodeURIComponent(ncb) + '/protocol/openid-connect/token', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body: body.toString() })
      .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
      .then(function(res){
        if (!res.ok || !res.j.access_token){ st.innerHTML = ' <span class="pill err">FAILED</span> ' + (res.j.error_description || res.j.error || 'no token'); return; }
        currentToken = res.j.access_token;
        if (uiMock && uiMock.preauthorizeApiKey) uiMock.preauthorizeApiKey('bearerAuth', currentToken);
        st.innerHTML = ' <span class="pill ok">AUTHORIZED</span> token applied to Try-it-out';
        try {
          var p = JSON.parse(b64url(currentToken.split('.')[1]));
          document.getElementById('a-claims').innerHTML = '<table><tbody>' +
            '<tr><td class="k">user</td><td>' + (p.preferred_username || '') + '</td></tr>' +
            '<tr><td class="k">profile</td><td>' + (p.user_profile || '') + '</td></tr>' +
            '<tr><td class="k">entity BIC</td><td>' + (p.entity_bic || '') + '</td></tr>' +
            '<tr><td class="k">expires</td><td>' + (p.exp ? new Date(p.exp*1000).toLocaleTimeString() : '') + '</td></tr>' +
          '</tbody></table>';
        } catch (e) {}
      })
      .catch(function(e){ st.innerHTML = ' <span class="pill err">ERROR</span> ' + e; });
  });
})();
</script>`;

export function createUiRouter() {
  const router = createRouter();

  router.get(
    "/",
    defineEventHandler((event) => sendRedirect(event, "/ui", 302)),
  );

  router.get(
    "/ui",
    defineEventHandler((event) => {
      setResponseHeader(event, "content-type", "text/html; charset=utf-8");
      return page("Home", HOME_BODY);
    }),
  );

  router.get(
    "/ui/enroll",
    defineEventHandler((event) => {
      setResponseHeader(event, "content-type", "text/html; charset=utf-8");
      return page("Enroll", ENROLL_BODY);
    }),
  );

  router.get(
    "/ui/docs",
    defineEventHandler((event) => {
      setResponseHeader(event, "content-type", "text/html; charset=utf-8");
      return page("API Docs", DOCS_BODY);
    }),
  );

  router.get(
    "/openapi.json",
    defineEventHandler(() => getServedSpec()),
  );

  router.get(
    "/openapi.yaml",
    defineEventHandler((event) => {
      setResponseHeader(event, "content-type", "application/yaml; charset=utf-8");
      return getOpenapiYaml();
    }),
  );

  router.get(
    "/openapi/official.json",
    defineEventHandler(() => officialSpec),
  );

  router.get(
    "/openapi/official.yaml",
    defineEventHandler((event) => {
      setResponseHeader(event, "content-type", "application/yaml; charset=utf-8");
      return officialYaml;
    }),
  );

  router.get(
    "/ui/config.json",
    defineEventHandler((event) => {
      const baseUrl = baseUrlFor(event);
      const ncb = (process.env.PONTES_DEFAULT_NCB || "bdf").toLowerCase();
      return {
        baseUrl,
        externalUrl: process.env.PUBLIC_EXTERNAL_URL || baseUrl,
        ncb,
        version: mockVersion(),
        commit: mockCommit(),
        endpoints: {
          health: `${baseUrl}/dlt/${ncb}/api/octopus/health`,
          checkIp: `${baseUrl}/check/ip`,
          checkMtls: `${baseUrl}/check/mtls`,
          csr: `${baseUrl}/iam/realms/${ncb}/protocol/openid-connect/csr`,
          token: `${baseUrl}/iam/realms/${ncb}/protocol/openid-connect/token`,
          openapi: `${baseUrl}/openapi.json`,
          openapiYaml: `${baseUrl}/openapi.yaml`,
          officialOpenapi: `${baseUrl}/openapi/official.json`,
          officialOpenapiYaml: `${baseUrl}/openapi/official.yaml`,
        },
        runtime: {
          port: Number(process.env.PORT || 3001),
          strictProfile: process.env.PONTES_MOCK_LENIENT_PROFILE !== "true",
          redis: Boolean(process.env.REDIS_URL),
        },
      };
    }),
  );

  router.post(
    "/ui/inspect",
    defineEventHandler(async (event) => {
      const body = (await readBody(event)) as { pem?: string } | undefined;
      return inspectPem(body?.pem ?? "");
    }),
  );

  router.post(
    "/ui/p12",
    defineEventHandler(async (event) => {
      const body = (await readBody(event)) as
        | { keyPem?: string; certPem?: string; password?: string; name?: string }
        | undefined;
      if (!body?.keyPem || !body?.certPem) {
        setResponseStatus(event, 400);
        return { error: "invalid_request", detail: "keyPem and certPem are required" };
      }
      const name = (body.name || "certificate").replace(/[^A-Za-z0-9._-]/g, "_");
      try {
        const der = await buildP12(body.keyPem, body.certPem, body.password ?? "", name);
        setResponseHeader(event, "content-type", "application/x-pkcs12");
        setResponseHeader(event, "content-disposition", `attachment; filename="${name}.p12"`);
        return der;
      } catch (e) {
        setResponseStatus(event, 501);
        return {
          error: "p12_failed",
          detail: `Could not build PKCS#12 (is openssl installed?): ${String(e).slice(0, 300)}`,
        };
      }
    }),
  );

  return router;
}
