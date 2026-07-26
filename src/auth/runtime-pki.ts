import crypto from "node:crypto";
import * as x509 from "@peculiar/x509";
import { CacheMemory, RedisCache, type CacheInterface } from "../cache/index.js";

export interface RuntimePkiBundle {
  version: number;
  generatedAt: string;
  serverCaCertificatePem: string;
  serverPrivateKeyPem: string;
  serverCertificatePem: string;
  clientSigningCaPrivateKeyPem: string;
  clientSigningCaCertificatePem: string;
}

const PKI_CACHE_PREFIX = "mock-pontes:pki";
const PKI_CACHE_KEY = "runtime-pki-v2";

let cachedBundle: RuntimePkiBundle | null = null;
let cache: CacheInterface | null = null;
let usingRedis = false;

const EC_ALG: EcKeyGenParams = { name: "ECDSA", namedCurve: "P-256" };
const SIGNING_ALG: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries<T>(operation: () => Promise<T>, maxAttempts = 12): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await delay(100);
      }
    }
  }
  throw lastError;
}

function assertPem(value: string, expectedHeaders: string[], fieldName: string): void {
  if (!expectedHeaders.some((header) => value.includes(header))) {
    throw new Error(`Invalid persisted PKI field '${fieldName}'`);
  }
}

function validateBundle(raw: unknown): RuntimePkiBundle | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Partial<RuntimePkiBundle>;
  const requiredFields: Array<keyof RuntimePkiBundle> = [
    "version",
    "generatedAt",
    "serverCaCertificatePem",
    "serverPrivateKeyPem",
    "serverCertificatePem",
    "clientSigningCaPrivateKeyPem",
    "clientSigningCaCertificatePem",
  ];

  for (const field of requiredFields) {
    if (!(field in candidate) || candidate[field] === undefined || candidate[field] === null) {
      throw new Error(`Persisted PKI bundle is incomplete (missing '${field}')`);
    }
  }

  assertPem(candidate.serverCaCertificatePem as string, ["-----BEGIN CERTIFICATE-----"], "serverCaCertificatePem");
  assertPem(
    candidate.serverPrivateKeyPem as string,
    ["-----BEGIN PRIVATE KEY-----", "-----BEGIN EC PRIVATE KEY-----"],
    "serverPrivateKeyPem",
  );
  assertPem(candidate.serverCertificatePem as string, ["-----BEGIN CERTIFICATE-----"], "serverCertificatePem");
  assertPem(
    candidate.clientSigningCaPrivateKeyPem as string,
    ["-----BEGIN PRIVATE KEY-----", "-----BEGIN EC PRIVATE KEY-----"],
    "clientSigningCaPrivateKeyPem",
  );
  assertPem(candidate.clientSigningCaCertificatePem as string, ["-----BEGIN CERTIFICATE-----"], "clientSigningCaCertificatePem");

  return candidate as RuntimePkiBundle;
}

async function exportKeyToPem(key: CryptoKey): Promise<string> {
  const pkcs8 = await crypto.webcrypto.subtle.exportKey("pkcs8", key);
  return x509.PemConverter.encode(pkcs8, "PRIVATE KEY");
}

async function generateCa(commonName: string, organization: string): Promise<{ keyPem: string; certPem: string }> {
  const keys = await crypto.webcrypto.subtle.generateKey(EC_ALG, true, ["sign", "verify"]);

  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: crypto.randomBytes(16).toString("hex"),
    name: `CN=${commonName}, O=${organization}, C=LU`,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 10 * 365.25 * 24 * 60 * 60 * 1000),
    signingAlgorithm: SIGNING_ALG,
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
    ],
  });

  return {
    keyPem: await exportKeyToPem(keys.privateKey),
    certPem: cert.toString("pem"),
  };
}

async function importCaKey(caKeyPem: string): Promise<CryptoKey> {
  // Normalize any PEM format (SEC1 "EC PRIVATE KEY" or PKCS#8 "PRIVATE KEY") to PKCS#8 DER
  const pkcs8Der = crypto.createPrivateKey(caKeyPem).export({ type: "pkcs8", format: "der" });
  return crypto.webcrypto.subtle.importKey("pkcs8", pkcs8Der, EC_ALG, false, ["sign"]);
}

/**
 * Parse TLS_SAN env var into x509 SAN entries.
 * Format: "dns:localhost;dns:mock-pontes-svc;ip:127.0.0.1"
 * Defaults to "dns:localhost" if not set.
 */
