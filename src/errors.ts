export type NususErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "ABORTED";

export class NususError extends Error {
  readonly code: NususErrorCode;
  readonly status?: number;
  readonly url?: string;
  readonly retryAfter?: number;

  constructor(
    code: NususErrorCode,
    message: string,
    options: {
      status?: number;
      url?: string;
      retryAfter?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "NususError";
    this.code = code;
    this.status = options.status;
    this.url = options.url;
    this.retryAfter = options.retryAfter;
  }
}
