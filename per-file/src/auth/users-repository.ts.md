# src/auth/users-repository.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 59.55% (53/89) | `██████░░░░` |
| Branches | 64.52% (20/31) | `██████░░░░` |
| Functions | 71.43% (15/21) | `███████░░░` |
| Lines | 59.77% (52/87) | `██████░░░░` |

**Uncovered lines:** 209, 213, 217-218, 220, 223-226, 231-232, 238, 241-244, 248, 253-256, 258-261, 264-266, 269-272, 275-278, 281

**Partial branches:** L86 (if), L108 (binary-expr), L211 (default-arg)

**Never called:** `createPersistedAuthUsersRepository` (L209), `persistState` (L241), `(anonymous_17)` (L258), `(anonymous_18)` (L264), `(anonymous_19)` (L269), `(anonymous_20)` (L275)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   83 |     const normalizedUsername = normalizeKey(username);
   84 |     const user = usersByUsername.get(normalizedUsername);
   85 |     if (!user) return false;
!  86 |     if (user.certificateFingerprint) {
   87 |       usernameByFingerprint.delete(user.certificateFingerprint);
   88 |     }
   89 |     usersByUsername.delete(normalizedUsername);
  ⋮
  105 | 
  106 |     const updated: AuthUserRecord = {
  107 |       ...user,
! 108 |       profile: nextProfile || user.profile,
  109 |       entityBIC: nextEntityBic || user.entityBIC,
  110 |       updatedAt: new Date().toISOString(),
  111 |     };
  ⋮
  206 |  * Create an auth users repository backed by Redis persistence.
  207 |  * On startup, loads existing users from cache. On every mutation, persists the full state.
  208 |  */
- 209 | export async function createPersistedAuthUsersRepository(
  210 |   cache: CacheInterface,
! 211 |   onPersistError: (err: unknown) => void = fatalPersistError,
  212 | ): Promise<InMemoryAuthUsersRepository> {
- 213 |   const repo = createInMemoryAuthUsersRepository();
  214 | 
  215 |   // Load persisted state
  216 |   let loaded: PersistedUsersData | undefined;
- 217 |   try {
- 218 |     loaded = await cache.get<PersistedUsersData>(USERS_CACHE_KEY);
  219 |   } catch (err) {
- 220 |     console.error("[mock-pontes] Failed to load persisted users from Redis:", err);
  221 |   }
  222 | 
- 223 |   if (loaded?.users?.length) {
- 224 |     for (const user of loaded.users) {
- 225 |       try {
- 226 |         repo.createDeclaredUser({
  227 |           username: user.username,
  228 |           profile: user.profile,
  229 |           entityBIC: user.entityBIC,
  230 |         });
- 231 |         if (user.certificatePem && user.certificateFingerprint) {
- 232 |           repo.setUserCertificate(user.username, user.certificatePem, user.certificateFingerprint);
  233 |         }
  234 |       } catch {
  235 |         // user already exists or other issue — skip
  236 |       }
  237 |     }
- 238 |     console.log(`[mock-pontes] Restored ${loaded.users.length} enrolled user(s) from Redis`);
  239 |   }
  240 | 
- 241 |   async function persistState(): Promise<void> {
- 242 |     const allUsers = repo.getAllUsers();
- 243 |     try {
- 244 |       await cache.put<PersistedUsersData>(USERS_CACHE_KEY, { users: allUsers }, NaN);
  245 |     } catch (err) {
  246 |       // The cache layer already reconnected and retried once; a failure here
  247 |       // means the enrolment was not persisted, so stop (issue #46).
- 248 |       onPersistError(err);
  249 |     }
  250 |   }
  251 | 
  252 |   // Wrap mutating methods to add persistence
- 253 |   const originalCreateDeclaredUser = repo.createDeclaredUser;
- 254 |   const originalSetUserCertificate = repo.setUserCertificate;
- 255 |   const originalUpdateUserMetadata = repo.updateUserMetadata;
- 256 |   const originalDeleteUser = repo.deleteUser;
  257 | 
- 258 |   repo.createDeclaredUser = (input: DeclaredUserInput): AuthUserRecord => {
- 259 |     const result = originalCreateDeclaredUser(input);
- 260 |     persistState();
- 261 |     return result;
  262 |   };
  263 | 
- 264 |   repo.setUserCertificate = (username: string, certificatePem: string, certificateFingerprint: string): void => {
- 265 |     originalSetUserCertificate(username, certificatePem, certificateFingerprint);
- 266 |     persistState();
  267 |   };
  268 | 
- 269 |   repo.updateUserMetadata = (username: string, updates: { profile?: string; entityBIC?: string }): AuthUserRecord => {
- 270 |     const result = originalUpdateUserMetadata(username, updates);
- 271 |     persistState();
- 272 |     return result;
  273 |   };
  274 | 
- 275 |   repo.deleteUser = (username: string): boolean => {
- 276 |     const result = originalDeleteUser(username);
- 277 |     if (result) persistState();
- 278 |     return result;
  279 |   };
  280 | 
- 281 |   return repo;
  282 | }
```
