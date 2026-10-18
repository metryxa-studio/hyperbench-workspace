import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import type {
  Project,
  Repository,
  DocumentSummary,
  SystemModel,
  SystemDraft,
  TestBench,
} from "../src/types";
import { call, getConfig, message, type Config } from "./api";
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
import { ConnectModal } from "./ConnectModal";
import { SystemView } from "./SystemView";
import { RepositoryView } from "./RepositoryView";
import { DocumentView } from "./DocumentView";
import { BenchView } from "./BenchView";
import mark from "./assets/hyperbench-mark.svg";
import "./styles.css";

type View = "system" | "repositories" | "documents" | "benches";
function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [benches, setBenches] = useState<TestBench[]>([]);
  const [savedSystem, setSavedSystem] = useState<SystemModel | null>(null);
  const [system, setSystem] = useState<SystemModel | null>(null);
  const [drafts, setDrafts] = useState<SystemDraft[]>([]);
  const [view, setView] = useState<View>("system");
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"projects" | "connect" | null>(null);
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [modalError, setModalError] = useState("");
  const [toast, setToast] = useState("");
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const projectRef = useRef<string | null>(null);
  const loadGeneration = useRef(0);
  const systemRef = useRef(system);
  const savedSystemRef = useRef(savedSystem);
  const savingRef = useRef(saving);
  systemRef.current = system;
  savedSystemRef.current = savedSystem;
  savingRef.current = saving;
  const dirty =
    system !== null &&
    savedSystem !== null &&
    JSON.stringify(system) !== JSON.stringify(savedSystem);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  function updateProjects(next: Project[]) {
    projectsRef.current = next;
    setProjects(next);
  }
  function updateSystem(next: SystemModel | null) {
    systemRef.current = next;
    dirtyRef.current =
      next !== null &&
      savedSystemRef.current !== null &&
      JSON.stringify(next) !== JSON.stringify(savedSystemRef.current);
    setSystem(next);
  }
  function updateSavedSystem(next: SystemModel | null) {
    savedSystemRef.current = next;
    dirtyRef.current =
      systemRef.current !== null &&
      next !== null &&
      JSON.stringify(systemRef.current) !== JSON.stringify(next);
    setSavedSystem(next);
  }
  const notify = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 3500);
  };

  async function chooseProject(next: Project, force = false) {
    if (
      !force &&
      dirtyRef.current &&
      !window.confirm(
        "Discard your unsaved system changes and switch projects?",
      )
    )
      return;
    const generation = ++loadGeneration.current;
    projectRef.current = next.id;
    setProject(next);
    setBusy(true);
    setError("");
    setModal(null);
    updateSystem(null);
    updateSavedSystem(null);
    setDrafts([]);
    setRepositories([]);
    setDocuments([]);
    setBenches([]);
    sessionStorage.setItem("hyperbench.project", next.id);
    try {
      const [repos, docs, model, nextDrafts, nextBenches] = await Promise.all([
        call<Repository[]>("repositories.list", { projectId: next.id }),
        call<DocumentSummary[]>("documents.list", { projectId: next.id }),
        call<SystemModel>("system.get", { projectId: next.id }),
        call<SystemDraft[]>("drafts.list", { projectId: next.id }),
        call<TestBench[]>("benches.list", { projectId: next.id }),
      ]);
      if (
        projectRef.current !== next.id ||
        generation !== loadGeneration.current
      )
        return;
      setRepositories(repos);
      setDocuments(docs);
      updateSystem(model);
      updateSavedSystem(model);
      setDrafts(nextDrafts);
      setBenches(nextBenches);
    } catch (e) {
      if (
        projectRef.current === next.id &&
        generation === loadGeneration.current
      )
        setError(message(e));
    } finally {
      if (
        projectRef.current === next.id &&
        generation === loadGeneration.current
      )
        setBusy(false);
    }
  }
  async function initialize() {
    setBusy(true);
    setError("");
    try {
      const [configuration, items] = await Promise.all([
        getConfig(),
        call<Project[]>("projects.list"),
      ]);
      setConfig(configuration);
      updateProjects(items);
      setInitialized(true);
      const last = sessionStorage.getItem("hyperbench.project");
      const initial = items.find((item) => item.id === last) || items[0];
      if (initial) await chooseProject(initial, true);
      else setBusy(false);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }
  useEffect(() => {
    void initialize();
  }, []);
  useEffect(() => {
    if (!project) return;
    let active = true,
      pending = false;
    const poll = async () => {
      if (
        pending ||
        !active ||
        projectRef.current !== project.id ||
        document.visibilityState === "hidden"
      )
        return;
      pending = true;
      const generation = loadGeneration.current;
      const snapshot = systemRef.current;
      const baseline = savedSystemRef.current;
      const refreshSystem =
        snapshot !== null &&
        baseline !== null &&
        !dirtyRef.current &&
        !savingRef.current;
      try {
        const [items, fresh] = await Promise.all([
          call<SystemDraft[]>("drafts.list", { projectId: project.id }),
          refreshSystem
            ? call<SystemModel>("system.get", { projectId: project.id })
            : Promise.resolve(null),
        ]);
        if (
          !active ||
          projectRef.current !== project.id ||
          generation !== loadGeneration.current
        )
          return;
        setDrafts(items);
        if (
          fresh &&
          systemRef.current === snapshot &&
          savedSystemRef.current === baseline &&
          !dirtyRef.current &&
          !savingRef.current &&
          fresh.revision !== baseline?.revision
        ) {
          updateSystem(fresh);
          updateSavedSystem(fresh);
        }
      } catch {
      } finally {
        pending = false;
      }
    };
    const timer = window.setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [project?.id]);
  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);
  async function refreshContext() {
    if (!project) return;
    const id = project.id;
    const generation = loadGeneration.current;
    const [repos, docs, nextBenches] = await Promise.all([
      call<Repository[]>("repositories.list", { projectId: id }),
      call<DocumentSummary[]>("documents.list", { projectId: id }),
      call<TestBench[]>("benches.list", { projectId: id }),
    ]);
    if (projectRef.current === id && generation === loadGeneration.current) {
      setRepositories(repos);
      setDocuments(docs);
      setBenches(nextBenches);
    }
  }
  async function saveSystem() {
    if (!system || !savedSystem || !project || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    const generation = loadGeneration.current;
    const snapshot = system;
    const ports = new Map(
      snapshot.components.map((item) => [item.id, item.ports]),
    );
    const payload = {
      ...snapshot,
      connections: snapshot.connections.map((item) => {
        const next = { ...item };
        if (next.fromPort && !ports.get(next.from)?.includes(next.fromPort))
          delete next.fromPort;
        if (next.toPort && !ports.get(next.to)?.includes(next.toPort))
          delete next.toPort;
        return next;
      }),
    };
    try {
      const saved = await call<SystemModel>("system.save", {
        projectId: project.id,
        system: payload,
        expectedRevision: savedSystem.revision,
      });
      if (
        projectRef.current !== project.id ||
        generation !== loadGeneration.current
      )
        return;
      const current = systemRef.current;
      updateSavedSystem(saved);
      updateSystem(
        current === snapshot
          ? saved
          : current && { ...current, revision: saved.revision },
      );
      notify("System saved");
    } catch (e) {
      if (
        projectRef.current === project.id &&
        generation === loadGeneration.current
      )
        setError(
          `${message(e)} Your edits are still here. Discard to reload the latest saved system, or keep editing.`,
        );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function discard() {
    if (
      !project ||
      (dirty && !window.confirm("Discard your unsaved system changes?"))
    )
      return;
    const snapshot = systemRef.current;
    const generation = loadGeneration.current;
    try {
      const fresh = await call<SystemModel>("system.get", {
        projectId: project.id,
      });
      if (
        projectRef.current === project.id &&
        generation === loadGeneration.current &&
        systemRef.current === snapshot
      ) {
        updateSystem(fresh);
        updateSavedSystem(fresh);
        setError("");
      }
    } catch (e) {
      setError(message(e));
    }
  }
  async function acceptDraft(draft: SystemDraft): Promise<boolean> {
    if (!project || !savedSystem || savingRef.current) return false;
    if (
      dirty &&
      !window.confirm(
        "Accepting this draft will replace your unsaved system edits. Continue?",
      )
    )
      return false;
    savingRef.current = true;
    setSaving(true);
    const generation = loadGeneration.current;
    const snapshot = systemRef.current;
    try {
      const next = await call<SystemModel>("drafts.accept", {
        projectId: project.id,
        draftId: draft.id,
        expectedRevision: savedSystem.revision,
      });
      if (
        projectRef.current !== project.id ||
        generation !== loadGeneration.current
      )
        return false;
      const current = systemRef.current;
      updateSystem(
        current === snapshot
          ? next
          : current && { ...current, revision: next.revision },
      );
      updateSavedSystem(next);
      setDrafts((items) => items.filter((item) => item.id !== draft.id));
      notify("Agent draft accepted and saved");
      return true;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function deleteDraft(draft: SystemDraft) {
    if (!project) return;
    await call("drafts.delete", { projectId: project.id, draftId: draft.id });
    setDrafts((items) => items.filter((item) => item.id !== draft.id));
  }
  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    if (!projectName.trim()) return;
    setCreating(true);
    setModalError("");
    try {
      const next = await call<Project>("projects.create", {
        name: projectName.trim(),
      });
      updateProjects([...projectsRef.current, next]);
      setProjectName("");
      await chooseProject(next);
    } catch (e) {
      setModalError(message(e));
    } finally {
      setCreating(false);
    }
  }
  async function deleteProject(item: Project) {
    if (
      !window.confirm(
        `Delete “${item.name}” and its stored documents, system, drafts, and test bench connections? Repository source folders and remote benches will stay in place.`,
      )
    )
      return;
    setModalError("");
    try {
      await call("projects.delete", { projectId: item.id });
      const remaining = projectsRef.current.filter((p) => p.id !== item.id);
      updateProjects(remaining);
      if (projectRef.current === item.id) {
        ++loadGeneration.current;
        projectRef.current = null;
        setProject(null);
        setRepositories([]);
        setDocuments([]);
        setDrafts([]);
        setBenches([]);
        updateSystem(null);
        updateSavedSystem(null);
        if (remaining[0]) await chooseProject(remaining[0], true);
        else setBusy(false);
      }
    } catch (e) {
      setModalError(message(e));
    }
  }
  return (
    <div className="app-shell">
      <aside className="navigation">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("system");
          }}
        >
          <img src={mark} alt="" />
          <span>hyperbench</span>
        </a>
        <button
          className="project-switcher"
          disabled={!initialized}
          onClick={() => {
            setModal("projects");
            setModalError("");
          }}
        >
          <span className="project-avatar">
            {project?.name.slice(0, 1).toUpperCase() || "+"}
          </span>
          <span>
            <strong>{project?.name || "Choose a project"}</strong>
          </span>
          <Icon name="chevron" size={15} />
        </button>

        <nav aria-label="Workspace navigation">
          <button
            className={`nav-item ${view === "system" ? "active" : ""}`}
            onClick={() => setView("system")}
          >
            <Icon name="system" />
            System
            <span className="nav-count">
              {system?.components.length || "—"}
            </span>
          </button>
          <button
            className={`nav-item ${view === "repositories" ? "active" : ""}`}
            onClick={() => setView("repositories")}
          >
            <Icon name="code" />
            Repositories
            <span className="nav-count">{repositories.length || "—"}</span>
          </button>
          <button
            className={`nav-item ${view === "documents" ? "active" : ""}`}
            onClick={() => setView("documents")}
          >
            <Icon name="document" />
            Documents
            <span className="nav-count">{documents.length || "—"}</span>
          </button>
          <button
            className={`nav-item ${view === "benches" ? "active" : ""}`}
            onClick={() => setView("benches")}
          >
            <Icon name="terminal" />
            Test benches
            <span className="nav-count">{benches.length || "—"}</span>
          </button>
        </nav>
        <div className="nav-spacer" />
        <div className="agent-connect">
          <Button
            icon="plug"
            onClick={() => setModal("connect")}
            disabled={!project || !config}
          >
            Connect agent
          </Button>
        </div>
      </aside>
      <div className="workspace-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{project?.name || "Workspace"}</span>
            <span className="slash">/</span>
            <strong>
              {view === "system"
                ? "System"
                : view === "repositories"
                  ? "Repositories"
                  : view === "documents"
                    ? "Documents"
                    : "Test benches"}
            </strong>
          </div>
          <div className="topbar-actions">
            {project && (
              <span className={`save-status ${dirty ? "unsaved" : ""}`}>
                <span className="status-dot" />
                {dirty ? "Unsaved changes" : "Saved"}
              </span>
            )}
          </div>
        </header>
        {error && (
          <ErrorBanner onClose={initialized ? () => setError("") : undefined}>
            {error}
            {!initialized && (
              <Button onClick={() => void initialize()} disabled={busy}>
                Retry
              </Button>
            )}
          </ErrorBanner>
        )}
        {busy ? (
          <Loading>Opening your workspace…</Loading>
        ) : !project ? (
          <div className="welcome">
            <h1>No projects</h1>
            <Button
              variant="primary"
              icon="plus"
              disabled={!initialized}
              onClick={() => setModal("projects")}
            >
              Create project
            </Button>
          </div>
        ) : (
          <>
            {view === "system" && system && (
              <SystemView
                key={project.id}
                project={project}
                system={system}
                savedSystem={savedSystem!}
                onChange={updateSystem}
                repositories={repositories}
                documents={documents}
                dirty={dirty}
                saving={saving}
                onSave={saveSystem}
                onDiscard={discard}
                drafts={drafts}
                onAcceptDraft={acceptDraft}
                onDeleteDraft={deleteDraft}
                onNavigate={setView}
              />
            )}
            {view === "repositories" && (
              <RepositoryView
                key={project.id}
                project={project}
                repositories={repositories}
                onRefresh={refreshContext}
                system={system}
                onSystemChange={updateSystem}
                notify={notify}
              />
            )}
            {view === "documents" && (
              <DocumentView
                key={project.id}
                project={project}
                documents={documents}
                repositories={repositories}
                onRefresh={refreshContext}
                system={system}
                onSystemChange={updateSystem}
                notify={notify}
              />
            )}
            {view === "benches" && (
              <BenchView
                key={project.id}
                project={project}
                benches={benches}
                onRefresh={refreshContext}
                notify={notify}
              />
            )}
          </>
        )}
        {dirty && view !== "system" && (
          <div className="floating-save">
            <span>
              <span className="status-dot" />
              System has unsaved context links
            </span>
            <Button onClick={discard} disabled={saving}>
              Discard
            </Button>
            <Button
              variant="primary"
              icon="save"
              onClick={saveSystem}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save system"}
            </Button>
          </div>
        )}
      </div>
      {modal === "projects" && (
        <Modal title="Your projects" onClose={() => setModal(null)}>
          {modalError && <ErrorBanner>{modalError}</ErrorBanner>}
          <div className="project-list">
            {projects.map((item) => (
              <div
                className={`project-row ${project?.id === item.id ? "selected" : ""}`}
                key={item.id}
              >
                <button onClick={() => chooseProject(item)}>
                  <span className="project-avatar">
                    {item.name[0].toUpperCase()}
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      Created {new Date(item.createdAt).toLocaleDateString()}
                    </small>
                  </span>
                  {project?.id === item.id && (
                    <Badge tone="green">Current</Badge>
                  )}
                </button>
                <IconButton
                  name="trash"
                  label={`Delete project ${item.name}`}
                  onClick={() => deleteProject(item)}
                />
              </div>
            ))}
          </div>
          <form onSubmit={createProject} className="new-project-form">
            <Field label="New project name">
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. Flight controller"
                maxLength={120}
                required
              />
            </Field>
            <Button
              variant="primary"
              icon="plus"
              type="submit"
              disabled={creating || !projectName.trim()}
            >
              {creating ? "Creating…" : "Create project"}
            </Button>
          </form>
        </Modal>
      )}
      {modal === "connect" && project && config && (
        <ConnectModal
          project={project}
          config={config}
          onClose={() => setModal(null)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
