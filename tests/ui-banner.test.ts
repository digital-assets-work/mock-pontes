/**
 * Control-panel banner wording (issue #78): reflects whether the mock is on a
 * public DNS host and whether the admin surface requires ADMIN_TOKEN.
 */

import { describe, it, expect } from "@jest/globals";
import { hostIsPublic, controlPanelBanner } from "../src/ui/router.js";

describe("hostIsPublic (issue #78)", () => {
  it("treats real dotted DNS names as public", () => {
    expect(hostIsPublic("mock.integration.pontes.ca-dag.work", false)).toBe(true);
    expect(hostIsPublic("example.com", false)).toBe(true);
  });
  it("treats localhost / *.local / loopback / bare IPs as non-public", () => {
    expect(hostIsPublic("localhost", false)).toBe(false);
    expect(hostIsPublic("myhost.local", false)).toBe(false);
    expect(hostIsPublic("127.0.0.1", false)).toBe(false);
    expect(hostIsPublic("0.0.0.0", false)).toBe(false);
    expect(hostIsPublic("192.168.1.10", false)).toBe(false);
    expect(hostIsPublic("::1", false)).toBe(false);
    expect(hostIsPublic("", false)).toBe(false);
    expect(hostIsPublic(undefined, false)).toBe(false);
  });
  it("is public when a public external URL is configured, regardless of host", () => {
    expect(hostIsPublic("localhost", true)).toBe(true);
  });
});

describe("controlPanelBanner (issue #78)", () => {
  it("public + admin-token set", () => {
    expect(controlPanelBanner(true, true)).toEqual({
      MOCK_SCOPE_LABEL: "Shared public mock of the ECB Pontes A2A API.",
      ADMIN_AUTH_LABEL: "Admin endpoint requires the secret ADMIN_TOKEN in authorisation header.",
    });
  });
  it("local + admin-token unset", () => {
    expect(controlPanelBanner(false, false)).toEqual({
      MOCK_SCOPE_LABEL: "Local mock of the ECB Pontes A2A API.",
      ADMIN_AUTH_LABEL: "Admin endpoint requires no authentication (Dev deployment).",
    });
  });
  it("public + admin-token unset (dev deployment on a public host)", () => {
    const b = controlPanelBanner(true, false);
    expect(b.MOCK_SCOPE_LABEL).toMatch(/Shared public/);
    expect(b.ADMIN_AUTH_LABEL).toMatch(/no authentication \(Dev deployment\)/);
  });
});
