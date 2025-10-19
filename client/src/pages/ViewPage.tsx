import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { difference } from "../utils/diff";
import type { DocumentView } from "../../../src/types";

interface Props {
  params: { id: string };
}

export function ViewPage({ params }: Props) {
  const [metadata, setMetadata] = useState<DocumentView | null>(null);
  const [content, setContent] = useState("");
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [diffText, setDiffText] = useState("");
  const [error, setError] = useState("");
  const [versionToken, setVersionToken] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const token = localStorage.getItem("txt-hosted-token");
        const res = await fetch(`/api/documents/${params.id}`, {
          headers: token ? { "x-user-token": token } : undefined,
        });
        if (!res.ok) {
          setError("Unable to load document");
          return;
        }
        const data = await res.json();
        setMetadata(data);
        if (data.versions.length) {
          const url = new URL(`/api/documents/${params.id}/raw`, window.location.origin);
          url.searchParams.set("versionId", data.versions[0].versionId);
          if (data.rawAccessKey) {
            url.searchParams.set("rawKey", data.rawAccessKey);
          }
          const raw = await fetch(url, {
            headers: token ? { "x-user-token": token } : undefined,
          }).then((r) => r.text());
          setContent(raw);
        } else {
          setContent("");
        }
        if (data.versions.length) {
          setSelectedVersion(data.versions[0].versionId);
        }
      } catch (err) {
        console.error(err);
        setError("Unexpected error");
      }
    };
    load();
  }, [params.id]);

  useEffect(() => {
    if (!metadata || !selectedVersion) {
      setDiffText("");
      return;
    }
    const version = metadata.versions.find((v) => v.versionId === selectedVersion);
    if (!version) return;
    const loadDiff = async () => {
      const token = localStorage.getItem("txt-hosted-token");
      const url = new URL(`/api/documents/${params.id}/raw`, window.location.origin);
      url.searchParams.set("versionId", version.versionId);
      if (metadata.rawAccessKey) {
        url.searchParams.set("rawKey", metadata.rawAccessKey);
      }
      if (versionToken) {
        url.searchParams.set("token", versionToken);
      }
      const selected = await fetch(url, {
        headers: token ? { "x-user-token": token } : undefined,
      }).then((r) => r.text());
      setDiffText(difference(selected, content));
    };
    loadDiff();
  }, [content, metadata, params.id, selectedVersion, versionToken]);

  const latestVersionId = metadata?.versions[0]?.versionId ?? null;

  const currentRawUrl = useMemo(() => {
    if (!metadata || !selectedVersion) return null;
    const url = new URL(`/api/documents/${params.id}/raw`, window.location.origin);
    url.searchParams.set("versionId", selectedVersion);
    if (metadata.rawAccessKey) {
      url.searchParams.set("rawKey", metadata.rawAccessKey);
    }
    return url.toString();
  }, [metadata, params.id, selectedVersion]);

  const latestRawUrl = useMemo(() => {
    if (!metadata || !latestVersionId) return null;
    const url = new URL(`/api/documents/${params.id}/raw`, window.location.origin);
    url.searchParams.set("versionId", latestVersionId);
    if (metadata.rawAccessKey) {
      url.searchParams.set("rawKey", metadata.rawAccessKey);
    }
    return url.toString();
  }, [metadata, latestVersionId, params.id]);

  if (error) return <p>{error}</p>;
  if (!metadata) return <p>Loading...</p>;

  return (
    <div className="layout">
      <header>
        <h1>{metadata.title}</h1>
      </header>
      <main>
        <section className="editor">
          <Editor
            height="60vh"
            language="plaintext"
            value={content}
            options={{ readOnly: true, minimap: { enabled: false }, wordWrap: "on" }}
          />
        </section>
        <section className="sidebar">
          <h2>Versions</h2>
          <ul>
            {metadata.versions.map((version) => (
              <li key={version.versionId}>
                <button type="button" onClick={() => setSelectedVersion(version.versionId)}>
                  {new Date(version.createdAt).toLocaleString()} ({
                    Math.round(version.size / 1024)
                  }
                  KB)
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
                      alert("Copied raw URL");
                    } catch (error) {
                      alert("Copy failed");
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
                      alert("Copied latest URL");
                    } catch (error) {
                      alert("Copy failed");
                    }
                  }}
                >
                  Copy latest URL
                </button>
              </>
            )}
          </div>
          {diffText && <pre className="diff">{diffText}</pre>}
        </section>
      </main>
    </div>
  );
}
