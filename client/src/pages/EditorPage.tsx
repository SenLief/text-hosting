import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { difference } from "../utils/diff";
import type { DocumentListResponse, DocumentView, UserTokenResponse } from "../../../src/types";

const CodeEditor = lazy(() => import("../components/CodeEditor"));

const defaultContent = "";

const extensionLanguageMap: Record<string, string> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".json": "json",
  ".py": "python",
  ".css": "css",
  ".html": "html",
  ".htm": "html",
  ".sql": "sql",
};

function detectLanguage(title: string, content: string): string {
  const loweredTitle = title.toLowerCase();
  const extensionMatch = loweredTitle.match(/\.([^.]+)$/);
  if (extensionMatch) {
    const ext = `.${extensionMatch[1]}`;
    if (extensionLanguageMap[ext]) {
      return extensionLanguageMap[ext];
    }
  }

  const trimmed = content.trim();
  if (!trimmed) return "plaintext";

  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch (error) {
      // fall through
    }
  }

  if (/^#\s.+$/m.test(trimmed)) {
    return "markdown";
  }

  if (/^(const|let|var|function|import|export)\s/.test(trimmed)) {
    return "javascript";
  }

  if (/class\s+\w+/.test(trimmed) || /def\s+\w+/.test(trimmed)) {
    return "python";
  }

  return "plaintext";
}

