import React, { useEffect, useRef, useState } from "react";
import type {
  DocumentContent,
  DocumentLink,
  DocumentSummary,
  Project,
  Repository,
  SystemModel,
} from "../src/types";
import { authHeaders, bytes, call, message, newId } from "./api";
import {
  Badge,
  Button,
  Empty,
  ErrorBanner,
  Field,
  Icon,
  IconButton,
  Loading,
  Modal,
} from "./common";

type DocumentSearch = {
  hits: { documentId: string; name: string; page: number; text: string }[];
  truncated: boolean;
};
export function DocumentView({
  project,
  documents,
  repositories,
  onRefresh,
  system,
  onSystemChange,
  notify,
}: {
  project: Project;
  documents: DocumentSummary[];
  repositories: Repository[];
  onRefresh: () => Promise<void>;
  system: SystemModel | null;
  onSystemChange: (model: SystemModel) => void;
  notify: (text: string) => void;
}) {
  const [documentId, setDocumentId] = useState(documents[0]?.id || ""),
    [page, setPage] = useState(1),
    [mode, setMode] = useState<"page" | "text">("page");
  const selected = documents.find((doc) => doc.id === documentId);
  const [content, setContent] = useState<DocumentContent | null>(null),
    [pageImage, setPageImage] = useState(""),
    [loading, setLoading] = useState(false),
    [rendering, setRendering] = useState(false),
    [readAttempt, setReadAttempt] = useState(0);
  const [error, setError] = useState(""),
    [readError, setReadError] = useState(""),
    [renderError, setRenderError] = useState(""),
    [modalError, setModalError] = useState(""),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false);
  const [modal, setModal] = useState<"import" | "link" | null>(null),
    [importMode, setImportMode] = useState<"upload" | "path">("upload"),
    [path, setPath] = useState(""),
    [dragging, setDragging] = useState(false);
  const [componentId, setComponentId] = useState(""),
    [repositoryId, setRepositoryId] = useState(""),
    [sourcePath, setSourcePath] = useState(""),
    [sourceLine, setSourceLine] = useState(""),
    [note, setNote] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState<DocumentSearch | null>(null),
    [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRequestId = useRef(0);
  const [showDocuments, setShowDocuments] = useState(false);
  const documentIds = documents.map((doc) => doc.id).join(",");
  useEffect(() => {
    searchRequestId.current++;
    setSearch(null);
    setSearching(false);
  }, [project.id, query, documentIds]);
  const links =
    system?.links.filter((link) => link.documentId === documentId) || [];
  const evidenceReferences = system
    ? [
        ...system.components.map((item) => ({
          item,
          type: "component" as const,
        })),
        ...system.connections.map((item) => ({
          item,
          type: "connection" as const,
        })),
      ].flatMap(({ item, type }) =>
        item.evidence
          .map((evidence, index) => ({ item, type, evidence, index }))
          .filter(
            (ref) =>
              ref.evidence.type === "document" &&
              ref.evidence.documentId === documentId,
          ),
      )
    : [];
  function removeEvidenceReference(
    type: "component" | "connection",
    id: string,
    index: number,
  ) {
    if (!system) return;
    onSystemChange(
      type === "component"
        ? {
            ...system,
            components: system.components.map((item) =>
              item.id === id
                ? {
                    ...item,
                    evidence: item.evidence.filter((_, i) => i !== index),
                  }
                : item,
            ),
          }
        : {
            ...system,
            connections: system.connections.map((item) =>
              item.id === id
                ? {
                    ...item,
                    evidence: item.evidence.filter((_, i) => i !== index),
                  }
                : item,
            ),
          },
    );
  }

  useEffect(() => {
    if (!documentId && documents[0]) setDocumentId(documents[0].id);
    else if (documentId && !documents.some((doc) => doc.id === documentId)) {
      setDocumentId(documents[0]?.id || "");
      setPage(1);
    }
  }, [documents, documentId]);
  useEffect(() => {
    let active = true;
    setContent(null);
    setPageImage("");
    setReadError("");
    setRenderError("");
    setLoading(!!selected);
    setRendering(selected?.mime === "application/pdf");
    if (!selected) return;
    void call<DocumentContent>("documents.read", {
      projectId: project.id,
      documentId: selected.id,
      page,
    })
      .then((result) => {
        if (active) setContent(result);
      })
      .catch((e) => {
        if (active) setReadError(message(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    if (selected.mime === "application/pdf")
      void call<{ data: string; mimeType: string }>("documents.page", {
        projectId: project.id,
        documentId: selected.id,
        page,
        scale: 1.5,
      })
        .then((result) => {
          if (active)
            setPageImage(
              result.data.startsWith("data:")
                ? result.data
                : `data:${result.mimeType};base64,${result.data}`,
            );
        })
        .catch((e) => {
          if (active) setRenderError(message(e));
        })
        .finally(() => {
          if (active) setRendering(false);
        });
    return () => {
      active = false;
    };
  }, [selected?.id, project.id, page, readAttempt]);
  function choose(docId: string, nextPage = 1) {
    setShowDocuments(false);
    setDocumentId(docId);
    setPage(nextPage);
  }
  async function upload(files: FileList | File[]) {
    if (!files.length || uploading || busy) return;
    setUploading(true);
    setModalError("");
    setError("");
    try {
      let last: DocumentSummary | null = null;
      let imported = 0;
      const failures: string[] = [];
      for (const file of Array.from(files)) {
        try {
          if (file.size > 32 * 1024 * 1024)
            throw new Error("Exceeds the 32 MiB import limit.");
          const buffer = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          for (let offset = 0; offset < buffer.length; offset += 32768)
            binary += String.fromCharCode(
              ...buffer.subarray(offset, offset + 32768),
            );
          last = await call<DocumentSummary>("documents.upload", {
            projectId: project.id,
            name: file.name,
            base64: btoa(binary),
          });
          imported++;
        } catch (e) {
          failures.push(`${file.name}: ${message(e)}`);
        }
      }
      await onRefresh();
      if (last) choose(last.id);
      if (failures.length) {
        const details = failures.join("\n");
        setModalError(details);
        setError(details);
      } else setModal(null);
      if (imported)
        notify(
          `${imported === 1 ? "Document" : `${imported} documents`} imported`,
        );
    } catch (e) {
      setModalError(message(e));
      setError(message(e));
      await onRefresh().catch(() => {});
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  async function importPath(e: React.FormEvent) {
    e.preventDefault();
    if (busy || uploading) return;
    setBusy(true);
    setModalError("");
    try {
      const doc = await call<DocumentSummary>("documents.import", {
        projectId: project.id,
        path,
      });
      await onRefresh();
      choose(doc.id);
      setModal(null);
      setPath("");
      notify("Document imported");
    } catch (e) {
      setModalError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(doc: DocumentSummary) {
    if (
      system &&
      (system.links.some((link) => link.documentId === doc.id) ||
        [...system.components, ...system.connections].some((item) =>
          item.evidence.some(
            (evidence) =>
              evidence.type === "document" && evidence.documentId === doc.id,
          ),
        ))
    ) {
      setError(
        "Remove this document’s system links and save before deleting the document.",
      );
      return;
    }
    if (
      !window.confirm(
        `Delete “${doc.name}” from this project? The original file outside the workspace will stay on disk.`,
      )
    )
      return;
    try {
      await call("documents.delete", {
        projectId: project.id,
        documentId: doc.id,
      });
      await onRefresh();
      notify("Document deleted");
    } catch (e) {
      setError(message(e));
    }
  }
  async function download() {
    if (!selected) return;
    try {
      const response = await fetch(
        `/api/file?${new URLSearchParams({ projectId: project.id, documentId: selected.id })}`,
        { headers: authHeaders() },
      );
      if (!response.ok) throw new Error("Could not download this document.");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = selected.name;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError(message(e));
    }
  }
  function addLink(e: React.FormEvent) {
    e.preventDefault();
    if (!system || !selected || (!componentId && !repositoryId)) return;
    const link: DocumentLink = {
      id: newId("link"),
      documentId,
      page,
      ...(componentId ? { componentId } : {}),
      ...(repositoryId
        ? {
            repositoryId,
            path: sourcePath,
            ...(sourceLine ? { line: +sourceLine } : {}),
          }
        : {}),
      note,
    };
    onSystemChange({ ...system, links: [...system.links, link] });
    setModal(null);
    notify("Context linked. Save the system to keep this change.");
  }
  async function searchDocuments(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError("");
    const id = ++searchRequestId.current;
    try {
      const result = await call<DocumentSearch>("documents.search", {
        projectId: project.id,
        query,
        limit: 60,
      });
      if (searchRequestId.current === id) setSearch(result);
    } catch (e) {
      if (searchRequestId.current === id) setError(message(e));
    } finally {
      if (searchRequestId.current === id) setSearching(false);
    }
  }
  return (
    <section
      className="resource-view"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void upload(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="visually-hidden"
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
        }}
        aria-label="Upload documents"
      />
      <div className="page-heading">
        <div>
          <h1>Documents</h1>
        </div>
        <Button
          variant="primary"
          icon="upload"
          onClick={() => {
            setModal("import");
            setModalError("");
          }}
          disabled={uploading}
        >
          {uploading ? "Importing…" : "Import documents"}
        </Button>
      </div>
      {error && <ErrorBanner onClose={() => setError("")}>{error}</ErrorBanner>}
      {!documents.length ? (
        <div className="resource-empty">
          <Empty
            title="No documents"
            action={
              <Button
                variant="primary"
                icon="upload"
                onClick={() => setModal("import")}
                disabled={uploading}
              >
                {uploading ? "Importing…" : "Import documents"}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="document-layout">
          <aside
            className={`document-sidebar ${showDocuments ? "show-source-panel" : ""}`}
          >
            <div className="resource-side-heading">
              <span>Documents</span>
              <Badge>{documents.length}</Badge>
              <span className="mobile-source-control">
                <IconButton
                  name="close"
                  label="Close document library"
                  onClick={() => setShowDocuments(false)}
                />
              </span>
            </div>
            <form className="document-search" onSubmit={searchDocuments}>
              <label className="search-input compact">
                <Icon name="search" size={15} />
                <input
                  aria-label="Search documents"
                  placeholder="Search document text…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button
                  type="submit"
                  className="input-submit"
                  aria-label="Search document text"
                  disabled={!query.trim() || searching}
                >
                  <Icon name="arrow" size={15} />
                </button>
              </label>
            </form>
            {search && (
              <div className="document-search-results">
                <div className="search-result-heading">
                  <span>
                    {search.hits.length}
                    {search.truncated ? "+" : ""} results
                  </span>
                  <IconButton
                    name="close"
                    label="Close document search"
                    onClick={() => setSearch(null)}
                  />
                </div>
                {search.hits.map((hit, i) => (
                  <button
                    key={i}
                    onClick={() => choose(hit.documentId, hit.page)}
                  >
                    <strong>
                      {hit.name} · p. {hit.page}
                    </strong>
                    <span>{hit.text}</span>
                  </button>
                ))}
                {!search.hits.length && (
                  <p className="small-empty">No matching text found.</p>
                )}
              </div>
            )}
            <div className="document-list">
              {documents.map((doc) => (
                <button
                  className={`document-item ${doc.id === documentId ? "selected" : ""}`}
                  key={doc.id}
                  onClick={() => choose(doc.id)}
                >
                  <span
                    className={`file-type-icon ${doc.mime === "application/pdf" ? "pdf" : ""}`}
                  >
                    <Icon name="document" size={21} />
                  </span>
                  <span>
                    <strong title={doc.name}>{doc.name}</strong>
                    <small>
                      {doc.pageCount} {doc.pageCount === 1 ? "page" : "pages"} ·{" "}
                      {bytes(doc.bytes)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <button
              className="sidebar-upload"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              <Icon name="upload" size={20} />
              <span>
                {uploading
                  ? "Importing documents…"
                  : "Drop files here or browse"}
              </span>
            </button>
          </aside>
          {selected && (
            <>
              <div className="document-reader">
                <div className="document-reader-heading">
                  <div>
                    <strong>{selected.name}</strong>
                    <span>
                      {bytes(selected.bytes)} · {selected.pageCount} pages
                    </span>
                  </div>
                  <div className="reader-heading-actions">
                    <span className="mobile-source-control">
                      <IconButton
                        name="folder"
                        label="Show documents"
                        onClick={() => setShowDocuments((value) => !value)}
                      />
                    </span>
                    <span className="mobile-context-control">
                      <IconButton
                        name="link"
                        label="Show document context"
                        onClick={() => setShowContext((value) => !value)}
                      />
                    </span>
                    <IconButton
                      name="download"
                      label="Download original document"
                      onClick={download}
                    />
                  </div>
                </div>
                <div className="document-reader-toolbar">
                  <div className="segmented small">
                    <button
                      className={mode === "page" ? "active" : ""}
                      onClick={() => setMode("page")}
                    >
                      Page view
                    </button>
                    <button
                      className={mode === "text" ? "active" : ""}
                      onClick={() => setMode("text")}
                    >
                      Extracted text
                    </button>
                  </div>
                  <div className="pagination">
                    <button
                      aria-label="Previous page"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      ‹
                    </button>
                    <label>
                      <span className="visually-hidden">Page number</span>
                      <select
                        value={page}
                        onChange={(e) => setPage(+e.target.value)}
                      >
                        {Array.from({ length: selected.pageCount }, (_, i) => (
                          <option key={i} value={i + 1}>
                            Page {i + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span>of {selected.pageCount}</span>
                    <button
                      aria-label="Next page"
                      disabled={page >= selected.pageCount}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      ›
                    </button>
                  </div>
                </div>
                <div
                  className={`document-page ${mode === "text" || selected.mime !== "application/pdf" ? "text-mode" : ""}`}
                >
                  {(
                    mode === "page" && selected.mime === "application/pdf"
                      ? rendering
                      : loading
                  ) ? (
                    <Loading>Reading page {page}…</Loading>
                  ) : mode === "page" && selected.mime === "application/pdf" ? (
                    pageImage ? (
                      <img
                        src={pageImage}
                        alt={`Page ${page} of ${selected.name}`}
                      />
                    ) : (
                      <div className="page-render-fallback">
                        <Icon name="document" size={32} />
                        <h3>Page preview unavailable</h3>
                        <p>
                          {renderError || "The page could not be rendered."}
                        </p>
                        <Button
                          onClick={() => setReadAttempt((value) => value + 1)}
                        >
                          Retry page preview
                        </Button>
                        <Button onClick={() => setMode("text")}>
                          Read extracted text
                        </Button>
                        <Button icon="download" onClick={download}>
                          Download original
                        </Button>
                      </div>
                    )
                  ) : readError ? (
                    <div>
                      <ErrorBanner>{readError}</ErrorBanner>
                      <Button
                        onClick={() => setReadAttempt((value) => value + 1)}
                      >
                        Retry reading document
                      </Button>
                    </div>
                  ) : (
                    <pre className="document-text">
                      {content?.pages.map((p) => p.text).join("\n\n") ||
                        "No extractable text on this page. It may be scanned or contain diagrams. Use Page view to read it visually."}
                    </pre>
                  )}
                </div>
                <details className="document-coverage">
                  <summary>Extraction details</summary>
                  <p>{selected.coverage}</p>
                </details>
              </div>
              <aside
                className={`document-context ${showContext ? "show-context" : ""}`}
              >
                <div className="inspector-title">
                  <span>Document context</span>
                  <Icon name="link" size={16} />
                  <span className="mobile-context-control">
                    <IconButton
                      name="close"
                      label="Close document context"
                      onClick={() => setShowContext(false)}
                    />
                  </span>
                </div>
                <div className="inspector-body">
                  <Badge tone="orange">PAGE {page}</Badge>
                  <Button
                    icon="link"
                    className="full-width"
                    onClick={() => {
                      setComponentId("");
                      setRepositoryId("");
                      setSourcePath("");
                      setSourceLine("");
                      setNote("");
                      setModal("link");
                    }}
                    disabled={
                      !system ||
                      (!system.components.length && !repositories.length)
                    }
                  >
                    Link to system or code
                  </Button>
                  <div className="inspector-section-title">
                    <span>Links</span>
                    <Badge>{links.length + evidenceReferences.length}</Badge>
                  </div>
                  {!links.length && !evidenceReferences.length && (
                    <p className="inspector-hint">No links</p>
                  )}
                  <div className="document-links">
                    {links.map((link) => (
                      <div className="document-link-card" key={link.id}>
                        <div>
                          <Badge>p. {link.page || "all"}</Badge>
                          <IconButton
                            name="close"
                            label="Remove document link"
                            onClick={() => {
                              if (system)
                                onSystemChange({
                                  ...system,
                                  links: system.links.filter(
                                    (item) => item.id !== link.id,
                                  ),
                                });
                            }}
                          />
                        </div>
                        {link.componentId && (
                          <strong>
                            <Icon name="chip" size={14} />
                            {system?.components.find(
                              (c) => c.id === link.componentId,
                            )?.label || "Component"}
                          </strong>
                        )}
                        {link.repositoryId && (
                          <span className="linked-code">
                            <Icon name="code" size={14} />
                            {
                              repositories.find(
                                (r) => r.id === link.repositoryId,
                              )?.name
                            }
                            /{link.path}
                            {link.line ? `:${link.line}` : ""}
                          </span>
                        )}
                        {link.note && <p>{link.note}</p>}
                      </div>
                    ))}
                    {evidenceReferences.map((ref) => (
                      <div
                        className="document-link-card"
                        key={`${ref.type}:${ref.item.id}:${ref.index}`}
                      >
                        <div>
                          <Badge>
                            p.{" "}
                            {ref.evidence.type === "document"
                              ? ref.evidence.page || "all"
                              : "all"}
                          </Badge>
                          <IconButton
                            name="close"
                            label={`Remove document evidence from ${ref.item.label}`}
                            onClick={() =>
                              removeEvidenceReference(
                                ref.type,
                                ref.item.id,
                                ref.index,
                              )
                            }
                          />
                        </div>
                        <strong>
                          <Icon
                            name={ref.type === "component" ? "chip" : "link"}
                            size={14}
                          />
                          {ref.item.label || "Connection"}
                        </strong>
                        <p>
                          {ref.type === "component"
                            ? "Component evidence"
                            : "Connection evidence"}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="document-metadata">
                    <div>
                      <span>Added</span>
                      <strong>
                        {new Date(selected.createdAt).toLocaleDateString()}
                      </strong>
                    </div>
                    <div>
                      <span>Pages</span>
                      <strong>{selected.pageCount}</strong>
                    </div>
                    <div>
                      <span>File size</span>
                      <strong>{bytes(selected.bytes)}</strong>
                    </div>
                    <div>
                      <span>SHA-256</span>
                      <code title={selected.sha256}>
                        {selected.sha256.slice(0, 12)}…
                      </code>
                    </div>
                  </div>
                  <Button
                    icon="trash"
                    variant="ghost"
                    className="delete-item"
                    onClick={() => remove(selected)}
                  >
                    Delete document
                  </Button>
                </div>
              </aside>
            </>
          )}
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <Icon name="upload" size={42} />
          <h2>Drop documents to import</h2>
          <p>PDF and text files · up to 32 MiB each</p>
        </div>
      )}
      {modal === "import" && (
        <Modal
          title="Import documents"
          onClose={() => {
            if (!busy && !uploading) setModal(null);
          }}
        >
          <div className="segmented">
            <button
              className={importMode === "upload" ? "active" : ""}
              onClick={() => setImportMode("upload")}
              disabled={uploading || busy}
            >
              Upload files
            </button>
            <button
              className={importMode === "path" ? "active" : ""}
              onClick={() => setImportMode("path")}
              disabled={uploading || busy}
            >
              Local file path
            </button>
          </div>
          {modalError && <ErrorBanner>{modalError}</ErrorBanner>}
          {importMode === "upload" ? (
            <>
              <button
                className="upload-dropzone"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
              >
                <span className="empty-icon">
                  <Icon name="upload" size={28} />
                </span>
                <strong>
                  {uploading
                    ? "Importing documents…"
                    : "Choose files or drop them here"}
                </strong>
                <span>PDF, Markdown, and text files · up to 32 MiB each</span>
              </button>
              <footer className="modal-actions">
                <Button onClick={() => setModal(null)} disabled={uploading}>
                  Done
                </Button>
              </footer>
            </>
          ) : (
            <form onSubmit={importPath}>
              <Field label="Absolute file path">
                <input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/Users/you/Documents/controller-datasheet.pdf"
                  required
                  disabled={busy}
                />
              </Field>
              <footer className="modal-actions">
                <Button
                  type="button"
                  onClick={() => setModal(null)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  icon="upload"
                  type="submit"
                  disabled={busy || !path.trim()}
                >
                  {busy ? "Importing…" : "Import document"}
                </Button>
              </footer>
            </form>
          )}
        </Modal>
      )}
      {modal === "link" && selected && (
        <Modal title="Link document context" onClose={() => setModal(null)}>
          <p className="context-filename">
            {selected.name} · page {page}
          </p>
          <form onSubmit={addLink}>
            <Field label="Component (optional)">
              <select
                value={componentId}
                onChange={(e) => setComponentId(e.target.value)}
              >
                <option value="">Choose a component</option>
                {system?.components.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Repository (optional)">
              <select
                value={repositoryId}
                onChange={(e) => setRepositoryId(e.target.value)}
              >
                <option value="">Choose a repository</option>
                {repositories.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.name}
                  </option>
                ))}
              </select>
            </Field>
            {repositoryId && (
              <div className="field-grid source-link-fields">
                <Field label="Source file path">
                  <input
                    value={sourcePath}
                    onChange={(e) => setSourcePath(e.target.value)}
                    placeholder="src/controller.cpp"
                    required
                  />
                </Field>
                <Field label="Line (optional)">
                  <input
                    type="number"
                    min="1"
                    value={sourceLine}
                    onChange={(e) => setSourceLine(e.target.value)}
                  />
                </Field>
              </div>
            )}
            <Field label="Context note">
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What does this page explain?"
              />
            </Field>
            <footer className="modal-actions">
              <Button type="button" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                icon="link"
                disabled={!componentId && !repositoryId}
              >
                Add context link
              </Button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}
