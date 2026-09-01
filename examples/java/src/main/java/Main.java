import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Base64;
import java.util.Enumeration;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Minimal mTLS + NRO example client for mock-pontes (Java, JDK 17+).
 *
 * Flow:
 *   1. GET  /check/mtls                          - prove the client cert is accepted
 *   2. GET  /dlt/{ncb}/api/octopus/health        - unauthenticated round trip
 *   3. POST /iam/realms/{ncb}/.../token          - acquire a JWT (mTLS only, no password;
 *                                                  identity comes from the cert)
 *   4. POST /dlt/{ncb}/api/octopus/tms/funding-requests
 *                                                - NRO-signed funding request (2-step)
 *   5. PUT  /dlt/{ncb}/.../funding-requests-drafts/{id}/approve
 *                                                - four-eyes approval by a SECOND user
 *   6. GET  /dlt/{ncb}/api/octopus/ams/wallets/{alias}
 *                                                - verify the wallet was credited
 *
 * Four-eyes control: the request is created by the initiator but must be approved
 * by a *different* enrolled user (a distinct certificate / user UUID); self-
 * approval is rejected with 403 HL-GER-003. Steps 5-6 run only when a second
 * (approver) PKCS#12 is configured via APPROVER_P12.
 *
 * Consumes the mock's PKCS#12 (.p12) export directly for both mTLS and NRO signing.
 */
public class Main {

    static String env(String key, String def) {
        String v = System.getenv(key);
        return v != null ? v : def;
    }

