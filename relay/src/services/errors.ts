/**
 * Service-layer error types shared across services. Controllers pattern-match
 * these to map domain failures to HTTP status codes without importing the
 * underlying client libraries.
 */

export class JupiterUnavailableError extends Error {
  constructor(cause: Error) {
    super(`jupiter_unavailable: ${cause.message}`);
    this.name = "JupiterUnavailableError";
    this.cause = cause;
  }
}

export class HeliusUnavailableError extends Error {
  constructor(cause: Error) {
    super(`helius_unavailable: ${cause.message}`);
    this.name = "HeliusUnavailableError";
    this.cause = cause;
  }
}
