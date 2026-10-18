import { useEffect, useState } from "react";
import type {
  DocumentContent,
  DocumentSummary,
  Evidence,
  Project,
  Repository,
  SourceRead,
} from "../src/types";
import { call, message } from "./api";
import { Button, ErrorBanner, Field, Loading, Modal } from "./common";

export function evidenceLabel(
  item: Evidence,
  repositories: Repository[],
  documents: DocumentSummary[],
) {
  return item.type === "source"
    ? `${repositories.find((repo) => repo.id === item.repositoryId)?.name || "Repository"}/${item.path}${item.line ? `:${item.line}${item.endLine && item.endLine !== item.line ? `–${item.endLine}` : ""}` : ""}`
    : `${documents.find((doc) => doc.id === item.documentId)?.name || "Document"}${item.page ? ` · p. ${item.page}` : ""}`;
}
export function EvidenceEditor({
  repositories,
  documents,
  onAdd,
  onClose,
}: {
  repositories: Repository[];
  documents: DocumentSummary[];
  onAdd: (item: Evidence) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<"source" | "document">(
    repositories.length ? "source" : "document",
  );
  const [repositoryId, setRepositoryId] = useState(repositories[0]?.id || "");
  const [documentId, setDocumentId] = useState(documents[0]?.id || "");
  const [path, setPath] = useState(""),
    [line, setLine] = useState(""),
    [endLine, setEndLine] = useState(""),
    [page, setPage] = useState(""),
    [excerpt, setExcerpt] = useState("");
  return (
    <Modal title="Attach evidence" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAdd(
            type === "source"
              ? {
                  type,
                  repositoryId,
                  path,
                  ...(line ? { line: +line } : {}),
                  ...(endLine ? { endLine: +endLine } : {}),
                }
              : {
                  type,
                  documentId,
                  ...(page ? { page: +page } : {}),
                  ...(excerpt ? { excerpt } : {}),
                },
          );
          onClose();
        }}
      >
        <div className="segmented">
          <button
            type="button"
            className={type === "source" ? "active" : ""}
            onClick={() => setType("source")}
          >
            Source code
          </button>
          <button
            type="button"
            className={type === "document" ? "active" : ""}
            onClick={() => setType("document")}
          >
            Document
          </button>
        </div>
        {type === "source" ? (
          <>
            <Field label="Repository">
              <select
                value={repositoryId}
                onChange={(e) => setRepositoryId(e.target.value)}
                required
              >
                <option value="" disabled>
                  Choose a repository
                </option>
                {repositories.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="File path">
              <input
                placeholder="src/controller.ts"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                required
              />
            </Field>
            <div className="field-grid">
              <Field label="Start line (optional)">
                <input
                  type="number"
                  min="1"
                  value={line}
                  onChange={(e) => {
                    setLine(e.target.value);
                    if (!e.target.value) setEndLine("");
                  }}
                />
              </Field>
              <Field label="End line (optional)">
                <input
                  type="number"
                  min={line || 1}
                  disabled={!line}
                  value={endLine}
                  onChange={(e) => setEndLine(e.target.value)}
                />
              </Field>
            </div>
          </>
        ) : (
          <>
            <Field label="Document">
              <select
                required
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
              >
                <option value="" disabled>
                  Choose a document
                </option>
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Page (optional)">
              <input
                type="number"
                min="1"
                max={
                  documents.find((d) => d.id === documentId)?.pageCount ||
                  undefined
                }
                value={page}
                onChange={(e) => setPage(e.target.value)}
              />
            </Field>
            <Field label="Excerpt or context (optional)">
              <textarea
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                rows={3}
              />
            </Field>
          </>
        )}
        <footer className="modal-actions">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon="link"
            disabled={
              type === "source" ? !repositoryId || !path.trim() : !documentId
            }
          >
            Attach evidence
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
export function EvidencePreview({
  item,
  project,
  repositories,
  documents,
  onClose,
}: {
  item: Evidence;
  project: Project;
  repositories: Repository[];
  documents: DocumentSummary[];
  onClose: () => void;
}) {
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setText("");
    void (async () => {
      try {
        const result =
          item.type === "source"
            ? await call<SourceRead>("repositories.read", {
                projectId: project.id,
                repositoryId: item.repositoryId,
                path: item.path,
                startLine: item.line || 1,
                endLine: Math.min(
                  item.endLine || (item.line ? item.line + 30 : 100),
                  (item.line || 1) + 1999,
                  10_000_000,
                ),
              })
            : await call<DocumentContent>("documents.read", {
                projectId: project.id,
                documentId: item.documentId,
                page: item.page || 1,
              });
        if (active)
          setText(
            "pages" in result
              ? result.pages
                  .map((p) => `Page ${p.page}\n\n${p.text}`)
                  .join("\n\n")
              : result.totalLines === 0
                ? "Empty file."
                : `Lines ${result.startLine}–${result.endLine} of ${result.totalLines}\n\n${result.text
                    .split("\n")
                    .map(
                      (line, index) =>
                        `${String(result.startLine + index).padStart(4)}  ${line}`,
                    )
                    .join("\n")}`,
          );
      } catch (e) {
        if (active) setError(message(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [item, project.id, attempt]);
  return (
    <Modal title="Evidence preview" onClose={onClose} wide>
      <p className="context-filename">
        {evidenceLabel(item, repositories, documents)}
      </p>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBanner>{error}</ErrorBanner>
      ) : (
        <pre className="evidence-preview">
          {text ||
            "No extractable text on this page. Open Documents to view the original page."}
        </pre>
      )}
      {item.type === "document" && item.excerpt && (
        <blockquote className="agent-prompt">{item.excerpt}</blockquote>
      )}
      <footer className="modal-actions">
        {error && (
          <Button onClick={() => setAttempt((value) => value + 1)}>
            Retry preview
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
      </footer>
    </Modal>
  );
}
