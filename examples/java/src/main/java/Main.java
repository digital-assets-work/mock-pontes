import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
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
 *   3. POST /iam/realms/{ncb}/.../token          - acquire a JWT (mTLS + password)
 *   4. POST /dlt/{ncb}/api/octopus/tms/funding-requests
 *                                                - NRO-signed funding request (2-step)
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
        String caPath = System.getenv("CA_CERT"); // optional
        String username = env("PONTES_USERNAME", "PFRBSUIFRPPXXX0001");
        String password = env("PONTES_PASSWORD", "initiator-secret");
        String amount = env("AMOUNT", "1000000.00");
        String creditedAlias = env("CREDITED_ALIAS", "WFREURBSUIFRPPXXX-01");
        String entityBic = env("ENTITY_BIC", "BSUIFRPPXXX");
        String managerBic = env("MANAGER_BIC", "BDFEFRPPXXX");

        // Load the PKCS#12 keystore (certificate + private key).
        KeyStore ks = KeyStore.getInstance("PKCS12");
        try (InputStream in = new FileInputStream(p12Path)) {
            ks.load(in, p12Pass.toCharArray());
        }
        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(ks, p12Pass.toCharArray());

        // Trust: use CA_CERT when provided, otherwise accept any server (local dev only).
        boolean insecure = (caPath == null || caPath.isEmpty());
        TrustManager[] trustManagers;
        if (insecure) {
            System.setProperty("jdk.internal.httpclient.disableHostnameVerification", "true");
            trustManagers = new TrustManager[]{ new X509TrustManager() {
                public void checkClientTrusted(X509Certificate[] chain, String authType) { }
                public void checkServerTrusted(X509Certificate[] chain, String authType) { }
                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            }};
        } else {
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
        }

        SSLContext ssl = SSLContext.getInstance("TLS");
        ssl.init(kmf.getKeyManagers(), trustManagers, new SecureRandom());
        HttpClient http = HttpClient.newBuilder().sslContext(ssl).build();

        // 1. mTLS acceptance
        HttpResponse<String> mtls = send(http, "GET", baseUrl + "/check/mtls", null, null, null);
        System.out.println("1) GET /check/mtls        -> " + mtls.statusCode() + " " + mtls.body());

        // 2. Health (unauthenticated)
        HttpResponse<String> health = send(http, "GET", baseUrl + "/dlt/" + ncb + "/api/octopus/health", null, null, null);
        System.out.println("2) GET .../octopus/health -> " + health.statusCode() + " " + health.body());

        // 3. Token (mTLS + password grant)
        String form = "grant_type=password"
                + "&username=" + enc(username)
                + "&password=" + enc(password)
                + "&client_id=esydlt-web-app"
                + "&scope=openid";
        HttpResponse<String> tokenRes = send(http, "POST",
                baseUrl + "/iam/realms/" + ncb + "/protocol/openid-connect/token",
                form, "application/x-www-form-urlencoded", null);
        String token = extract(tokenRes.body(), "access_token");
        System.out.println("3) POST .../token         -> " + tokenRes.statusCode()
                + " " + (token != null ? "(JWT acquired)" : tokenRes.body()));
        if (token == null) {
            throw new RuntimeException("No access_token - check USERNAME/PASSWORD and enrollment");
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
                + "\"amount\":\"" + amount + "\","
                + "\"currency\":\"EUR\","
                + "\"creditedCashWalletAlias\":\"" + creditedAlias + "\","
                + "\"creditedCashWalletManagerID\":\"" + managerBic + "\","
                + "\"creditedCashWalletOwnerID\":\"" + entityBic + "\","
                + "\"debitedCashWalletManagerID\":\"" + debitedOwner + "\","
                + "\"debitedCashWalletOwnerID\":\"" + debitedOwner + "\","
                + "\"signature\":\"" + signature + "\","
                + "\"signerPEM\":\"" + signerPem + "\""
                + "}";

        HttpResponse<String> funding = send(http, "POST",
                baseUrl + "/dlt/" + ncb + "/api/octopus/tms/funding-requests",
                body, "application/json", "Bearer " + token);
        System.out.println("4) POST .../funding-requests -> " + funding.statusCode() + " " + funding.body());
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

    static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
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
