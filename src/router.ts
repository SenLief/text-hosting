import { Hono } from "hono";
import { nanoid } from "nanoid";
import { DocumentStore } from "./storage";
import { badRequest, entityTooLarge, forbidden, notFound } from "./errors";
import { jsonResponse, parseJsonRequest, getHeaderToken, getRawUrl } from "./utils";
import { createShareToken, verifyShareToken } from "./auth";
import {
  CreateDocumentRequest,
  DocumentListResponse,
  UpdateDocumentRequest,
  UserTokenResponse,
} from "./types";

export interface Env {
  TEXT_KV: KVNamespace;
  MAX_FILE_SIZE: string;
  SHARE_SECRET?: string;
}

const app = new Hono<{ Bindings: Env; Variables: { store: DocumentStore } }>();

app.use("*", async (c, next) => {
  const store = new DocumentStore(c.env.TEXT_KV, Number(c.env.MAX_FILE_SIZE));
  c.set("store", store);
  await next();
});

app.post("/api/token", async (c) => {
  const token = nanoid(24);
  return jsonResponse({ token });
});

app.post("/api/documents", async (c) => {
  const store = c.get("store");
  const ownerToken = getHeaderToken(c.req.raw);

  const body = await parseJsonRequest<CreateDocumentRequest>(c.req.raw);

  if (!body.title?.trim() || typeof body.content !== "string") {
    throw badRequest("title and content required");
  }

  try {
    const result = await store.createDocument({
      title: body.title,
      content: body.content,
      ownerToken,
    });
    return jsonResponse(result);
  } catch (error) {
    if (error instanceof Error && error.message === "FILE_TOO_LARGE") {
      throw entityTooLarge("file exceeds size limit");
    }
    throw error;
  }
});

app.get("/api/documents", async (c) => {
  const store = c.get("store");
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 20, 1), 50);
  const cursor = c.req.query("cursor") ?? undefined;
  const ownerToken = getHeaderToken(c.req.raw);

  if (ownerToken && c.req.query("scope") === "mine") {
    const result = await store.listOwnerDocuments(ownerToken, limit, cursor);
    return jsonResponse<DocumentListResponse>(result);
  }

  const result = await store.listPublicDocuments(ownerToken, limit, cursor);
  return jsonResponse<DocumentListResponse>(result);
});

app.put("/api/documents/:id", async (c) => {
  const store = c.get("store");
  const { id } = c.req.param();
  const ownerToken = getHeaderToken(c.req.raw);

  const body = await parseJsonRequest<UpdateDocumentRequest>(c.req.raw);

  if (typeof body.content !== "string") {
    throw badRequest("content is required");
  }

  try {
    const result = await store.updateDocument(id, {
      content: body.content,
      ownerToken,
    });
    return jsonResponse(result);
  } catch (error) {
    if (error instanceof Error && error.message === "FILE_TOO_LARGE") {
      throw entityTooLarge("file exceeds size limit");
    }
    if (error instanceof Error && error.message === "NOT_FOUND") {
      throw notFound();
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      throw forbidden();
    }
    throw error;
  }
});

app.delete("/api/documents/:id", async (c) => {
  const store = c.get("store");
  const { id } = c.req.param();
  const ownerToken = getHeaderToken(c.req.raw);

  if (!ownerToken) {
    throw forbidden("owner token required");
  }

  try {
    await store.deleteDocument(id, ownerToken);
    return jsonResponse({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      throw notFound();
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      throw forbidden("owner token required");
    }
    throw error;
  }
});

app.get("/api/documents/:id", async (c) => {
  const store = c.get("store");
  const { id } = c.req.param();
  const viewerToken = getHeaderToken(c.req.raw);
  const document = await store.getDocument(id, viewerToken);
  if (!document) throw notFound();

  if (!document.isOwner && document.isPrivate) {
    throw forbidden("owner token required");
  }

  return jsonResponse(document);
});

app.get("/api/documents/:id/version", async (c) => {
  const store = c.get("store");
  const { id } = c.req.param();
  const versionId = c.req.query("versionId");
  if (!versionId) throw badRequest("versionId required");
  const viewerToken = getHeaderToken(c.req.raw);
  const document = await store.getDocument(id, viewerToken);
  if (!document) throw notFound();

  if (!document.isOwner && document.isPrivate) {
    throw forbidden("owner token required");
  }

  const version = await store.getVersion(id, versionId);
  if (!version) throw notFound();
  return jsonResponse(version);
});

app.get("/api/documents/:id/raw", async (c) => {
  const store = c.get("store");
  const { id } = c.req.param();
  const versionId = c.req.query("versionId");
  const rawKey = c.req.query("rawKey");
  const viewerToken = getHeaderToken(c.req.raw);
  const document = await store.getDocument(id, viewerToken);
  if (!document) throw notFound();

  if (!document.isOwner && document.isPrivate) {
    if (!rawKey || !document.rawAccessKey || rawKey !== document.rawAccessKey) {
      throw forbidden("owner token required");
    }
  }

  let version = document.versions[0];
  if (versionId) {
    const found = document.versions.find((v) => v.versionId === versionId);
    if (!found) throw notFound();
    version = found;
  }

  const fullVersion = await store.getVersion(id, version.versionId);
  if (!fullVersion) throw notFound();

  return new Response(fullVersion.content, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `inline; filename="${document.title}.txt"`,
    },
  });
});

app.post("/api/documents/:id/share", async (c) => {
  const store = c.get("store");
  const { id } = c.req.param();
  const viewerToken = getHeaderToken(c.req.raw);
  const document = await store.getDocument(id, viewerToken);
  if (!document) throw notFound();

  if (!document.isOwner) throw forbidden("owner token required");

  const body = await parseJsonRequest<{ expiresInMinutes?: number }>(c.req.raw);
  const expiresIn = Math.min(Math.max(body.expiresInMinutes ?? 60, 1), 60 * 24 * 7);
  const secret = c.env.SHARE_SECRET ?? "default-secret";
  const payload = {
    documentId: id,
    expiresAt: Date.now() + expiresIn * 60 * 1000,
  };
  const token = await createShareToken(payload, secret);
  const baseUrl = new URL(c.req.url);
  const latestVersion = document.versions[0];
  const shareUrl = getRawUrl(baseUrl, id, latestVersion.versionId, token);
  return jsonResponse({ token, shareUrl, expiresAt: payload.expiresAt });
});

app.get("/api/share", async (c) => {
  const token = c.req.query("token");
  if (!token) throw badRequest("token required");
  const secret = c.env.SHARE_SECRET ?? "default-secret";
  const payload = await verifyShareToken(token, secret);
  if (!payload) throw badRequest("invalid token");

  const store = c.get("store");
  const document = await store.getDocument(payload.documentId);
  if (!document) throw notFound();

  if (document.isPrivate) {
    throw forbidden("owner token required");
  }

  return jsonResponse(document);
});

export { app };
