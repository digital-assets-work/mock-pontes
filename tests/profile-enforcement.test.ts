/**
 * Tests for profile/client_id enforcement in mock-pontes.
 *
 * Covers:
 * - Token endpoint rejects wrong client_id for profile
 * - EXTERNAL_USER requires client_secret
 * - Route-level authorization rejects wrong profile
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  validateClientIdForProfile,
  CLIENT_ID_BACKEND_SERVICE,
  CLIENT_ID_WEB_APP,
  BRIDGE_1STEP_PROFILES,
  DRAFT_APPROVE_PROFILES,
} from "../src/auth/profile-enforcement.js";

describe("Profile Enforcement Helper", () => {
  describe("validateClientIdForProfile", () => {
    describe("EXTERNAL_USER", () => {
      it("accepts correct client_id and client_secret", () => {
        const result = validateClientIdForProfile(
          "EXTERNAL_USER",
          CLIENT_ID_BACKEND_SERVICE,
          CLIENT_ID_BACKEND_SERVICE,
        );
        expect(result.valid).toBe(true);
      });

      it("rejects wrong client_id", () => {
        const result = validateClientIdForProfile(
          "EXTERNAL_USER",
          CLIENT_ID_WEB_APP,
          CLIENT_ID_BACKEND_SERVICE,
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain("client_id");
      });

      it("rejects missing client_secret", () => {
        const result = validateClientIdForProfile(
          "EXTERNAL_USER",
          CLIENT_ID_BACKEND_SERVICE,
          null,
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain("client_secret");
      });

      it("rejects wrong client_secret", () => {
        const result = validateClientIdForProfile(
          "EXTERNAL_USER",
          CLIENT_ID_BACKEND_SERVICE,
          "wrong-secret",
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain("client_secret");
      });
    });

    describe("PILOT_READ_WRITE", () => {
      it("accepts correct client_id (no secret needed)", () => {
        const result = validateClientIdForProfile(
          "PILOT_READ_WRITE",
          CLIENT_ID_WEB_APP,
        );
        expect(result.valid).toBe(true);
      });

      it("rejects wrong client_id", () => {
        const result = validateClientIdForProfile(
          "PILOT_READ_WRITE",
          CLIENT_ID_BACKEND_SERVICE,
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain("client_id");
      });
    });

    describe("PILOT_READ_ONLY", () => {
      it("accepts correct client_id", () => {
        const result = validateClientIdForProfile(
          "PILOT_READ_ONLY",
          CLIENT_ID_WEB_APP,
        );
        expect(result.valid).toBe(true);
      });

      it("rejects wrong client_id", () => {
        const result = validateClientIdForProfile(
          "PILOT_READ_ONLY",
          CLIENT_ID_BACKEND_SERVICE,
        );
        expect(result.valid).toBe(false);
      });
    });

    describe("REFERENTIAL_READ_ONLY", () => {
      it("accepts correct client_id", () => {
        const result = validateClientIdForProfile(
          "REFERENTIAL_READ_ONLY",
          CLIENT_ID_WEB_APP,
        );
        expect(result.valid).toBe(true);
      });
    });

    describe("REFERENTIAL_READ_WRITE", () => {
      it("accepts correct client_id", () => {
        const result = validateClientIdForProfile(
          "REFERENTIAL_READ_WRITE",
          CLIENT_ID_WEB_APP,
        );
        expect(result.valid).toBe(true);
      });
    });

    describe("Unknown profile", () => {
      it("allows any client_id (lenient for unknown profiles)", () => {
        const result = validateClientIdForProfile(
          "SOME_FUTURE_PROFILE",
          "any-client",
        );
        expect(result.valid).toBe(true);
      });
    });
  });

  describe("Profile sets", () => {
    it("BRIDGE_1STEP_PROFILES contains EXTERNAL_USER", () => {
      expect(BRIDGE_1STEP_PROFILES.has("EXTERNAL_USER")).toBe(true);
      expect(BRIDGE_1STEP_PROFILES.has("PILOT_READ_WRITE")).toBe(false);
    });

    it("DRAFT_APPROVE_PROFILES contains PILOT_READ_WRITE", () => {
      expect(DRAFT_APPROVE_PROFILES.has("PILOT_READ_WRITE")).toBe(true);
      expect(DRAFT_APPROVE_PROFILES.has("EXTERNAL_USER")).toBe(false);
    });
  });
});
