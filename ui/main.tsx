import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { Project, Repository, DocumentSummary, SystemModel, SystemDraft } from '../src/types';
import { call, getConfig, message, type Config } from './api';
import { Badge, Button, Empty, ErrorBanner, Field, Icon, IconButton, Loading, Modal } from './common';
import { ConnectModal } from './ConnectModal';
import { SystemView } from './SystemView';
import { RepositoryView } from './RepositoryView';
import { DocumentView } from './DocumentView';
import mark from './assets/hyperbench-mark.svg';
import './styles.css';

type View = 'system' | 'repositories' | 'documents';
function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [savedSystem, setSavedSystem] = useState<SystemModel | null>(null);
  const [system, setSystem] = useState<SystemModel | null>(null);
  const [drafts, setDrafts] = useState<SystemDraft[]>([]);
  const [view, setView] = useState<View>('system');
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'projects' | 'connect' | null>(null);
  const [projectName, setProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [modalError, setModalError] = useState('');
  const [toast, setToast] = useState('');
  const projectRef = useRef<string | null>(null);
  const loadGeneration = useRef(0);
  const systemRef = useRef(system); systemRef.current = system;
  const dirty = system !== null && savedSystem !== null && JSON.stringify(system) !== JSON.stringify(savedSystem);
  const notify = (text: string) => { setToast(text); window.setTimeout(() => setToast(''), 3500); };

  async function chooseProject(next: Project, force = false) {
    if (!force && dirty && !window.confirm('Discard your unsaved system changes and switch projects?')) return;
    const generation = ++loadGeneration.current;
    projectRef.current = next.id;
    setProject(next); setBusy(true); setError(''); setModal(null); setSystem(null); setSavedSystem(null); setDrafts([]);
    setRepositories([]); setDocuments([]);
    sessionStorage.setItem('hyperbench.project', next.id);
    try {
      const [repos, docs, model, nextDrafts] = await Promise.all([
        call<Repository[]>('repositories.list', { projectId: next.id }), call<DocumentSummary[]>('documents.list', { projectId: next.id }),
        call<SystemModel>('system.get', { projectId: next.id }), call<SystemDraft[]>('drafts.list', { projectId: next.id })
      ]);
      if (projectRef.current !== next.id || generation !== loadGeneration.current) return;
      setRepositories(repos); setDocuments(docs); setSystem(model); setSavedSystem(model); setDrafts(nextDrafts);
    } catch (e) { if (projectRef.current === next.id && generation === loadGeneration.current) setError(message(e)); }
    finally { if (projectRef.current === next.id && generation === loadGeneration.current) setBusy(false); }
  }
  useEffect(() => { void (async () => {
    try {
      const [configuration, items] = await Promise.all([getConfig(), call<Project[]>('projects.list')]);
      setConfig(configuration); setProjects(items);
      const last = sessionStorage.getItem('hyperbench.project');
      const initial = items.find(item => item.id === last) || items[0];
      if (initial) await chooseProject(initial, true); else setBusy(false);
    } catch (e) { setError(message(e)); setBusy(false); }
  })(); }, []);
  useEffect(() => {
    if (!project) return;
    let active = true, pending = false;
    const poll = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try { const items = await call<SystemDraft[]>('drafts.list', { projectId: project.id }); if (active) setDrafts(items); } catch { /* Manual actions surface API failures. */ }
      finally { pending = false; }
    };
    const timer = window.setInterval(poll, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [project?.id]);
  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);
  async function refreshContext() {
    if (!project) return;
    const id = project.id;
    const [repos, docs] = await Promise.all([call<Repository[]>('repositories.list', { projectId: id }), call<DocumentSummary[]>('documents.list', { projectId: id })]);
    if (projectRef.current === id) { setRepositories(repos); setDocuments(docs); }
  }
  async function saveSystem() {
    if (!system || !savedSystem || !project || saving) return;
    setSaving(true); setError('');
    const snapshot = system;
    try {
      const saved = await call<SystemModel>('system.save', { projectId: project.id, system: snapshot, expectedRevision: savedSystem.revision });
      if (projectRef.current !== project.id) return;
      setSavedSystem(saved); setSystem(current => current === snapshot ? saved : current && { ...current, revision: saved.revision }); notify('System saved');
    } catch (e) { setError(`${message(e)} Your edits are still here. Discard to reload the latest saved system, or keep editing.`); }
    finally { setSaving(false); }
  }
  async function discard() {
    if (!project || (dirty && !window.confirm('Discard your unsaved system changes?'))) return;
    const snapshot = systemRef.current;
    try { const fresh = await call<SystemModel>('system.get', { projectId: project.id }); if (projectRef.current === project.id && systemRef.current === snapshot) { setSystem(fresh); setSavedSystem(fresh); setError(''); } } catch (e) { setError(message(e)); }
  }
  async function acceptDraft(draft: SystemDraft) {
    if (!project || !savedSystem) return;
    if (dirty && !window.confirm('Accepting this draft will replace your unsaved system edits. Continue?')) return;
    const snapshot = systemRef.current;
    const next = await call<SystemModel>('drafts.accept', { projectId: project.id, draftId: draft.id, expectedRevision: savedSystem.revision });
    if (projectRef.current !== project.id) return;
    setSystem(current => current === snapshot ? next : current && { ...current, revision: next.revision }); setSavedSystem(next); setDrafts(items => items.filter(item => item.id !== draft.id)); notify('Agent draft accepted and saved');
  }
  async function deleteDraft(draft: SystemDraft) {
    if (!project) return;
    await call('drafts.delete', { projectId: project.id, draftId: draft.id });
    setDrafts(items => items.filter(item => item.id !== draft.id));
  }
  async function createProject(event: React.FormEvent) {
    event.preventDefault(); if (!projectName.trim()) return; setCreating(true); setModalError('');
    try { const next = await call<Project>('projects.create', { name: projectName.trim() }); setProjects(items => [...items, next]); setProjectName(''); await chooseProject(next); }
    catch (e) { setModalError(message(e)); } finally { setCreating(false); }
  }
  async function deleteProject(item: Project) {
    if (!window.confirm(`Delete “${item.name}” and its stored documents, system, and drafts? Repository source folders will stay on disk.`)) return;
    setModalError('');
    try {
      await call('projects.delete', { projectId: item.id });
      const remaining = projects.filter(p => p.id !== item.id); setProjects(remaining);
      if (project?.id === item.id) { projectRef.current = null; setProject(null); setSystem(null); setSavedSystem(null); if (remaining[0]) await chooseProject(remaining[0], true); }
    } catch (e) { setModalError(message(e)); }
  }
  return <div className="app-shell">
    <aside className="navigation">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setView('system'); }}><img src={mark} alt=""/><span>hyperbench</span></a>
      <button className="project-switcher" onClick={() => { setModal('projects'); setModalError(''); }}><span className="project-avatar">{project?.name.slice(0, 1).toUpperCase() || '+'}</span><span><strong>{project?.name || 'Choose a project'}</strong></span><Icon name="chevron" size={15}/></button>

      <nav aria-label="Workspace navigation">
        <button className={`nav-item ${view === 'system' ? 'active' : ''}`} onClick={() => setView('system')}><Icon name="system"/>System<span className="nav-count">{system?.components.length || '—'}</span></button>
        <button className={`nav-item ${view === 'repositories' ? 'active' : ''}`} onClick={() => setView('repositories')}><Icon name="code"/>Repositories<span className="nav-count">{repositories.length || '—'}</span></button>
        <button className={`nav-item ${view === 'documents' ? 'active' : ''}`} onClick={() => setView('documents')}><Icon name="document"/>Documents<span className="nav-count">{documents.length || '—'}</span></button>
      </nav>
      <div className="nav-spacer"/>
      <div className="agent-connect"><Button icon="plug" onClick={() => setModal('connect')} disabled={!project || !config}>Connect agent</Button></div>
    </aside>
    <div className="workspace-shell">
      <header className="topbar"><div className="breadcrumb"><span>{project?.name || 'Workspace'}</span><span className="slash">/</span><strong>{view === 'system' ? 'System' : view === 'repositories' ? 'Repositories' : 'Documents'}</strong></div><div className="topbar-actions">{project && <span className={`save-status ${dirty ? 'unsaved' : ''}`}><span className="status-dot"/>{dirty ? 'Unsaved changes' : 'Saved'}</span>}</div></header>
      {error && <ErrorBanner onClose={() => setError('')}>{error}</ErrorBanner>}
      {busy ? <Loading>Opening your workspace…</Loading> : !project ? <div className="welcome"><h1>No projects</h1><Button variant="primary" icon="plus" onClick={() => setModal('projects')}>Create project</Button></div> : <>
        {view === 'system' && system && <SystemView key={project.id} project={project} system={system} savedSystem={savedSystem!} onChange={setSystem} repositories={repositories} documents={documents} dirty={dirty} saving={saving} onSave={saveSystem} onDiscard={discard} drafts={drafts} onAcceptDraft={acceptDraft} onDeleteDraft={deleteDraft} onNavigate={setView}/>}
        {view === 'repositories' && <RepositoryView key={project.id} project={project} repositories={repositories} onRefresh={refreshContext} system={system} onSystemChange={setSystem} notify={notify}/>}
        {view === 'documents' && <DocumentView key={project.id} project={project} documents={documents} repositories={repositories} onRefresh={refreshContext} system={system} onSystemChange={setSystem} notify={notify}/>}
      </>}
      {dirty && view !== 'system' && <div className="floating-save"><span><span className="status-dot"/>System has unsaved context links</span><Button onClick={discard} disabled={saving}>Discard</Button><Button variant="primary" icon="save" onClick={saveSystem} disabled={saving}>{saving ? 'Saving…' : 'Save system'}</Button></div>}
    </div>
    {modal === 'projects' && <Modal title="Your projects" onClose={() => setModal(null)}>
      {modalError && <ErrorBanner>{modalError}</ErrorBanner>}
      <div className="project-list">{projects.map(item => <div className={`project-row ${project?.id === item.id ? 'selected' : ''}`} key={item.id}><button onClick={() => chooseProject(item)}><span className="project-avatar">{item.name[0].toUpperCase()}</span><span><strong>{item.name}</strong><small>Created {new Date(item.createdAt).toLocaleDateString()}</small></span>{project?.id === item.id && <Badge tone="green">Current</Badge>}</button><IconButton name="trash" label={`Delete project ${item.name}`} onClick={() => deleteProject(item)}/></div>)}</div>
      <form onSubmit={createProject} className="new-project-form"><Field label="New project name"><input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="e.g. Flight controller" maxLength={120} required/></Field><Button variant="primary" icon="plus" type="submit" disabled={creating || !projectName.trim()}>{creating ? 'Creating…' : 'Create project'}</Button></form>
    </Modal>}
    {modal === 'connect' && project && config && <ConnectModal project={project} config={config} onClose={() => setModal(null)}/>}
    {toast && <div className="toast" role="status"><Icon name="check" size={17}/>{toast}</div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
