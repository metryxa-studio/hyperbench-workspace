import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import type { Args, Component, Connection, DocumentLink, DocumentSummary, Evidence, Project, Repository, SystemDraft, SystemModel } from '../types.ts';
import { boundedInteger, cloneRepository, localDirectory, repositoryDetails, repositoryFiles, repositoryRead, repositorySearch, validateSourceReference } from './repositories.ts';
import { processDocument, renderDocumentPage } from './documents.ts';

const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
type Row = Record<string, any>;
function object(value: unknown, label: string): Args {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Args;
}
function string(value: unknown, label: string, max = 1000, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || value.includes('\0')) throw new Error(`${label} must be ${allowEmpty ? 'a string' : 'nonempty text'} of at most ${max.toLocaleString()} characters.`);
  return value;
}
function id(value: unknown, label = 'ID'): string { return string(value, label, 200); }
function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} must be a list with at most ${max} items.`);
  return value;
}
function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000) throw new Error(`${label} must be a finite number between -1,000,000 and 1,000,000.`);
  return value;
}
function unique(items: {id:string}[], label: string): void {
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error(`${label} contain duplicate IDs.`);
}
function initialSystem(): SystemModel { return { revision: 0, title: 'System', layout: 'blank', components: [], connections: [], links: [] }; }
function summary(row: Row): DocumentSummary {
  return { id: row.id, projectId: row.projectId, name: row.name, mime: row.mime, bytes: row.bytes, pageCount: row.pageCount, sha256: row.sha256, coverage: row.coverage, createdAt: row.createdAt };
}

export class Workspace {
  readonly dataDir: string;
  private readonly db: DatabaseSync;
  private readonly documentDir: string;
  private closed = false;

  constructor(dataDir: string) {
    if (typeof dataDir !== 'string' || !isAbsolute(dataDir) || dataDir.includes('\0')) throw new Error('Workspace data directory must be an absolute path.');
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.dataDir = realpathSync(dataDir);
    this.documentDir = join(this.dataDir, 'documents');
    if (existsSync(this.documentDir) && lstatSync(this.documentDir).isSymbolicLink()) throw new Error('Workspace document storage must not be a symlink.');
    mkdirSync(this.documentDir, { recursive: true, mode: 0o700 });
    const database = join(this.dataDir, 'workspace.sqlite');
    if (existsSync(database) && lstatSync(database).isSymbolicLink()) throw new Error('Workspace database must not be a symlink.');
    this.db = new DatabaseSync(database);
    chmodSync(database, 0o600);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS repositories(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,name TEXT NOT NULL,path TEXT NOT NULL,url TEXT,createdAt TEXT NOT NULL,UNIQUE(projectId,path));
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,name TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL,pageCount INTEGER NOT NULL,sha256 TEXT NOT NULL,coverage TEXT NOT NULL,filename TEXT NOT NULL UNIQUE,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS document_pages(documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,page INTEGER NOT NULL,text TEXT NOT NULL,PRIMARY KEY(documentId,page));
      CREATE TABLE IF NOT EXISTS systems(projectId TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,revision INTEGER NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,baseRevision INTEGER NOT NULL,summary TEXT NOT NULL,body TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS repositories_project ON repositories(projectId);
      CREATE INDEX IF NOT EXISTS documents_project ON documents(projectId);
      CREATE INDEX IF NOT EXISTS drafts_project ON drafts(projectId);`);
  }

  close(): void { if (!this.closed) { this.db.close(); this.closed = true; } }
  private assertOpen(): void { if (this.closed) throw new Error('This workspace has been closed.'); }
  private get(sql: string, ...parameters: any[]): Row | undefined { return this.db.prepare(sql).get(...parameters) as Row | undefined; }
  private all(sql: string, ...parameters: any[]): Row[] { return this.db.prepare(sql).all(...parameters) as Row[]; }
  private transaction<T>(body: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = body(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private project(value: unknown): Project {
    const projectId = id(value, 'Project ID');
    const project = this.get('SELECT * FROM projects WHERE id=?', projectId);
    if (!project) throw new Error('Project does not exist.');
    return project as Project;
  }
  private repository(projectId: string, value: unknown): Repository {
    const repository = this.get('SELECT * FROM repositories WHERE id=? AND projectId=?', id(value, 'Repository ID'), projectId);
    if (!repository) throw new Error('Repository does not exist in this project.');
    return { ...repository, url: repository.url ?? undefined } as Repository;
  }
  private document(projectId: string, value: unknown): Row {
    const document = this.get('SELECT * FROM documents WHERE id=? AND projectId=?', id(value, 'Document ID'), projectId);
    if (!document) throw new Error('Document does not exist in this project.');
    return document;
  }
  private system(projectId: string): SystemModel {
    const row = this.get('SELECT body FROM systems WHERE projectId=?', projectId);
    return row ? JSON.parse(row.body) as SystemModel : initialSystem();
  }
  private draft(projectId: string, value: unknown): SystemDraft {
    const row = this.get('SELECT * FROM drafts WHERE id=? AND projectId=?', id(value, 'Draft ID'), projectId);
    if (!row) throw new Error('Draft does not exist in this project.');
    return { id: row.id, projectId: row.projectId, baseRevision: row.baseRevision, summary: row.summary, system: JSON.parse(row.body), createdAt: row.createdAt };
  }
  private page(document: Row, value: unknown): number | undefined {
    return value === undefined ? undefined : boundedInteger(value, 'Document page', 1, 1, document.pageCount);
  }
  private evidence(projectId: string, value: unknown): Evidence[] {
    return list(value, 'Evidence', 100).map(raw => {
      const evidence = object(raw, 'Evidence');
      if (evidence.type === 'source') {
        const repository = this.repository(projectId, evidence.repositoryId);
        const path = validateSourceReference(repository.path, evidence.path);
        const line = evidence.line === undefined ? undefined : boundedInteger(evidence.line, 'Evidence line', 1, 1, 10_000_000);
        const endLine = evidence.endLine === undefined ? undefined : boundedInteger(evidence.endLine, 'Evidence end line', line ?? 1, line ?? 1, 10_000_000);
        if (endLine !== undefined && line === undefined) throw new Error('Source evidence end line requires a start line.');
        return { type: 'source', repositoryId: repository.id, path, ...(line === undefined ? {} : { line }), ...(endLine === undefined ? {} : { endLine }) };
      }
      if (evidence.type === 'document') {
        const document = this.document(projectId, evidence.documentId);
        const page = this.page(document, evidence.page);
        const excerpt = evidence.excerpt === undefined ? undefined : string(evidence.excerpt, 'Evidence excerpt', 20_000, true);
        return { type: 'document', documentId: document.id, ...(page === undefined ? {} : { page }), ...(excerpt === undefined ? {} : { excerpt }) };
      }
      throw new Error('Evidence type must be source or document.');
    });
  }
  private validateSystem(projectId: string, value: unknown, revision: number): SystemModel {
    const model = object(value, 'System');
    if (JSON.stringify(model).length > 2_000_000) throw new Error('System exceeds the 2 MB size limit.');
    const title = string(model.title, 'System title', 500);
    if (typeof model.layout !== 'string' || !['blank', 'quadrotor', 'hexarotor'].includes(model.layout)) throw new Error('System layout must be blank, quadrotor, or hexarotor.');
    const components: Component[] = list(model.components, 'Components', 500).map(raw => {
      const component = object(raw, 'Component');
      if (typeof component.kind !== 'string' || !['hardware', 'software', 'external'].includes(component.kind)) throw new Error('Component kind must be hardware, software, or external.');
      const ports = list(component.ports, 'Component ports', 100).map(port => string(port, 'Port', 200));
      if (new Set(ports).size !== ports.length) throw new Error('Component ports must be unique.');
      return { id: id(component.id, 'Component ID'), label: string(component.label, 'Component label', 1000), kind: component.kind as Component['kind'], description: string(component.description, 'Component description', 20_000, true), x: number(component.x, 'Component x'), y: number(component.y, 'Component y'), ports, evidence: this.evidence(projectId, component.evidence) };
    });
    unique(components, 'Components');
    const componentById = new Map(components.map(component => [component.id, component]));
    const connections: Connection[] = list(model.connections, 'Connections', 2000).map(raw => {
      const connection = object(raw, 'Connection');
      const from = id(connection.from, 'Connection source');
      const to = id(connection.to, 'Connection target');
      const source = componentById.get(from), target = componentById.get(to);
      if (!source || !target) throw new Error('Connections must refer to existing components in this system.');
      const fromPort = connection.fromPort === undefined ? undefined : string(connection.fromPort, 'Source port', 200);
      const toPort = connection.toPort === undefined ? undefined : string(connection.toPort, 'Target port', 200);
      if (fromPort && !source.ports.includes(fromPort)) throw new Error('Connection source port does not exist on its component.');
      if (toPort && !target.ports.includes(toPort)) throw new Error('Connection target port does not exist on its component.');
      return { id: id(connection.id, 'Connection ID'), from, to, label: string(connection.label, 'Connection label', 1000, true), ...(fromPort === undefined ? {} : { fromPort }), ...(toPort === undefined ? {} : { toPort }), evidence: this.evidence(projectId, connection.evidence) };
    });
    unique(connections, 'Connections');
    const links: DocumentLink[] = list(model.links, 'Document links', 2000).map(raw => {
      const link = object(raw, 'Document link');
      const document = this.document(projectId, link.documentId);
      const page = this.page(document, link.page);
      const componentId = link.componentId === undefined ? undefined : id(link.componentId, 'Linked component ID');
      if (componentId && !componentById.has(componentId)) throw new Error('Document link component does not exist in this system.');
      const repository = link.repositoryId === undefined ? undefined : this.repository(projectId, link.repositoryId);
      if ((link.path !== undefined || link.line !== undefined) && !repository) throw new Error('A document source link requires a repository.');
      if (link.line !== undefined && link.path === undefined) throw new Error('A document source line requires a file path.');
      const path = link.path === undefined ? undefined : validateSourceReference(repository!.path, link.path);
      const line = link.line === undefined ? undefined : boundedInteger(link.line, 'Linked source line', 1, 1, 10_000_000);
      return { id: id(link.id, 'Document link ID'), documentId: document.id, note: string(link.note, 'Document link note', 20_000, true), ...(page === undefined ? {} : { page }), ...(componentId === undefined ? {} : { componentId }), ...(repository === undefined ? {} : { repositoryId: repository.id }), ...(path === undefined ? {} : { path }), ...(line === undefined ? {} : { line }) };
    });
    unique(links, 'Document links');
    return { revision, title, layout: model.layout as SystemModel['layout'], components, connections, links };
  }
  private save(projectId: string, value: unknown, expectedRevision: unknown): SystemModel {
    const expected = boundedInteger(expectedRevision, 'Expected revision', -1, 0, Number.MAX_SAFE_INTEGER - 1);
    if (expectedRevision === undefined) throw new Error('Expected revision is required to save a system.');
    const current = this.system(projectId);
    if (current.revision !== expected) throw new Error(`Revision conflict: expected ${expected}, but the saved system is revision ${current.revision}. Reload before saving.`);
    const system = this.validateSystem(projectId, value, current.revision + 1);
    this.db.prepare('INSERT INTO systems(projectId,revision,body) VALUES(?,?,?) ON CONFLICT(projectId) DO UPDATE SET revision=excluded.revision,body=excluded.body').run(projectId, system.revision, JSON.stringify(system));
    this.db.prepare('UPDATE projects SET updatedAt=? WHERE id=?').run(new Date().toISOString(), projectId);
    return system;
  }
  private assertUnreferenced(projectId: string, type: 'repository' | 'document', value: string): void {
    const models = [this.system(projectId), ...this.all('SELECT body FROM drafts WHERE projectId=?', projectId).map(row => JSON.parse(row.body) as SystemModel)];
    const references = (evidence: Evidence) => type === 'repository' ? evidence.type === 'source' && evidence.repositoryId === value : evidence.type === 'document' && evidence.documentId === value;
    if (models.some(model => model.components.some(component => component.evidence.some(references)) || model.connections.some(connection => connection.evidence.some(references)) || model.links.some(link => type === 'repository' ? link.repositoryId === value : link.documentId === value))) throw new Error(`This ${type} is referenced by the saved system or a draft. Remove those references and save, or delete the affected drafts, before deleting it.`);
  }

  private managedFile(row: Row, allowMissing = false): string {
    if (typeof row.filename !== 'string' || !/^[a-f0-9-]{36}\.bin$/u.test(row.filename)) throw new Error('Invalid stored document path.');
    const path = join(this.documentDir, row.filename);
    try {
      if (realpathSync(this.documentDir) !== this.documentDir || lstatSync(this.documentDir).isSymbolicLink()) throw new Error('Workspace document storage has changed.');
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || realpathSync(path) !== path) throw new Error('unsafe');
    } catch (error) {
      if (allowMissing && error instanceof Error && 'code' in error && error.code === 'ENOENT') return path;
      throw new Error('Stored document file is missing, unsafe, or unavailable.');
    }
    return path;
  }
  async documentFile(projectId: string, documentId: string): Promise<{path:string;mime:string;name:string}> {
    this.assertOpen();
    this.project(projectId);
    const document = this.document(projectId, documentId);
    return { path: this.managedFile(document), mime: document.mime, name: document.name };
  }
  private async importDocument(projectId: string, name: string, bytes: Buffer): Promise<DocumentSummary> {
    if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error('Document exceeds the 32 MiB import limit.');
    const result = await processDocument(bytes, name);
    const documentId = randomUUID();
    const filename = `${documentId}.bin`;
    if (realpathSync(this.documentDir) !== this.documentDir) throw new Error('Workspace document storage has changed.');
    const path = join(this.documentDir, filename);
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    try {
      return this.transaction(() => {
        this.project(projectId);
        const document: DocumentSummary = { id: documentId, projectId, name, mime: result.mime, bytes: bytes.length, pageCount: result.pageCount, sha256: createHash('sha256').update(bytes).digest('hex'), coverage: result.coverage, createdAt: new Date().toISOString() };
        this.db.prepare('INSERT INTO documents(id,projectId,name,mime,bytes,pageCount,sha256,coverage,filename,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)').run(document.id, projectId, name, document.mime, document.bytes, document.pageCount, document.sha256, document.coverage, filename, document.createdAt);
        const insert = this.db.prepare('INSERT INTO document_pages(documentId,page,text) VALUES(?,?,?)');
        for (const page of result.pages) insert.run(documentId, page.page, page.text);
        return document;
      });
    } catch (error) { await unlink(path).catch(() => {}); throw error; }
  }

  async call(method: string, value: unknown = {}): Promise<unknown> {
    this.assertOpen();
    try { return await this.dispatch(method, object(value, 'Arguments')); }
    catch (error) {
      if (error instanceof Error && ('code' in error || /SQLITE|database is locked|FOREIGN KEY|UNIQUE constraint/u.test(error.message))) {
        if (/locked|BUSY/u.test(error.message)) throw new Error('Workspace is busy with another write. Please retry.');
        throw new Error('The operation could not be completed. Check that the project and files still exist and that the workspace directory is writable.');
      }
      throw error instanceof Error ? error : new Error('The workspace operation failed.');
    }
  }
  private async dispatch(method: string, args: Args): Promise<unknown> {
    if (method === 'projects.list') return this.all('SELECT * FROM projects ORDER BY createdAt,id');
    if (method === 'projects.create') {
      const now = new Date().toISOString();
      const project: Project = { id: randomUUID(), name: string(args.name, 'Project name', 200).trim(), createdAt: now, updatedAt: now };
      this.db.prepare('INSERT INTO projects(id,name,createdAt,updatedAt) VALUES(?,?,?,?)').run(project.id, project.name, now, now);
      return project;
    }
    const known = new Set(['projects.rename','projects.delete','repositories.list','repositories.add','repositories.clone','repositories.remove','repositories.files','repositories.read','repositories.search','documents.list','documents.import','documents.upload','documents.read','documents.search','documents.page','documents.delete','system.get','system.save','drafts.list','drafts.propose','drafts.accept','drafts.delete']);
    if (!known.has(method)) throw new Error(`Unknown workspace method: ${String(method).slice(0, 100)}.`);
    const project = this.project(args.projectId);
    const projectId = project.id;
    switch (method) {
      case 'projects.rename': {
        this.db.prepare('UPDATE projects SET name=?,updatedAt=? WHERE id=?').run(string(args.name, 'Project name', 200).trim(), new Date().toISOString(), projectId);
        return this.project(projectId);
      }
      case 'projects.delete': {
        const files = this.transaction(() => {
          const files = this.all('SELECT * FROM documents WHERE projectId=?', projectId).map(row => this.managedFile(row, true));
          this.db.prepare('DELETE FROM projects WHERE id=?').run(projectId);
          return files;
        });
        for (const file of files) await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw new Error('Project context was removed, but a stored document could not be deleted. Check workspace directory permissions.'); });
        return { ok: true };
      }
      case 'repositories.list': {
        const repositories = this.all('SELECT * FROM repositories WHERE projectId=? ORDER BY createdAt,id', projectId);
        return Promise.all(repositories.map(async row => ({ ...row, url: row.url ?? undefined, ...await repositoryDetails(row.path) })));
      }
      case 'repositories.add':
      case 'repositories.clone': {
        const path = method === 'repositories.clone' ? await cloneRepository(args.url, args.destination) : await localDirectory(args.path);
        const repository = this.transaction(() => {
          this.project(projectId);
          const existing = this.get('SELECT * FROM repositories WHERE projectId=? AND path=?', projectId, path);
          if (existing) return { ...existing, url: existing.url ?? undefined } as Repository;
          const repository: Repository = { id: randomUUID(), projectId, name: basename(path) || path, path, ...(method === 'repositories.clone' ? { url: String(args.url) } : {}), createdAt: new Date().toISOString() };
          this.db.prepare('INSERT INTO repositories(id,projectId,name,path,url,createdAt) VALUES(?,?,?,?,?,?)').run(repository.id, projectId, repository.name, path, repository.url ?? null, repository.createdAt);
          return repository;
        });
        return { ...repository, ...await repositoryDetails(path) };
      }
      case 'repositories.remove': return this.transaction(() => {
        const repository = this.repository(projectId, args.repositoryId);
        this.assertUnreferenced(projectId, 'repository', repository.id);
        this.db.prepare('DELETE FROM repositories WHERE id=? AND projectId=?').run(repository.id, projectId);
        return { ok: true };
      });
      case 'repositories.files': return repositoryFiles(this.repository(projectId, args.repositoryId), args.query, args.limit, args.directory);
      case 'repositories.read': {
        const repository = this.repository(projectId, args.repositoryId);
        return repositoryRead({ ...repository, ...await repositoryDetails(repository.path) }, args.path, args.startLine, args.endLine);
      }
      case 'repositories.search': return repositorySearch(this.repository(projectId, args.repositoryId), args.query, args.limit, args.directory);
      case 'documents.list': return this.all('SELECT * FROM documents WHERE projectId=? ORDER BY createdAt,id', projectId).map(summary);
      case 'documents.import': {
        if (typeof args.path !== 'string' || !isAbsolute(args.path) || args.path.includes('\0')) throw new Error('Document path must be an absolute local file path.');
        let fd: number | undefined;
        let bytes: Buffer;
        try {
          const before = lstatSync(args.path);
          if (!before.isFile() || before.isSymbolicLink()) throw new Error('Document must be a regular file, not a symlink.');
          fd = openSync(args.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          const info = fstatSync(fd);
          if (!info.isFile()) throw new Error('Document must be a regular file.');
          const after = lstatSync(args.path);
          if (after.isSymbolicLink() || info.dev !== before.dev || info.ino !== before.ino || info.dev !== after.dev || info.ino !== after.ino) throw new Error('Document changed during import. Retry once it has finished saving.');
          if (info.size > MAX_DOCUMENT_BYTES) throw new Error('Document exceeds the 32 MiB import limit.');
          const buffer = Buffer.alloc(Math.min(info.size + 1, MAX_DOCUMENT_BYTES + 1));
          let count = 0;
          while (count < buffer.length) { const read = readSync(fd, buffer, count, buffer.length - count, null); if (!read) break; count += read; }
          if (count > info.size) throw new Error('Document changed during import. Retry once it has finished saving.');
          bytes = buffer.subarray(0, count);
        } catch (error) { if (error instanceof Error && !('code' in error)) throw error; throw new Error('Document file is unavailable, is a symlink, or cannot be read.'); }
        finally { if (fd !== undefined) closeSync(fd); }
        return this.importDocument(projectId, string(basename(args.path), 'Document name', 255), bytes);
      }
      case 'documents.upload': {
        const name = string(args.name, 'Document name', 255);
        if (name === '.' || name === '..' || /[\\/\x00-\x1f]/u.test(name)) throw new Error('Document name must be a filename without directories or control characters.');
        if (typeof args.base64 !== 'string' || args.base64.length > Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 || args.base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/u.test(args.base64)) throw new Error('Document upload must be valid base64 and no larger than 32 MiB.');
        const firstPadding = args.base64.indexOf('=');
        if (firstPadding !== -1 && (firstPadding < args.base64.length - 2 || !/^={1,2}$/u.test(args.base64.slice(firstPadding)))) throw new Error('Document upload contains invalid base64 padding.');
        return this.importDocument(projectId, name, Buffer.from(args.base64, 'base64'));
      }
      case 'documents.read': {
        const document = this.document(projectId, args.documentId);
        const page = this.page(document, args.page);
        const pages = page === undefined ? this.all('SELECT page,text FROM document_pages WHERE documentId=? ORDER BY page', document.id) : this.all('SELECT page,text FROM document_pages WHERE documentId=? AND page=?', document.id, page);
        if (page !== undefined && pages.length === 0) throw new Error('This page is outside the extracted text coverage. Use the original document or render the page.');
        return { document: summary(document), pages };
      }
      case 'documents.search': {
        const query = string(args.query, 'Document search query', 1000);
        const limit = boundedInteger(args.limit, 'Document search limit', 100, 1, 500);
        const escaped = query.replace(/[\\%_]/gu, match => `\\${match}`);
        const rows = this.all("SELECT documents.id AS documentId,documents.name,document_pages.page,document_pages.text FROM document_pages JOIN documents ON documents.id=document_pages.documentId WHERE documents.projectId=? AND document_pages.text LIKE ? ESCAPE '\\' ORDER BY documents.createdAt,documents.id,document_pages.page LIMIT ?", projectId, `%${escaped}%`, limit + 1);
        return { hits: rows.slice(0, limit).map(row => {
          const found = String(row.text).toLowerCase().indexOf(query.toLowerCase());
          const begin = Math.max(0, found - 200);
          return { ...row, text: `${begin ? '…' : ''}${String(row.text).slice(begin, begin + 2000)}${String(row.text).length > begin + 2000 ? '…' : ''}` };
        }), truncated: rows.length > limit };
      }
      case 'documents.page': {
        const document = this.document(projectId, args.documentId);
        if (document.mime !== 'application/pdf') throw new Error('Page images are available for PDF documents.');
        if (args.page === undefined) throw new Error('Document page is required.');
        const page = this.page(document, args.page)!;
        return renderDocumentPage(this.managedFile(document), page, args.scale as number | undefined, args.crop as {x:number;y:number;width:number;height:number} | undefined);
      }
      case 'documents.delete': {
        const path = this.transaction(() => {
          const document = this.document(projectId, args.documentId);
          this.assertUnreferenced(projectId, 'document', document.id);
          const path = this.managedFile(document, true);
          this.db.prepare('DELETE FROM documents WHERE id=? AND projectId=?').run(document.id, projectId);
          return path;
        });
        await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw new Error('Document was unlinked, but the stored file could not be deleted. Check workspace directory permissions.'); });
        return { ok: true };
      }
      case 'system.get': return this.system(projectId);
      case 'system.save': return this.transaction(() => { this.project(projectId); return this.save(projectId, args.system, args.expectedRevision); });
      case 'drafts.list': return this.all('SELECT id FROM drafts WHERE projectId=? ORDER BY createdAt,id', projectId).map(row => this.draft(projectId, row.id));
      case 'drafts.propose': return this.transaction(() => {
        this.project(projectId);
        if (args.baseRevision === undefined) throw new Error('Draft base revision is required.');
        const baseRevision = boundedInteger(args.baseRevision, 'Draft base revision', -1, 0, Number.MAX_SAFE_INTEGER - 1);
        const current = this.system(projectId);
        if (baseRevision !== current.revision) throw new Error(`Revision conflict: the saved system is revision ${current.revision}. Read it before proposing a draft.`);
        if (Number(this.get('SELECT count(*) AS count FROM drafts WHERE projectId=?', projectId)?.count) >= 100) throw new Error('This project has 100 drafts. Delete or accept drafts before proposing another.');
        const draft: SystemDraft = { id: randomUUID(), projectId, baseRevision, summary: string(args.summary, 'Draft summary', 10_000), system: this.validateSystem(projectId, args.system, baseRevision), createdAt: new Date().toISOString() };
        this.db.prepare('INSERT INTO drafts(id,projectId,baseRevision,summary,body,createdAt) VALUES(?,?,?,?,?,?)').run(draft.id, projectId, baseRevision, draft.summary, JSON.stringify(draft.system), draft.createdAt);
        return draft;
      });
      case 'drafts.accept': return this.transaction(() => {
        this.project(projectId);
        const draft = this.draft(projectId, args.draftId);
        if (draft.baseRevision !== this.system(projectId).revision) throw new Error('Draft is stale because the saved system has changed. Ask your agent for a new draft using the current revision.');
        const saved = this.save(projectId, draft.system, args.expectedRevision);
        this.db.prepare('DELETE FROM drafts WHERE id=? AND projectId=?').run(draft.id, projectId);
        return saved;
      });
      case 'drafts.delete': return this.transaction(() => {
        const draft = this.draft(projectId, args.draftId);
        this.db.prepare('DELETE FROM drafts WHERE id=? AND projectId=?').run(draft.id, projectId);
        return { ok: true };
      });
      default: throw new Error('Unknown workspace method.');
    }
  }
}
