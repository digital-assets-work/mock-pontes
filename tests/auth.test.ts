/**
 * Unit tests for mock-pontes auth layer.
 *
 * Tests:
 * - Test key generation
 * - JWT token issuance
 * - JWT middleware validation
 * - NRO signature verification
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { generateKeyPairSync, createSign } from "node:crypto";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import jwt from "jsonwebtoken";
import { getTestKeys, signData, MOCK_USERS } from "../src/auth/test-keys.js";

describe("Test Keys", () => {
  it("should generate a valid ECDSA P-256 keypair", async () => {
    const keys = await getTestKeys();
    expect(keys.privateKeyPem).toContain("-----BEGIN PRIVATE KEY-----");
    expect(keys.publicKeyPem).toContain("-----BEGIN PUBLIC KEY-----");
    expect(keys.certificatePem).toContain("-----BEGIN CERTIFICATE-----");
    expect(keys.certificateBase64.length).toBeGreaterThan(100);
  });

  it("should return the same cached keys on repeated calls", async () => {
    const keys1 = await getTestKeys();
    const keys2 = await getTestKeys();
    expect(keys1.privateKeyPem).toBe(keys2.privateKeyPem);
  });

  it("should sign data with ECDSA P-256", async () => {
    const keys = await getTestKeys();
    const data = "test-data-to-sign";
    const signature = signData(data, keys.privateKeyPem);

    expect(signature).toBeTruthy();
    // Base64-encoded DER ECDSA signature should start with ME (0x30 0x44/45)
    expect(signature.startsWith("ME")).toBe(true);
  });
});

describe("JWT Issuance", () => {
  it("should issue a valid JWT with correct claims", async () => {
    const keys = await getTestKeys();
    const user = MOCK_USERS["tech-user-initiator"];

    const payload = {
      sub: user.uuid,
      iss: "mock-pontes/iam/realms/BCL",
      aud: "esydlt-web-app",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      scope: "openid",
      preferred_username: "tech-user-initiator",
      user_uuid: user.uuid,
      user_profile: user.profile,
      entity_bic: user.entityBIC,
      realm: "BCL",
    };

    const token = jwt.sign(payload, keys.privateKeyPem, {
      algorithm: "ES256",
      keyid: "mock-pontes-key-1",
    });

    // Verify the token
    const decoded = jwt.verify(token, keys.publicKeyPem, {
      algorithms: ["ES256"],
    }) as jwt.JwtPayload;

    expect(decoded.sub).toBe(user.uuid);
    expect(decoded.user_profile).toBe("PILOT_READ_WRITE");
    expect(decoded.entity_bic).toBe("CACIFFPPXXX");
    expect(decoded.realm).toBe("BCL");
  });

  it("should reject tokens signed with wrong key", async () => {
    const keys = await getTestKeys();

    // Generate a different key
    const { privateKey: wrongKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const wrongKeyPem = wrongKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();

    const token = jwt.sign({ sub: "test" }, wrongKeyPem, {
      algorithm: "ES256",
    });

    expect(() => {
      jwt.verify(token, keys.publicKeyPem, { algorithms: ["ES256"] });
    }).toThrow();
  });
});

describe("NRO Signature Verification", () => {
  function generateTestCert() {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const privateKeyPem = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();

    const tmpKey = join(tmpdir(), `test-nro-key-${Date.now()}.pem`);
    const tmpCert = join(tmpdir(), `test-nro-cert-${Date.now()}.pem`);

    writeFileSync(tmpKey, privateKeyPem, { mode: 0o600 });
    execSync(
      `openssl req -new -x509 -key "${tmpKey}" -out "${tmpCert}" -days 1 -subj "/CN=test-nro/O=Test/C=LU" -sha256 2>/dev/null`,
    );

    const certPem = readFileSync(tmpCert, "utf-8");
    unlinkSync(tmpKey);
    unlinkSync(tmpCert);

    return { privateKeyPem, certPem };
  }

  it("should verify a valid funding signature", () => {
    const { privateKeyPem, certPem } = generateTestCert();

    // Build canonical signing data (Pontes v1.0 order)
    const data = "req-id-12310000.00MP01FRAAXXXECBFDEFFXXX";

    const sign = createSign("SHA256");
    sign.update(data);
    sign.end();
    const signature = sign.sign(privateKeyPem, "base64");

    // Verify
    const { createVerify } = require("node:crypto");
    const verify = createVerify("SHA256");
    verify.update(data);
    verify.end();
    const valid = verify.verify(certPem, signature, "base64");

    expect(valid).toBe(true);
  });

  it("should reject a tampered signature", () => {
    const { privateKeyPem, certPem } = generateTestCert();

    const data = "req-id-12310000.00MP01FRAAXXXECBFDEFFXXX";

    const sign = createSign("SHA256");
    sign.update(data);
    sign.end();
    const signature = sign.sign(privateKeyPem, "base64");

    // Tamper with the data
    const { createVerify } = require("node:crypto");
    const verify = createVerify("SHA256");
    verify.update("tampered-data");
    verify.end();
    const valid = verify.verify(certPem, signature, "base64");

    expect(valid).toBe(false);
  });

  it("should reject a signature from a different key", () => {
    const cert1 = generateTestCert();
    const cert2 = generateTestCert();

    const data = "test-data";

    const sign = createSign("SHA256");
    sign.update(data);
    sign.end();
    const signature = sign.sign(cert1.privateKeyPem, "base64");

    // Try to verify with different cert
    const { createVerify } = require("node:crypto");
    const verify = createVerify("SHA256");
    verify.update(data);
    verify.end();
    const valid = verify.verify(cert2.certPem, signature, "base64");

    expect(valid).toBe(false);
  });
});

describe("Mock Users", () => {
  it("should have initiator and approver users with different UUIDs", () => {
    const initiator = MOCK_USERS["tech-user-initiator"];
    const approver = MOCK_USERS["tech-user-approver"];

    expect(initiator).toBeDefined();
    expect(approver).toBeDefined();
    expect(initiator.uuid).not.toBe(approver.uuid);
    expect(initiator.profile).toBe("PILOT_READ_WRITE");
    expect(approver.profile).toBe("PILOT_READ_WRITE");
  });

  it("should have an external user", () => {
    const external = MOCK_USERS["tech-user-external"];
    expect(external).toBeDefined();
    expect(external.profile).toBe("EXTERNAL_USER");
  });
});
