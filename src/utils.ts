import { badRequest } from "./errors";

export function jsonResponse<T>(data: T, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

export function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: message }, { status });
}

export async function parseJsonRequest<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    throw badRequest("application/json required");
  }
  try {
    return (await request.json()) as T;
  } catch (error) {
    throw badRequest("invalid JSON payload");
  }
}

export function getQueryParam(url: URL, key: string): string | null {
  const value = url.searchParams.get(key);
  return value ?? null;
}

export function getHeaderToken(request: Request): string | undefined {
  return request.headers.get("x-user-token") ?? undefined;
}

export function getRawUrl(
  baseUrl: URL,
  documentId: string,
  versionId: string,
  token?: string
): string {
  const url = new URL(`/api/documents/${documentId}/raw`, baseUrl);
  url.searchParams.set("versionId", versionId);
  if (token) {
    url.searchParams.set("token", token);
  }
  return url.toString();
}