    public static void main(String[] args) throws Exception {
        String baseUrl = env("BASE_URL", "https://localhost:3001");
        String ncb = env("NCB", "bdf");
        String p12Path = env("CLIENT_P12", "user.p12");
        String p12Pass = env("P12_PASSWORD", "changeit");
        // TLS server verification (issue #89): CA_CERT set -> trust that CA (local self-signed:
        // fetch from GET /ca.pem); unset -> use the JDK default trust store (hosted LE cert).
        String caPath = System.getenv("CA_CERT");
        // Explicit, loud opt-out (dev only) - never skip verification silently.
        boolean insecure = env("INSECURE_SKIP_VERIFY", "").matches("(?i)1|true|yes");
        String amount = env("AMOUNT", "1000000.00");
        String creditedAlias = env("CREDITED_ALIAS", "WFREURBSUIFRPPXXX-01");
        String entityBic = env("ENTITY_BIC", "BSUIFRPPXXX");
        String managerBic = env("MANAGER_BIC", "BDFEFRPPXXX");
        // Approver (four-eyes) - a SECOND enrolled user with its own PKCS#12.
        String approverP12 = env("APPROVER_P12", "approver.p12");
        String approverP12Pass = env("APPROVER_P12_PASSWORD", p12Pass);

        // Load the PKCS#12 keystore (certificate + private key) and build the mTLS client.
        KeyStore ks = loadP12(p12Path, p12Pass);
        HttpClient http = newHttpClient(ks, p12Pass, caPath, insecure);

        // 1. mTLS acceptance
        HttpResponse<String> mtls = send(http, "GET", baseUrl + "/check/mtls", null, null, null);
        System.out.println("1) GET /check/mtls        -> " + mtls.statusCode() + " " + mtls.body());

        // 2. Health (unauthenticated)
        HttpResponse<String> health = send(http, "GET", baseUrl + "/dlt/" + ncb + "/api/octopus/health", null, null, null);
        System.out.println("2) GET .../octopus/health -> " + health.statusCode() + " " + health.body());

        // 3. Token (mTLS only - no password)
        String token = getToken(http, baseUrl, ncb);
        System.out.println("3) POST .../token         -> " + (token != null ? "(JWT acquired)" : "FAILED"));
        if (token == null) {
            throw new RuntimeException("No access_token - check the certificate is enrolled (POST /csr)");
        }

        // 4. NRO-signed funding request
        String techId = env("TECH_FUND_REQUEST_ID", "FUND-" + System.currentTimeMillis());
        String debitedOwner = "ECBFDEFFXXX";

        // NRO canonical signing string (Pontes v1.0):
        //   techFundRequestID + amount + creditedCashWalletOwnerID + debitedCashWalletOwnerID
        String signingData = techId + amount + entityBic + debitedOwner;

        PrivateKey privateKey = firstPrivateKey(ks, p12Pass);
        X509Certificate cert = firstCertificate(ks);
        Signature ecdsa = Signature.getInstance("SHA256withECDSA");
        ecdsa.initSign(privateKey);
        ecdsa.update(signingData.getBytes(StandardCharsets.UTF_8));
        String signature = Base64.getEncoder().encodeToString(ecdsa.sign()); // DER ECDSA, base64
        // signerPEM accepts base64-DER (no PEM headers); the mock wraps it and must
        // match the presented mTLS certificate byte-for-byte.
        String signerPem = Base64.getEncoder().encodeToString(cert.getEncoded());

        String body = "{"
                + "\"techFundRequestID\":\"" + techId + "\","
                + "\"type\":\"FUNDING\","
                + "\"amount\":\"" + amount + "\","
                + "\"currency\":\"EUR\","
                + "\"creditedCashWalletAlias\":\"" + creditedAlias + "\","
                + "\"creditedCashWalletManagerID\":\"" + managerBic + "\","
                + "\"creditedCashWalletOwnerID\":\"" + entityBic + "\","
                + "\"debitedCashWalletAlias\":\"WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET\","
                + "\"debitedCashWalletManagerID\":\"" + debitedOwner + "\","
                + "\"debitedCashWalletOwnerID\":\"" + debitedOwner + "\","
                + "\"signature\":\"" + signature + "\","
                + "\"signerPEM\":\"" + signerPem + "\""
                + "}";

        HttpResponse<String> funding = send(http, "POST",
                baseUrl + "/dlt/" + ncb + "/api/octopus/tms/funding-requests",
                body, "application/json", "Bearer " + token);
        System.out.println("4) POST .../funding-requests -> " + funding.statusCode() + " " + funding.body());
        String fundingId = extract(funding.body(), "id"); // server-assigned FRQ id

        // 5. Four-eyes approval by a SECOND user (self-approval is rejected 403).
        if (fundingId == null || !new java.io.File(approverP12).exists()) {
            System.out.println("5) approval skipped - set APPROVER_P12 (a second enrolled user)"
                    + " to run the four-eyes approve + balance check.");
            return;
        }
        KeyStore aks = loadP12(approverP12, approverP12Pass);
        HttpClient approverHttp = newHttpClient(aks, approverP12Pass, caPath);
        String approverToken = getToken(approverHttp, baseUrl, ncb);
        if (approverToken == null) {
            throw new RuntimeException("Approver token failed (check APPROVER_P12 is enrolled)");
        }
        HttpResponse<String> approve = send(approverHttp, "PUT",
                baseUrl + "/dlt/" + ncb + "/api/octopus/tms/funding-requests-drafts/" + fundingId + "/approve",
                null, null, "Bearer " + approverToken);
        System.out.println("5) PUT .../{id}/approve   -> " + approve.statusCode() + " " + approve.body());

        // 6. Verify the credited wallet now holds the funded amount.
        HttpResponse<String> wallet = send(http, "GET",
                baseUrl + "/dlt/" + ncb + "/api/octopus/ams/wallets/" + creditedAlias,
                null, null, "Bearer " + token);
        String balance = extract(wallet.body(), "availableBalance");
        System.out.println("6) GET .../ams/wallets     -> " + wallet.statusCode()
                + " " + (balance != null ? "availableBalance=" + balance : wallet.body()));
    }

    static KeyStore loadP12(String path, String pass) throws Exception {
        KeyStore ks = KeyStore.getInstance("PKCS12");
        try (InputStream in = new FileInputStream(path)) {
            ks.load(in, pass.toCharArray());
        }
        return ks;
    }

