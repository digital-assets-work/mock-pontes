# mock-pontes Helm chart

A clean, standard Helm chart to deploy [**mock-pontes**](https://github.com/digital-assets-work/mock-pontes)
— a stateful, self-hostable mock of the publicly documented ECB Pontes (TARGET)
A2A API — onto Kubernetes.

The mock serves **HTTPS** on the container port (default `3001`). Out of the box
it generates a **self-signed runtime certificate** (no external dependencies, no
Redis, no cert-manager) and keeps state **in memory** — so a default install
works immediately for a single replica.

## Install

```bash
# From a local checkout of the repo:
helm install my-pontes ./charts/mock-pontes

# Pick a namespace / release name as usual:
helm install my-pontes ./charts/mock-pontes -n pontes --create-namespace
```

Then reach it via port-forward (the app serves HTTPS, so use `-k` or fetch its CA):

```bash
kubectl -n pontes port-forward svc/my-pontes-mock-pontes 8443:443
curl -sk https://localhost:8443/dlt/bdf/api/octopus/health
# {"octopus":"UP","server":"UP","mock":true}
```

## Common recipes

### Pin an image version

```bash
helm install my-pontes ./charts/mock-pontes --set image.tag=1.5.0
```

### Gate the admin surface (required for shared/public instances)

While `ADMIN_TOKEN` is unset the admin endpoints (`/admin/*`) are **open**. Set a
token — the chart renders it into a Secret and injects it:

```bash
helm install my-pontes ./charts/mock-pontes \
  --set admin.token="$(openssl rand -hex 32)"
# ...or reference an existing Secret:
#   --set admin.existingSecret=my-admin-secret --set admin.existingSecretKey=ADMIN_TOKEN
```

### Multiple replicas / persistent PKI (external Redis)

Each replica keeps its own in-memory CA, so enrolled certificates are only valid
on the pod that issued them. Point every replica at a shared Redis to make the
runtime PKI and enrolled users consistent (and survive restarts):

```bash
helm install my-pontes ./charts/mock-pontes \
  --set replicaCount=3 \
  --set config.redisUrl=redis://my-redis-master:6379
```

### Serve a real (cert-manager / manual) TLS certificate

By default the app self-signs. To serve a certificate you already have as a
`kubernetes.io/tls` Secret (e.g. issued by cert-manager), mount it — the chart
wires `TLS_CERT_FILE` / `TLS_KEY_FILE` for you:

```bash
helm install my-pontes ./charts/mock-pontes \
  --set tls.existingSecret=my-pontes-tls \
  --set config.extraTlsSan="dns:mock.example.com"
```

### Expose via Ingress (and keep mTLS working)

> **The mock terminates TLS _and client-certificate (mTLS)_ at the pod.** A
> normal Ingress terminates TLS at the controller and **drops the client
> certificate**, so authenticated `/dlt` and NRO-signed calls would fail. Choose
> one of the two patterns below to preserve mTLS. (`backend-protocol: HTTPS`
> alone only re-encrypts the controller→pod hop — it does **not** carry the
> client cert.)

**Recipe A — TLS passthrough (recommended).** The controller routes by SNI and
never decrypts, so mTLS is terminated end-to-end at the pod. No app config
change. For ingress-nginx (the controller must run with
`--enable-ssl-passthrough`):

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    nginx.ingress.kubernetes.io/ssl-passthrough: "true"
  hosts:
    - host: mock.example.com
      paths:
        - path: /
          pathType: Prefix
```

With passthrough, routing is by host/SNI only — path rules and `backend-protocol`
don't apply, and the mock serves (and validates) the certificate itself.

**Recipe B — terminate at the ingress + forward the client cert (XFCC).** The
controller does the mTLS verification and forwards the certificate to the pod;
tell the mock to trust it:

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    # ingress-nginx: require + forward the client cert (Envoy-based controllers
    # such as Istio/Contour/Emissary emit XFCC natively instead).
    nginx.ingress.kubernetes.io/auth-tls-verify-client: "on"
    nginx.ingress.kubernetes.io/auth-tls-secret: "my-ns/client-ca"
    nginx.ingress.kubernetes.io/backend-protocol: "HTTPS"
    nginx.ingress.kubernetes.io/configuration-snippet: |
      proxy_set_header ssl-client-cert $ssl_client_escaped_cert;
  hosts:
    - host: mock.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: mock-example-tls
      hosts:
        - mock.example.com
# Tell the mock to trust the forwarded client cert (reads
# x-forwarded-client-cert / ssl-client-cert):
extraEnv:
  - name: TRUST_PROXY_CLIENT_CERT
    value: "true"
```

### Let evaluators test any time (disable the business window)

```bash
--set config.businessWindowAlwaysOpen=true
```

## Values

| Key | Default | Description |
|-----|---------|-------------|
| `replicaCount` | `1` | Replicas. `>1` needs `config.redisUrl` for shared state. |
| `image.repository` | `ghcr.io/digital-assets-work/mock-pontes` | Image repository. |
| `image.tag` | `""` (chart `appVersion`) | Image tag. |
| `image.pullPolicy` | `IfNotPresent` | Image pull policy. |
| `imagePullSecrets` | `[]` | Pull secrets for private registries. |
| `nameOverride` / `fullnameOverride` | `""` | Override generated names. |
| `serviceAccount.create` | `false` | Create a dedicated ServiceAccount. |
| `serviceAccount.annotations` | `{}` | ServiceAccount annotations. |
| `automountServiceAccountToken` | `false` | Mount the SA token into the pod. The mock never calls the K8s API, so it's off by default. |
| `podSecurityContext` | nonroot 65532, RuntimeDefault | Pod security context. |
| `securityContext` | no-priv-esc, RO rootfs, drop ALL | Container security context. |
| `service.type` | `ClusterIP` | Service type. |
| `service.port` | `443` | Service port. |
| `service.targetPort` | `3001` | Container HTTPS port (`PORT`). |
| `ingress.enabled` | `false` | Create an Ingress (HTTPS backend). |
| `config.host` | `0.0.0.0` | Bind address (`HOST`). |
| `config.redisUrl` | `""` | External Redis (`REDIS_URL`) for shared/persistent state. |
| `config.defaultNcb` | `""` | `PONTES_DEFAULT_NCB`. |
| `config.externalUrl` | `""` | `PUBLIC_EXTERNAL_URL` (landing page / OIDC issuer). |
| `config.businessWindowAlwaysOpen` | `false` | Disable business-window enforcement. |
| `config.extraTlsSan` | `""` | Extra SANs for the self-signed cert (`TLS_SAN`). |
| `config.tlsSubject` | `""` | Subject for the self-signed cert (`TLS_SUBJECT`). |
| `admin.token` | `""` | ADMIN_TOKEN value (rendered into a Secret). |
| `admin.existingSecret` / `admin.existingSecretKey` | `""` / `ADMIN_TOKEN` | Reference an existing Secret instead. |
| `tls.existingSecret` | `""` | Serve this `kubernetes.io/tls` Secret instead of self-signing. |
| `extraEnv` | `[]` | Additional env vars (name/value or name/valueFrom). |
| `probes.path` | `/dlt/bdf/api/octopus/health` | HTTPS health path for probes. |
| `resources` | `{}` | Pod resource requests/limits. |
| `autoscaling.enabled` | `false` | HorizontalPodAutoscaler. |
| `podDisruptionBudget.enabled` | `false` | PodDisruptionBudget. |
| `nodeSelector` / `tolerations` / `affinity` | `{}` / `[]` / `{}` | Scheduling. |

See [`values.yaml`](values.yaml) for the full, commented set.

## Test the release

```bash
helm test my-pontes -n pontes
```

Runs an in-cluster `curl` against the health endpoint.

## Uninstall

```bash
helm uninstall my-pontes -n pontes
```
