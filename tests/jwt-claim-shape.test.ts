/**
 * JWT claim shape produced by `signTokens()` (issue #118).
 *
 * Direct reproduction against the real `utest` pilot captured tokens shaped
 * like `{ azp: <requested client_id>, aud: [clientId, "account"],
 * resource_access: { [clientId]: { roles }, account: { roles } } }` — this
 * covers that shape directly (signTokens is a pure function, so no mTLS
 * harness is needed; the token endpoint's HTTP route that calls it requires
 * a real mTLS handshake to reach, which this suite's plain-HTTP integration
 * harness doesn't simulate — see tests/integration/enrollment-flow.test.ts).
 */

import { describe, it, expect } from "@jest/globals";
import jwt from "jsonwebtoken";
import { getRuntimePkiBundle } from "../src/auth/runtime-pki.js";
import { signTokens, type TokenSubject } from "../src/auth/enrollment-routes.js";

async function decodeAccessToken(subject: TokenSubject) {
  const pki = await getRuntimePkiBundle();
  const { accessToken } = signTokens(subject, pki.jwtSigningPrivateKeyPem);
  return jwt.verify(accessToken, pki.jwtSigningPublicKeyPem, {
    algorithms: ["ES256"],
  }) as jwt.JwtPayload;
}

const BASE_SUBJECT: TokenSubject = {
  uuid: "u1",
  username: "PFRBSUIFRPPXXX0001",
  profile: "PILOT_READ_WRITE",
  entityBIC: "BSUIFRPPXXX",
  ncb: "bdf",
  clientId: "esydlt-web-app",
  scope: "openid",
};

describe("signTokens() JWT claim shape (issue #118)", () => {
  it("sets aud to [clientId, 'account'] regardless of which client_id was requested", async () => {
    const decoded = await decodeAccessToken({ ...BASE_SUBJECT, clientId: "esydlt-web-app" });
    expect(decoded.aud).toEqual(["esydlt-web-app", "account"]);
  });

  it("accepts an arbitrary/unmapped client_id (mock no longer validates it against Table U)", async () => {
    const decoded = await decodeAccessToken({ ...BASE_SUBJECT, clientId: "totally-made-up-client" });
    expect(decoded.aud).toEqual(["totally-made-up-client", "account"]);
    expect(decoded.azp).toBe("totally-made-up-client");
  });

  it("sets azp to the requested client_id verbatim", async () => {
    const decoded = await decodeAccessToken({ ...BASE_SUBJECT, clientId: "esydlt-backend-service" });
    expect(decoded.azp).toBe("esydlt-backend-service");
  });

  it("wraps the subject's single profile in resource_access.<clientId>.roles", async () => {
    const decoded = await decodeAccessToken({
      ...BASE_SUBJECT,
      clientId: "esydlt-web-app",
      profile: "REFERENTIAL_READ_ONLY",
    });
    expect(decoded.resource_access).toMatchObject({
      "esydlt-web-app": { roles: ["REFERENTIAL_READ_ONLY"] },
    });
  });

  it("always includes the static account client roles", async () => {
    const decoded = await decodeAccessToken(BASE_SUBJECT);
    expect(decoded.resource_access.account.roles).toEqual([
      "manage-account",
      "manage-account-links",
      "view-profile",
    ]);
  });

  it("keeps the existing custom claims the rest of the app relies on", async () => {
    const decoded = await decodeAccessToken(BASE_SUBJECT);
    expect(decoded.user_uuid).toBe("u1");
    expect(decoded.user_profile).toBe("PILOT_READ_WRITE");
    expect(decoded.entity_bic).toBe("BSUIFRPPXXX");
    expect(decoded.realm).toBe("bdf");
    expect(decoded.preferred_username).toBe("PFRBSUIFRPPXXX0001");
  });
});