function parseSanEntries(): x509.JsonGeneralName[] {
  const raw = process.env.TLS_SAN || "dns:localhost";
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const colonIdx = entry.indexOf(":");
      if (colonIdx === -1) {
        throw new Error(`Invalid TLS_SAN entry (expected type:value): '${entry}'`);
      }
      const type = entry.substring(0, colonIdx).toLowerCase();
      const value = entry.substring(colonIdx + 1);
      if (type === "dns") return { type: "dns" as const, value };
      if (type === "ip") return { type: "ip" as const, value };
      throw new Error(`Unsupported TLS_SAN type '${type}' (supported: dns, ip)`);
    });
}

function resolveTlsSubject(sans: x509.JsonGeneralName[]): string {
  return process.env.TLS_SUBJECT
    || `CN=${sans.find((s) => s.type === "dns")?.value ?? "localhost"}, O=MockPontes, C=LU`;
}

/**
 * Returns the resolved TLS certificate configuration for logging/display purposes.
 */
export function getTlsCertConfig(): { subject: string; san: string } {
  const sans = parseSanEntries();
  return {
    subject: resolveTlsSubject(sans),
    san: sans.map((s) => `${s.type}:${s.value}`).join(", "),
  };
}

async function generateServerCertificate(
  serverCaKeyPem: string,
  serverCaCertPem: string,
): Promise<{ keyPem: string; certPem: string }> {
  const serverKeys = await crypto.webcrypto.subtle.generateKey(EC_ALG, true, ["sign", "verify"]);
  const caKey = await importCaKey(serverCaKeyPem);
  const caCert = new x509.X509Certificate(serverCaCertPem);

  const sans = parseSanEntries();
  const subject = resolveTlsSubject(sans);

  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: crypto.randomBytes(16).toString("hex"),
    subject,
    issuer: caCert.subject,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 825 * 24 * 60 * 60 * 1000),
    signingAlgorithm: SIGNING_ALG,
    publicKey: serverKeys.publicKey,
    signingKey: caKey,
    extensions: [
      new x509.SubjectAlternativeNameExtension(sans),
    ],
  });

  return {
    keyPem: await exportKeyToPem(serverKeys.privateKey),
    certPem: cert.toString("pem"),
  };
}

async function generateRuntimePkiBundle(): Promise<RuntimePkiBundle> {
  const serverCa = await generateCa("MockPontes-ServerCA", "MockPontes");
  const clientCa = await generateCa("MockPontes-ClientCA", "MockPontes");
  const serverLeaf = await generateServerCertificate(serverCa.keyPem, serverCa.certPem);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    serverCaCertificatePem: serverCa.certPem,
    serverPrivateKeyPem: serverLeaf.keyPem,
    serverCertificatePem: serverLeaf.certPem,
    clientSigningCaPrivateKeyPem: clientCa.keyPem,
    clientSigningCaCertificatePem: clientCa.certPem,
  };
}

function getCache(): CacheInterface {
  if (cache) {
    return cache;
  }

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    cache = new RedisCache(redisUrl, PKI_CACHE_PREFIX);
    usingRedis = true;
    console.log(`[mock-pontes] PKI persistence enabled via Redis (${redisUrl})`);
    return cache;
  }

  cache = new CacheMemory();
  usingRedis = false;
  return cache;
}

export async function getRuntimePkiBundle(): Promise<RuntimePkiBundle> {
  if (cachedBundle) {
    return cachedBundle;
  }

  const pkiCache = getCache();

  let persisted: RuntimePkiBundle | null = null;
  try {
    persisted = validateBundle(await withRetries(() => pkiCache.get<RuntimePkiBundle>(PKI_CACHE_KEY)));
  } catch (err) {
    if (usingRedis) {
      throw new Error(`Failed to read PKI bundle from Redis: ${String(err)}`);
    }
  }

  if (persisted) {
    cachedBundle = persisted;
    console.log("[mock-pontes] Reusing PKI bundle from persisted cache");
    return cachedBundle;
  }

  const generated = await generateRuntimePkiBundle();

  try {
    await withRetries(() => pkiCache.put(PKI_CACHE_KEY, generated, Number.NaN));
  } catch (err) {
    if (usingRedis) {
      throw new Error(`Failed to persist PKI bundle to Redis: ${String(err)}`);
    }
  }

  cachedBundle = generated;
  console.log("[mock-pontes] Generated new runtime PKI bundle");
  return cachedBundle;
}

export function closeRuntimePkiPersistence(): void {
  if (cache) {
    cache.close();
    cache = null;
  }
}
