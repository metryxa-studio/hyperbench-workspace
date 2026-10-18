export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
export interface Repository {
  id: string;
  projectId: string;
  name: string;
  path: string;
  url?: string;
  revision?: string;
  branch?: string;
  createdAt: string;
}
export interface TestBench {
  id: string;
  projectId: string;
  name: string;
  description: string;
  host: string;
  port: number;
  username?: string;
  identityFile?: string;
  knownHostsFile?: string;
  enabled: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface BenchCommandResult {
  benchId: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}
export interface DocumentSummary {
  id: string;
  projectId: string;
  name: string;
  mime: string;
  bytes: number;
  pageCount: number;
  sha256: string;
  coverage: string;
  createdAt: string;
}
export interface DocumentPage {
  page: number;
  text: string;
}
export interface DocumentContent {
  document: DocumentSummary;
  pages: DocumentPage[];
}
export type Evidence =
  | {
      type: "source";
      repositoryId: string;
      path: string;
      line?: number;
      endLine?: number;
    }
  | { type: "document"; documentId: string; page?: number; excerpt?: string };
export interface Component {
  id: string;
  label: string;
  kind: "hardware" | "software" | "external";
  description: string;
  x: number;
  y: number;
  ports: string[];
  evidence: Evidence[];
}
export interface Connection {
  id: string;
  from: string;
  to: string;
  label: string;
  fromPort?: string;
  toPort?: string;
  evidence: Evidence[];
}
export interface DocumentLink {
  id: string;
  documentId: string;
  page?: number;
  componentId?: string;
  repositoryId?: string;
  path?: string;
  line?: number;
  note: string;
}
export const SYSTEM_LAYOUTS = [
  "blank",
  "quadrotor",
  "hexarotor",
  "octorotor",
  "fixed-wing",
  "robot-arm",
  "truck",
] as const;
export type SystemLayout = (typeof SYSTEM_LAYOUTS)[number];
export interface SystemModel {
  revision: number;
  title: string;
  layout: SystemLayout;
  components: Component[];
  connections: Connection[];
  links: DocumentLink[];
}
export interface SystemDraft {
  id: string;
  projectId: string;
  baseRevision: number;
  summary: string;
  system: SystemModel;
  createdAt: string;
}
export interface SourceRead {
  repositoryId: string;
  path: string;
  revision?: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  text: string;
  truncated: boolean;
}
export interface SearchHit {
  path: string;
  line: number;
  text: string;
}
export interface RepositorySearch {
  hits: SearchHit[];
  truncated: boolean;
  searchedFiles: number;
}
export interface FileList {
  paths: string[];
  truncated: boolean;
}
export type Args = Record<string, unknown>;
