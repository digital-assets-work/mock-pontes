/**
 * In-memory auth users repository (issue #83 — close the coverage gap on the
 * enrolment/user layer, which the review flagged at ~10%).
 */

import { describe, it, expect } from "@jest/globals";
import { createInMemoryAuthUsersRepository } from "../src/auth/users-repository.js";

function repo() {
  return createInMemoryAuthUsersRepository();
}

function declare(r: ReturnType<typeof repo>, username = "PUSER0001") {
  return r.createDeclaredUser({ username, profile: "PILOT_READ_WRITE", entityBIC: "BSUIFRPPXXX" });
}

describe("InMemoryAuthUsersRepository (issue #83)", () => {
  it("declares a user with a uuid and timestamps", () => {
    const r = repo();
    const u = declare(r);
    expect(u.username).toBe("PUSER0001");
    expect(u.uuid).toMatch(/[0-9a-f-]{36}/);
    expect(u.profile).toBe("PILOT_READ_WRITE");
    expect(r.getUserByUsername("PUSER0001")?.uuid).toBe(u.uuid);
  });

  it("rejects declaring the same username twice", () => {
    const r = repo();
    declare(r);
    expect(() => declare(r)).toThrow(/USER_ALREADY_EXISTS/);
  });

  it("updates profile/entity metadata without clobbering unset fields", () => {
    const r = repo();
    declare(r);
    const upd = r.updateUserMetadata("PUSER0001", { profile: "EXTERNAL_USER" });
    expect(upd.profile).toBe("EXTERNAL_USER");
    expect(upd.entityBIC).toBe("BSUIFRPPXXX"); // unchanged
    expect(() => r.updateUserMetadata("ghost", { profile: "X" })).toThrow(/USER_NOT_FOUND/);
  });

  it("binds a certificate + fingerprint both ways", () => {
    const r = repo();
    declare(r);
    r.setUserCertificate("PUSER0001", "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----", "fp-aaa");
    expect(r.getFingerprintByUsername("PUSER0001")).toBe("fp-aaa");
    expect(r.getUsernameByFingerprint("fp-aaa")).toBe("PUSER0001");
    expect(r.getCertificateByUsername("PUSER0001")).toMatch(/BEGIN CERTIFICATE/);
  });

  it("rotates the fingerprint mapping when a user re-enrols a new cert", () => {
    const r = repo();
    declare(r);
    r.setUserCertificate("PUSER0001", "certA", "fp-a");
    r.setUserCertificate("PUSER0001", "certB", "fp-b");
    expect(r.getUsernameByFingerprint("fp-a")).toBeUndefined(); // old mapping dropped
    expect(r.getUsernameByFingerprint("fp-b")).toBe("PUSER0001");
    expect(r.getFingerprintByUsername("PUSER0001")).toBe("fp-b");
  });

  it("rejects mapping a fingerprint already bound to another user", () => {
    const r = repo();
    declare(r, "PUSER0001");
    declare(r, "PUSER0002");
    r.setUserCertificate("PUSER0001", "certA", "fp-shared");
    expect(() => r.setUserCertificate("PUSER0002", "certB", "fp-shared")).toThrow(/FINGERPRINT_ALREADY_MAPPED/);
  });

  it("throws setting a certificate for an unknown user", () => {
    const r = repo();
    expect(() => r.setUserCertificate("ghost", "cert", "fp")).toThrow(/USER_NOT_FOUND/);
  });

  it("lists only enrolled (cert-bearing) users, sorted", () => {
    const r = repo();
    declare(r, "PUSER0002");
    declare(r, "PUSER0001");
    declare(r, "PUSER0003"); // no cert → excluded
    r.setUserCertificate("PUSER0002", "certB", "fp-2");
    r.setUserCertificate("PUSER0001", "certA", "fp-1");
    const list = r.listEnrolledUsers();
    expect(list.map((u) => u.username)).toEqual(["PUSER0001", "PUSER0002"]);
    expect(list[0]).toMatchObject({ profile: "PILOT_READ_WRITE", entityBIC: "BSUIFRPPXXX", hasCertificate: true });
    expect(r.getAllUsers()).toHaveLength(3);
  });

  it("fully deletes a user, freeing its username and fingerprint", () => {
    const r = repo();
    declare(r, "PUSER0001");
    r.setUserCertificate("PUSER0001", "certA", "fp-a");
    expect(r.deleteUser("PUSER0001")).toBe(true);
    expect(r.getUserByUsername("PUSER0001")).toBeUndefined();
    expect(r.getUsernameByFingerprint("fp-a")).toBeUndefined();
    // the username is now free to be declared again, as a brand-new record.
    const redeclared = declare(r, "PUSER0001");
    expect(redeclared.username).toBe("PUSER0001");
    expect(redeclared.certificateFingerprint).toBeUndefined();
  });

  it("deleting an unknown username is a no-op", () => {
    const r = repo();
    expect(r.deleteUser("ghost")).toBe(false);
  });
});