export function EditorPage() {
  const [documents, setDocuments] = useState<DocumentView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initialToken] = useState<string | null>(() =>
    typeof window === "undefined" ? null : localStorage.getItem("txt-hosted-token")
  );
  const [authToken, setAuthToken] = useState<string | null>(initialToken);
  const [viewScope, setViewScope] = useState<"public" | "mine">(initialToken ? "mine" : "public");
  const [tokenInput, setTokenInput] = useState(initialToken ?? "");
  const [isProcessingToken, setIsProcessingToken] = useState(false);
  const [title, setTitle] = useState("Untitled");
  const [content, setContent] = useState(defaultContent);
  const [latestPersistedContent, setLatestPersistedContent] = useState(defaultContent);
  const [viewVersionContent, setViewVersionContent] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<DocumentView | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [language, setLanguage] = useState<string>(detectLanguage("Untitled", defaultContent));
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [generatedToken, setGeneratedToken] = useState<string | null>(initialToken);

  const refreshDocuments = useCallback(async () => {
    try {
      const endpoint = viewScope === "mine" && authToken
        ? "/api/documents?limit=100&scope=mine"
        : "/api/documents?limit=100";
      const res = await fetch(endpoint, {
        headers: authToken ? { "x-user-token": authToken } : undefined,
      });
      if (!res.ok) throw new Error("fetch failed");
      const data: DocumentListResponse = await res.json();
      setDocuments(data.documents);
      return data.documents;
    } catch (error) {
      setStatus("Failed to load documents");
      return [] as DocumentView[];
    }
  }, [authToken, viewScope]);

  const resetEditorState = useCallback((nextTitle: string = "Untitled") => {
    setTitle(nextTitle);
    setContent(defaultContent);
    setMetadata(null);
    setSelectedVersion(null);
    setDiffText("");
    setLatestPersistedContent(defaultContent);
    setViewVersionContent(null);
    setLanguage(detectLanguage(nextTitle, defaultContent));
  }, []);

  const loadDocument = useCallback(async (id: string) => {
    try {
      setStatus("Loading document...");
      const metaRes = await fetch(`/api/documents/${id}`, {
        headers: authToken ? { "x-user-token": authToken } : undefined,
      });
      if (!metaRes.ok) throw new Error("meta failed");
      const meta: DocumentView = await metaRes.json();
      const raw = await fetch(`/api/documents/${id}/raw`, {
        headers: authToken ? { "x-user-token": authToken } : undefined,
      }).then((res) => res.text());
      setMetadata(meta);
      setTitle(meta.title);
      setContent(raw);
      setSelectedVersion(meta.versions[0]?.versionId ?? null);
      setDiffText("");
      setLatestPersistedContent(raw);
      setViewVersionContent(null);
      setStatus("");
    } catch (error) {
      setStatus("Failed to load document");
    }
  }, [authToken]);

  useEffect(() => {
    (async () => {
      const docs = await refreshDocuments();
      setDocuments(docs);
      if (!docs.length) {
        setActiveId(null);
        resetEditorState();
        return;
      }
      setActiveId((current) => {
        if (!current) return docs[0].id;
        if (current.startsWith("draft-")) return docs[0].id;
        return current;
      });
    })();
  }, [refreshDocuments]);

  useEffect(() => {
    if (!activeId || activeId.startsWith("draft-")) return;
    loadDocument(activeId);
  }, [activeId, loadDocument]);

  useEffect(() => {
    if (!metadata || !selectedVersion || !metadata.versions.length) {
      setViewVersionContent(null);
      setDiffText("");
      return;
    }
    const latestVersion = metadata.versions[0];
    if (selectedVersion === latestVersion.versionId) {
      setViewVersionContent(null);
      setDiffText("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${metadata.id}/raw?versionId=${selectedVersion}`, {
          headers: authToken ? { "x-user-token": authToken } : undefined,
        });
        if (!res.ok) throw new Error("version download failed");
        const text = await res.text();
        if (!cancelled) {
          setViewVersionContent(text);
        }
      } catch (error) {
        if (!cancelled) {
          setStatus("Failed to load version");
          setViewVersionContent(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [metadata, selectedVersion]);

  useEffect(() => {
    if (!metadata || !selectedVersion || !metadata.versions.length) {
      setDiffText("");
      return;
    }
    const latestVersion = metadata.versions[0];
    if (selectedVersion === latestVersion.versionId || viewVersionContent === null) {
      setDiffText("");
      return;
    }
    setDiffText(difference(viewVersionContent, latestPersistedContent));
  }, [metadata, selectedVersion, viewVersionContent, latestPersistedContent]);

  useEffect(() => {
    setLanguage(detectLanguage(title, content));
  }, [title, content]);

  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim() || "Untitled";

    if (metadata && (!activeId || !activeId.startsWith("draft-"))) {
      if (!authToken) {
        setStatus("Token required to update documents");
        return;
      }
      setStatus("Updating...");
      try {
        const res = await fetch(`/api/documents/${metadata.id}`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "x-user-token": authToken,
          },
          body: JSON.stringify({ content, title: trimmedTitle }),
        });
        if (!res.ok) throw new Error("update failed");
        const data = await res.json();
        const nextMeta: DocumentView = data.metadata ?? data;
        setMetadata(nextMeta);
        setSelectedVersion(nextMeta.versions[0]?.versionId ?? null);
        setLatestPersistedContent(content);
        setViewVersionContent(null);
        setStatus("Updated");
        setActiveId(nextMeta.id);
        setDocuments((prev) => {
          const filtered = prev.filter((doc) => doc.id !== nextMeta.id);
          return [nextMeta, ...filtered];
        });
        await refreshDocuments();
      } catch (error) {
        setStatus("Failed to update");
      }
      return;
    }

    setStatus("Saving...");
    const payload = {
      title: trimmedTitle,
      content,
    };
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authToken ? { "x-user-token": authToken } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("save failed");
      const data = await res.json();
      const meta: DocumentView = data.metadata ?? data;
      setMetadata(meta);
      setSelectedVersion(meta.versions[0]?.versionId ?? null);
      setLatestPersistedContent(content);
      setViewVersionContent(null);
      setStatus("Saved");
      setActiveId(meta.id);
      setDocuments((prev) => {
        const filtered = prev.filter((doc) => doc.id !== meta.id);
        return [meta, ...filtered];
      });
      if (meta.isPrivate && viewScope !== "mine") {
        setViewScope("mine");
      } else {
        await refreshDocuments();
      }
    } catch (error) {
      setStatus("Failed to save");
    }
  }, [activeId, authToken, content, metadata, refreshDocuments, title, viewScope]);

  const handleNewDocument = useCallback(() => {
    const placeholderId = `draft-${Date.now()}`;
    const nextTitle = title.trim() || "Untitled";
    resetEditorState(nextTitle);
    setLatestPersistedContent(defaultContent);
    setViewVersionContent(null);
    setStatus("Creating new document");
    setDocuments((prev) => {
      const filtered = prev.filter((doc) => !doc.id.startsWith("draft-"));
      const placeholder: DocumentView = {
        id: placeholderId,
        title: nextTitle,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        size: 0,
        versions: [],
        isOwner: Boolean(authToken),
        isPrivate: Boolean(authToken),
      };
      return [placeholder, ...filtered];
    });
    setActiveId(placeholderId);
    setIsSidebarOpen(true);
  }, [authToken, resetEditorState, title]);


  const handleDelete = useCallback(async () => {
    if (!metadata || !authToken) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this document?")) {
      return;
    }

    setStatus("Deleting...");
    const idToDelete = metadata.id;
    try {
      const res = await fetch(`/api/documents/${metadata.id}`, {
        method: "DELETE",
        headers: { "x-user-token": authToken },
      });
      if (!res.ok) throw new Error("delete failed");
      setStatus("Document deleted");
      setMetadata(null);
      setActiveId(null);
      resetEditorState();
      setDocuments((prev) => prev.filter((doc) => doc.id !== idToDelete));
      await refreshDocuments();
    } catch (error) {
      setStatus("Failed to delete");
    }
  }, [authToken, metadata, refreshDocuments, resetEditorState]);

  const latestVersionId = metadata?.versions[0]?.versionId ?? null;

  const latestRawUrl = useMemo(() => {
    if (!metadata || !latestVersionId) return null;
    const url = new URL(`/api/documents/${metadata.id}/raw`, window.location.origin);
    url.searchParams.set("versionId", latestVersionId);
    if (metadata.rawAccessKey) {
      url.searchParams.set("rawKey", metadata.rawAccessKey);
    }
    return url.toString();
  }, [metadata, latestVersionId]);

  const currentRawUrl = useMemo(() => {
    if (!metadata || !selectedVersion) return null;
    const url = new URL(`/api/documents/${metadata.id}/raw`, window.location.origin);
    url.searchParams.set("versionId", selectedVersion);
    if (metadata.rawAccessKey) {
      url.searchParams.set("rawKey", metadata.rawAccessKey);
    }
    return url.toString();
  }, [metadata, selectedVersion]);

  return (
    <div className="layout">
      <header>
        <div className="top-bar">
          <h1>Text Hosting</h1>
          <div className="token-inline">
            <button
              className="token-button"
              disabled={isProcessingToken}
              onClick={() => {
                const value = window.prompt("Enter token", tokenInput);
                if (!value) return;
                const trimmed = value.trim();
                if (!trimmed) return;
                localStorage.setItem("txt-hosted-token", trimmed);
                setTokenInput(trimmed);
                setAuthToken(trimmed);
                setGeneratedToken(trimmed);
                setStatus("Token saved");
                resetEditorState();
                refreshDocuments();
              }}
            >
              {authToken ? "Update token" : "Add token"}
            </button>
            <button
              className="token-button"
              disabled={isProcessingToken}
              onClick={async () => {
                setIsProcessingToken(true);
                try {
                  const res = await fetch("/api/token", { method: "POST" });
                  if (!res.ok) throw new Error("token");
                  const data: UserTokenResponse = await res.json();
                  localStorage.setItem("txt-hosted-token", data.token);
                  setTokenInput(data.token);
                  setAuthToken(data.token);
                  setGeneratedToken(data.token);
                  setStatus("New token generated");
                  resetEditorState();
                  await refreshDocuments();
                } catch (error) {
                  setStatus("Failed to generate token");
                } finally {
                  setIsProcessingToken(false);
                }
              }}
            >
              Generate token
            </button>
            {authToken && (
              <button
                className="token-button"
                onClick={async () => {
                  localStorage.removeItem("txt-hosted-token");
                  setAuthToken(null);
                  setTokenInput("");
                  setGeneratedToken(null);
                  setViewScope("public");
                  setStatus("Token cleared");
                  resetEditorState();
                  await refreshDocuments();
                }}
              >
                Clear token
              </button>
            )}
            <button
              className="token-button secondary"
              onClick={() => {
                const url = new URL("/docs/index.html", window.location.origin);
                window.open(url.toString(), "_blank", "noopener,noreferrer");
              }}
            >
              使用指南
            </button>
            {generatedToken && (
              <div className="generated-token-display">
                <code>{generatedToken}</code>
                <button
                  className="token-button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(generatedToken);
                      setStatus("Token copied to clipboard");
                    } catch (error) {
                      setStatus("Copy failed");
                    }
                  }}
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="auth-bar">
          <div className="scope-toggle">
            <label>
              <input
                type="radio"
                value="public"
                checked={viewScope === "public"}
                onChange={() => {
                  setViewScope("public");
                  setActiveId(null);
                }}
              />
              Public
            </label>
            <label>
              <input
                type="radio"
                value="mine"
                checked={viewScope === "mine"}
                onChange={() => {
                  setViewScope("mine");
                  setActiveId(null);
                }}
                disabled={!authToken}
              />
              Mine
            </label>
          </div>
        </div>
        <div className="controls">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <button onClick={handleSave}>Save</button>
          <button onClick={handleNewDocument}>New</button>
          {metadata?.isOwner && (
            <button className="danger" onClick={handleDelete}>
              Delete
            </button>
          )}
          <button
            className="toggle-sidebar"
            onClick={() => setIsSidebarOpen((open) => !open)}
          >
            {isSidebarOpen ? "Hide list" : "Show list"}
          </button>
          <span className="status">{status}</span>
        </div>
      </header>
      <div className={`workspace ${isSidebarOpen ? "" : "collapsed"}`}>
        {isSidebarOpen && (
          <aside className="doc-list">
            <h2 className="docs-heading">Documents</h2>
            <ul>
              {documents.map((doc) => (
                <li key={doc.id}>
                  <button
                    className={doc.id === activeId ? "active" : ""}
                    onClick={() => setActiveId(doc.id)}
                  >
                    <span className="doc-title">{doc.title}</span>
                    <span className="doc-meta">{new Date(doc.updatedAt).toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
        <main className="main-panel">
          <section className="editor">
            {metadata && viewVersionContent !== null && (
              <div className="version-banner">
                <span>
                  Viewing version saved {new Date(
                    metadata.versions.find((v) => v.versionId === selectedVersion)!.createdAt
                  ).toLocaleString()}
                </span>
                <button
                  onClick={() =>
                    setSelectedVersion(metadata.versions[0]?.versionId ?? null)
                  }
                >
                  Back to latest
                </button>
              </div>
            )}
            <Suspense fallback={<div className="editor-loading">Loading editor…</div>}>
              <CodeEditor
                height="60vh"
                language={language}
                value={viewVersionContent ?? content}
                onChange={(value) => {
                  if (viewVersionContent !== null) return;
                  setContent(value ?? "");
                }}
                readOnly={viewVersionContent !== null}
              />
            </Suspense>
          </section>
          <section className="sidebar">
            {metadata ? (
              <>
                <h2>Versions</h2>
                <ul className="versions">
                  {metadata.versions.map((version, index) => (
                    <li key={version.versionId}>
                      <button
                        className={version.versionId === selectedVersion ? "active" : ""}
                        onClick={() => setSelectedVersion(version.versionId)}
                      >
                        <span>{new Date(version.createdAt).toLocaleString()}</span>
                        <span>{(version.size / 1024).toFixed(1)} KB{index === 0 ? " · latest" : ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="links">
                  {currentRawUrl && (
                    <>
                      <a href={currentRawUrl} target="_blank" rel="noreferrer">
                        View raw
                      </a>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(currentRawUrl);
                            setStatus("Copied raw URL");
                          } catch (error) {
                            setStatus("Copy failed");
                          }
                        }}
                      >
                        Copy raw URL
                      </button>
                    </>
                  )}
                  {latestRawUrl && (
                    <>
                      <a href={latestRawUrl} target="_blank" rel="noreferrer">
                        View latest
                      </a>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(latestRawUrl);
                            setStatus("Copied latest URL");
                          } catch (error) {
                            setStatus("Copy failed");
                          }
                        }}
                      >
                        Copy latest URL
                      </button>
                    </>
                  )}
                </div>
                {diffText && <pre className="diff">{diffText}</pre>}
              </>
            ) : (
              <p>Select or save a document to see versions.</p>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
