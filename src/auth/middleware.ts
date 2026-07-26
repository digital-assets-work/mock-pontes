import { defineEventHandler, setResponseStatus } from "h3";
import type { InMemoryAuthUsersRepository } from "./users-repository.js";

export function createMtlsConsistencyMiddleware(
  authUsersRepository: InMemoryAuthUsersRepository,
) {
  return defineEventHandler((event) => {
    const username = event.context?.auth?.username;
    if (!username) return;

    const fingerprint = event.context.mtlsCertFingerprint;
    const certValid = event.context.mtlsCertValid;

    if (!fingerprint || !certValid) {
      setResponseStatus(event, 401);
      return {
        error: "invalid_client",
        error_description: "Valid client certificate required for authenticated calls",
      };
    }

    const expectedFingerprint = authUsersRepository.getFingerprintByUsername(username);
    const mappedUser = authUsersRepository.getUsernameByFingerprint(fingerprint);

    if (!expectedFingerprint || !mappedUser) {
      setResponseStatus(event, 401);
      return {
        error: "invalid_client",
        error_description: "No certificate association found for user. Acquire a token with mTLS first.",
      };
    }

    if (expectedFingerprint !== fingerprint || mappedUser !== username) {
      setResponseStatus(event, 401);
      return {
        error: "invalid_client",
        error_description: "Authenticated user certificate mismatch",
      };
    }
  });
}