    /**
     * Build an mTLS HttpClient from a keystore. Server verification (issue #89):
     *   caPath set   -> trust that CA (local self-signed cert fetched from /ca.pem)
     *   caPath unset -> JDK default trust store (verifies the hosted Let's Encrypt cert)
     *   insecure     -> explicit opt-out: trust any server cert + skip hostname check (dev only)
     */
    static HttpClient newHttpClient(KeyStore ks, String pass, String caPath, boolean insecure) throws Exception {
        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(ks, pass.toCharArray());

        boolean hasCa = caPath != null && !caPath.isEmpty();
        TrustManager[] trustManagers;
        if (!hasCa && insecure) {
            System.out.println("WARNING: TLS server verification is DISABLED (INSECURE_SKIP_VERIFY). Dev use only.");
            System.setProperty("jdk.internal.httpclient.disableHostnameVerification", "true");
            trustManagers = new TrustManager[]{ new X509TrustManager() {
                public void checkClientTrusted(X509Certificate[] chain, String authType) { }
                public void checkServerTrusted(X509Certificate[] chain, String authType) { }
                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            }};
        } else if (hasCa) {
            KeyStore trust = KeyStore.getInstance(KeyStore.getDefaultType());
            trust.load(null, null);
            CertificateFactory cf = CertificateFactory.getInstance("X.509");
            try (InputStream in = new FileInputStream(caPath)) {
                int i = 0;
                for (Certificate c : cf.generateCertificates(in)) {
                    trust.setCertificateEntry("ca" + (i++), c);
                }
            }
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init(trust);
            trustManagers = tmf.getTrustManagers();
        } else {
            // Default: verify against the JDK trust store (publicly-trusted server certs).
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init((KeyStore) null);
            trustManagers = tmf.getTrustManagers();
        }

        SSLContext ssl = SSLContext.getInstance("TLS");
        ssl.init(kmf.getKeyManagers(), trustManagers, new SecureRandom());
        return HttpClient.newBuilder().sslContext(ssl).build();
    }

    /** Acquire a JWT over the given mTLS client (identity = the certificate); returns null on failure. */
    static String getToken(HttpClient http, String baseUrl, String ncb) throws Exception {
        String form = "grant_type=password"
                + "&client_id=esydlt-web-app"
                + "&scope=openid";
        HttpResponse<String> res = send(http, "POST",
                baseUrl + "/iam/realms/" + ncb + "/protocol/openid-connect/token",
                form, "application/x-www-form-urlencoded", null);
        return extract(res.body(), "access_token");
    }

    static HttpResponse<String> send(HttpClient http, String method, String url,
                                     String body, String contentType, String bearer) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url));
        if (contentType != null) b.header("Content-Type", contentType);
        if (bearer != null) b.header("Authorization", bearer);
        HttpRequest.BodyPublisher pub = body == null
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body);
        b.method(method, pub);
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    static String extract(String json, String key) {
        Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*\"([^\"]*)\"").matcher(json);
        return m.find() ? m.group(1) : null;
    }

    static PrivateKey firstPrivateKey(KeyStore ks, String pass) throws Exception {
        for (Enumeration<String> e = ks.aliases(); e.hasMoreElements(); ) {
            String alias = e.nextElement();
            if (ks.isKeyEntry(alias)) {
                return (PrivateKey) ks.getKey(alias, pass.toCharArray());
            }
        }
        throw new RuntimeException("No key entry in the .p12");
    }

    static X509Certificate firstCertificate(KeyStore ks) throws Exception {
        for (Enumeration<String> e = ks.aliases(); e.hasMoreElements(); ) {
            String alias = e.nextElement();
            if (ks.isKeyEntry(alias)) {
                return (X509Certificate) ks.getCertificate(alias);
            }
        }
        throw new RuntimeException("No certificate in the .p12");
    }
}
