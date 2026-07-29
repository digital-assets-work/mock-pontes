/**
 * Release-version resolution (issue #98): a plain `node dist/index.js` (no git
 * ref, no `npm run`) must report the real package version rather than `dev`.
 */

import { describe, it, expect, afterEach } from "@jest/globals";
import { mockVersion } from "../src/version.js";
import pkg from "../package.json";

const savedRef = process.env.PUBLIC_GIT_REF_NAME;
const savedNpm = process.env.npm_package_version;

afterEach(() => {
  if (savedRef === undefined) delete process.env.PUBLIC_GIT_REF_NAME;
  else process.env.PUBLIC_GIT_REF_NAME = savedRef;
  if (savedNpm === undefined) delete process.env.npm_package_version;
  else process.env.npm_package_version = savedNpm;
});

describe("mockVersion (issue #98)", () => {
  it("falls back to the package.json version when no git ref / npm env is set", () => {
    delete process.env.PUBLIC_GIT_REF_NAME;
    delete process.env.npm_package_version;
    expect(mockVersion()).toBe((pkg as { version: string }).version);
    expect(mockVersion()).not.toBe("dev");
  });

  it("prefers the baked git ref (stripping a leading v)", () => {
    process.env.PUBLIC_GIT_REF_NAME = "v9.9.9";
    expect(mockVersion()).toBe("9.9.9");
  });

  it("ignores the placeholder ref and uses npm_package_version next", () => {
    process.env.PUBLIC_GIT_REF_NAME = "no_ref_name";
    process.env.npm_package_version = "2.3.4";
    expect(mockVersion()).toBe("2.3.4");
  });
});
