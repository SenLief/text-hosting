export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function notFound(message = "Not found"): HttpError {
  return new HttpError(404, message);
}

export function badRequest(message = "Bad request"): HttpError {
  return new HttpError(400, message);
}

export function unauthorized(message = "Unauthorized"): HttpError {
  return new HttpError(401, message);
}

export function forbidden(message = "Forbidden"): HttpError {
  return new HttpError(403, message);
}

export function entityTooLarge(message = "Payload too large"): HttpError {
  return new HttpError(413, message);
}
