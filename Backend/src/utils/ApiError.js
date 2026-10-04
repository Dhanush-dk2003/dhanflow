export class ApiError extends Error {
  /** `extra` fields are merged into the JSON error body (e.g. `code`, `retryAfter`). */
  constructor(status, message, extra = undefined) {
    super(message);
    this.status = status;
    this.extra = extra;
  }

  static badRequest(message) {
    return new ApiError(400, message);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }

  static conflict(message) {
    return new ApiError(409, message);
  }
}
