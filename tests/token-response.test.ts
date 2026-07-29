/**
 * Token endpoint wire fidelity (issue #87): the Keycloak-shaped response uses
 * the **hyphenated** `not-before-policy` key (not `not_before_policy`), so
 * strict client parsers and generated Keycloak DTOs match.
 */

import { describe, it, expect } from "@jest/globals";
import { tokenResponse } from "../src/auth/enrollment-routes.js";

describe("tokenResponse wire format (issue #87)", () => {
  const body = tokenResponse("access-jwt", "refresh-jwt", "openid", "u1") as Record<string, unknown>;

  it("uses the hyphenated Keycloak key `not-before-policy`", () => {
    expect(body).toHaveProperty("not-before-policy", 0);
    expect(body).not.toHaveProperty("not_before_policy");
  });

  it("keeps the standard OAuth2 fields", () => {
    expect(body.access_token).toBe("access-jwt");
    expect(body.refresh_token).toBe("refresh-jwt");
    expect(body.token_type).toBe("Bearer");
    expect(body.scope).toBe("openid");
  });
});
