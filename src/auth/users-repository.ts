import { randomUUID } from "node:crypto";
import type { CacheInterface } from "../cache/index.js";
import { fatalPersistError } from "../cache/index.js";

export interface AuthUserRecord {
  username: string;
  uuid: string;
  profile: string;
  entityBIC: string;
  certificatePem?: string;
  certificateFingerprint?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeclaredUserInput {
  username: string;
  profile: string;
  entityBIC: string;
}

export interface InMemoryAuthUsersRepository {
  createDeclaredUser(input: DeclaredUserInput): AuthUserRecord;
  getUserByUsername(username: string): AuthUserRecord | undefined;
  /**
   * Fully remove a user (no trace of username/profile/entityBIC/uuid/cert kept).
   * Also frees its certificate fingerprint mapping. Returns whether a user was
   * actually removed (issue #100 — admin-gated re-enrollment control).
   */
  deleteUser(username: string): boolean;
  updateUserMetadata(
    username: string,
    updates: { profile?: string; entityBIC?: string },
  ): AuthUserRecord;
  setUserCertificate(username: string, certificatePem: string, certificateFingerprint: string): void;
  getUsernameByFingerprint(fingerprint: string): string | undefined;
  getFingerprintByUsername(username: string): string | undefined;
  getCertificateByUsername(username: string): string | undefined;
  getAllUsers(): AuthUserRecord[];
  listEnrolledUsers(): Array<{
    username: string;
    profile: string;
    entityBIC: string;
    createdAt: string;
    certificateFingerprint: string;
    hasCertificate: boolean;
  }>;
}

function normalizeKey(value: string): string {
  return value.trim();
}

export function createInMemoryAuthUsersRepository(): InMemoryAuthUsersRepository {
  const usersByUsername = new Map<string, AuthUserRecord>();
  const usernameByFingerprint = new Map<string, string>();

  function createDeclaredUser(input: DeclaredUserInput): AuthUserRecord {
    const username = normalizeKey(input.username);
    if (usersByUsername.has(username)) {
      throw new Error("USER_ALREADY_EXISTS");
    }

    const now = new Date().toISOString();
    const created: AuthUserRecord = {
      username,
      uuid: randomUUID(),
      profile: input.profile,
      entityBIC: input.entityBIC,
      createdAt: now,
      updatedAt: now,
    };

    usersByUsername.set(username, created);
    return created;
  }

  function getUserByUsername(username: string): AuthUserRecord | undefined {
    return usersByUsername.get(normalizeKey(username));
  }

  function deleteUser(username: string): boolean {
    const normalizedUsername = normalizeKey(username);
    const user = usersByUsername.get(normalizedUsername);
    if (!user) return false;
    if (user.certificateFingerprint) {
      usernameByFingerprint.delete(user.certificateFingerprint);
    }
    usersByUsername.delete(normalizedUsername);
    return true;
  }

  function updateUserMetadata(
    username: string,
    updates: { profile?: string; entityBIC?: string },
  ): AuthUserRecord {
    const normalizedUsername = normalizeKey(username);
    const user = usersByUsername.get(normalizedUsername);
    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const nextProfile = updates.profile?.trim();
    const nextEntityBic = updates.entityBIC?.trim();

    const updated: AuthUserRecord = {
      ...user,
      profile: nextProfile || user.profile,
      entityBIC: nextEntityBic || user.entityBIC,
      updatedAt: new Date().toISOString(),
    };

    usersByUsername.set(normalizedUsername, updated);
    return updated;
  }

  function setUserCertificate(
    username: string,
    certificatePem: string,
    certificateFingerprint: string,
  ): void {
    const normalizedUsername = normalizeKey(username);
    const user = usersByUsername.get(normalizedUsername);
    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const mappedUsername = usernameByFingerprint.get(certificateFingerprint);
    if (mappedUsername && mappedUsername !== normalizedUsername) {
      throw new Error("FINGERPRINT_ALREADY_MAPPED");
    }

    if (user.certificateFingerprint && user.certificateFingerprint !== certificateFingerprint) {
      usernameByFingerprint.delete(user.certificateFingerprint);
    }

    usernameByFingerprint.set(certificateFingerprint, normalizedUsername);
    usersByUsername.set(normalizedUsername, {
      ...user,
      certificatePem,
      certificateFingerprint,
      updatedAt: new Date().toISOString(),
    });
  }

  function getUsernameByFingerprint(fingerprint: string): string | undefined {
    return usernameByFingerprint.get(fingerprint);
  }

  function getFingerprintByUsername(username: string): string | undefined {
    return getUserByUsername(username)?.certificateFingerprint;
  }

  function getCertificateByUsername(username: string): string | undefined {
    return getUserByUsername(username)?.certificatePem;
  }

  function listEnrolledUsers(): Array<{
    username: string;
    profile: string;
    entityBIC: string;
    createdAt: string;
    certificateFingerprint: string;
    hasCertificate: boolean;
  }> {
    return Array.from(usersByUsername.values())
      .filter((user) => Boolean(user.certificateFingerprint))
      .sort((a, b) => a.username.localeCompare(b.username))
      .map((user) => ({
        username: user.username,
        profile: user.profile,
        entityBIC: user.entityBIC,
        createdAt: user.createdAt,
        certificateFingerprint: user.certificateFingerprint!,
        hasCertificate: Boolean(user.certificatePem),
      }));
  }

  function getAllUsers(): AuthUserRecord[] {
    return Array.from(usersByUsername.values());
  }

  return {
    createDeclaredUser,
    getUserByUsername,
    deleteUser,
    updateUserMetadata,
    setUserCertificate,
    getUsernameByFingerprint,
    getFingerprintByUsername,
    getCertificateByUsername,
    getAllUsers,
    listEnrolledUsers,
  };
}

// --- Redis-persisted variant ---

const USERS_CACHE_KEY = "enrolled-users-v1";

interface PersistedUsersData {
  users: AuthUserRecord[];
}

/**
 * Create an auth users repository backed by Redis persistence.
 * On startup, loads existing users from cache. On every mutation, persists the full state.
 */
export async function createPersistedAuthUsersRepository(
  cache: CacheInterface,
  onPersistError: (err: unknown) => void = fatalPersistError,
): Promise<InMemoryAuthUsersRepository> {
  const repo = createInMemoryAuthUsersRepository();

  // Load persisted state
  let loaded: PersistedUsersData | undefined;
  try {
    loaded = await cache.get<PersistedUsersData>(USERS_CACHE_KEY);
  } catch (err) {
    console.error("[mock-pontes] Failed to load persisted users from Redis:", err);
  }

  if (loaded?.users?.length) {
    for (const user of loaded.users) {
      try {
        repo.createDeclaredUser({
          username: user.username,
          profile: user.profile,
          entityBIC: user.entityBIC,
        });
        if (user.certificatePem && user.certificateFingerprint) {
          repo.setUserCertificate(user.username, user.certificatePem, user.certificateFingerprint);
        }
      } catch {
        // user already exists or other issue — skip
      }
    }
    console.log(`[mock-pontes] Restored ${loaded.users.length} enrolled user(s) from Redis`);
  }

  async function persistState(): Promise<void> {
    const allUsers = repo.getAllUsers();
    try {
      await cache.put<PersistedUsersData>(USERS_CACHE_KEY, { users: allUsers }, NaN);
    } catch (err) {
      // The cache layer already reconnected and retried once; a failure here
      // means the enrolment was not persisted, so stop (issue #46).
      onPersistError(err);
    }
  }

  // Wrap mutating methods to add persistence
  const originalCreateDeclaredUser = repo.createDeclaredUser;
  const originalSetUserCertificate = repo.setUserCertificate;
  const originalUpdateUserMetadata = repo.updateUserMetadata;
  const originalDeleteUser = repo.deleteUser;

  repo.createDeclaredUser = (input: DeclaredUserInput): AuthUserRecord => {
    const result = originalCreateDeclaredUser(input);
    persistState();
    return result;
  };

  repo.setUserCertificate = (username: string, certificatePem: string, certificateFingerprint: string): void => {
    originalSetUserCertificate(username, certificatePem, certificateFingerprint);
    persistState();
  };

  repo.updateUserMetadata = (username: string, updates: { profile?: string; entityBIC?: string }): AuthUserRecord => {
    const result = originalUpdateUserMetadata(username, updates);
    persistState();
    return result;
  };

  repo.deleteUser = (username: string): boolean => {
    const result = originalDeleteUser(username);
    if (result) persistState();
    return result;
  };

  return repo;
}