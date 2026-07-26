# Java mTLS + NRO example

Uses `java.net.http.HttpClient` with an `SSLContext` built from the mock's
**PKCS#12 (`.p12`)** export, and `SHA256withECDSA` for the NRO signature. JDK 17+,
no third-party dependencies.

## Prerequisites

- JDK 17+ and Maven (or use the Docker command below).
- The mock's **`.p12`** export for an enrolled user (build it on `/ui/enroll`
  section 4, or with `openssl pkcs12 -export`; see
  [`../../docs/ENROLL-WITH-ECB-TOOLS.md`](../../docs/ENROLL-WITH-ECB-TOOLS.md)).
- A running mock (default `https://localhost:3001`).

## Run (local)

```bash
CLIENT_P12=/path/to/user.p12 \
P12_PASSWORD=yourpassword \
PONTES_USERNAME=PFRBSUIFRPPXXX0001 \
PONTES_PASSWORD=initiator-secret \
mvn -q compile exec:java
```

## Run (Docker, no local JDK/Maven)

From this `examples/java` folder, mounting your `.p12` and targeting the mock on
the host:

```bash
docker run --rm -v "$PWD":/app -v /path/to/user.p12:/certs/user.p12 -w /app \
  -e BASE_URL=https://host.docker.internal:3001 \
  -e CLIENT_P12=/certs/user.p12 -e P12_PASSWORD=yourpassword \
  -e PONTES_USERNAME=PFRBSUIFRPPXXX0001 -e PONTES_PASSWORD=initiator-secret \
  maven:3.9-eclipse-temurin-17 mvn -q compile exec:java
```

## Environment variables

| Var | Default | Description |
|-----|---------|-------------|
| `BASE_URL` | `https://localhost:3001` | Mock base URL |
| `NCB` | `bdf` | NCB / realm |
| `CLIENT_P12` | `user.p12` | PKCS#12 with cert + key |
| `P12_PASSWORD` | `changeit` | PKCS#12 export password |
| `CA_CERT` | *(unset)* | Server CA (PEM). When unset, server verification is disabled (local dev). |
| `PONTES_USERNAME` / `PONTES_PASSWORD` | `PFRBSUIFRPPXXX0001` / `initiator-secret` | Credentials from enrollment |
| `AMOUNT`, `CREDITED_ALIAS`, `ENTITY_BIC`, `MANAGER_BIC` | see `Main.java` | Funding parameters |

## Against real Pontes

Set `BASE_URL` to the Pontes EII gateway, `CA_CERT` to the ECB CA bundle, and use
a `.p12` built from your Service-Desk-issued certificate/key.
