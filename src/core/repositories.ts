import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  readSync,
} from "node:fs";
import { mkdir, opendir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  FileList,
  Repository,
  RepositorySearch,
  SourceRead,
} from "../types.ts";

const run = promisify(execFile);
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_WALK_ENTRIES = 25_000;
const MAX_SEARCH_BYTES = 32 * 1024 * 1024;
const SKIP = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".next",
  ".cache",
  "__pycache__",
  ".ds_store",
]);
const CREDENTIAL_DIRECTORIES = new Set([
  ".ssh",
  ".aws",
  ".azure",
  ".kube",
  ".gnupg",
]);
const CREDENTIAL_FILES = new Set([
  ".npmrc",
  ".netrc",
  ".pypirc",
  "credentials",
  "credentials.json",
  "credentials.yml",
  "credentials.yaml",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);
function credentialPath(path: string): boolean {
  return path.split(/[\\/]/u).some((raw) => {
    const part = raw.toLowerCase();
    return (
      CREDENTIAL_DIRECTORIES.has(part) ||
      CREDENTIAL_FILES.has(part) ||
      (/^\.env(?:\.|$)/u.test(part) &&
        !/\.(?:example|sample|template)$/u.test(part)) ||
      /\.(?:pem|key|p12|pfx|keystore|jks)$/u.test(part) ||
      /^private[-_]key(?:\.|$)/u.test(part)
    );
  });
}
const contains = (root: string, path: string) =>
  path === root ||
  (!relative(root, path).startsWith(`..${sep}`) &&
    relative(root, path) !== ".." &&
    !isAbsolute(relative(root, path)));

export function boundedInteger(
  value: unknown,
  label: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  return value;
}

export function relativeSourcePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4096 ||
    /[\\\x00-\x1f]/u.test(value) ||
    isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(
      "Source path must be a relative file path without traversal or symlinks.",
    );
  if (credentialPath(value))
    throw new Error(
      "Credential files are outside the source context. Use your own local tools if you need to inspect them.",
    );
  if (
    value
      .split("/")
      .some((part) => [".git", ".hg", ".svn"].includes(part.toLowerCase()))
  )
    throw new Error("Version-control metadata is outside the source context.");
  return value;
}

export function checkRoot(root: string): void {
  try {
    const entry = lstatSync(root);
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      realpathSync(root) !== root
    )
      throw new Error("changed");
  } catch {
    throw new Error(
      "The linked repository directory is unavailable or has changed. Relink the directory.",
    );
  }
}
export function openSource(root: string, path: string): number {
  checkRoot(root);
  const relativePath = relativeSourcePath(path);
  const target = resolve(root, relativePath);
  if (!contains(root, target))
    throw new Error("Source path leaves the linked repository.");
  let fd: number | undefined;
  try {
    let current = root;
    for (const segment of relativePath.split("/")) {
      current = join(current, segment);
      if (lstatSync(current).isSymbolicLink())
        throw new Error("Symlink paths are not supported.");
    }
    fd = openSync(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = fstatSync(fd);
    if (!info.isFile()) throw new Error("Source path is not a regular file.");
    if (
      realpathSync(target) !== target ||
      !contains(root, realpathSync(target))
    )
      throw new Error("Source path changed or leaves the linked repository.");
    checkRoot(root);
    const currentFile = lstatSync(target);
    if (
      currentFile.dev !== info.dev ||
      currentFile.ino !== info.ino ||
      !currentFile.isFile() ||
      currentFile.isSymbolicLink()
    )
      throw new Error(
        "Source file changed during access. Retry the operation.",
      );
    return fd;
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if (error instanceof Error && !("code" in error)) throw error;
    throw new Error(
      "Source file is unavailable, is not a regular file, or cannot be read.",
    );
  }
}

export function validateSourceReference(root: string, path: unknown): string {
  const normalized = relativeSourcePath(path);
  const fd = openSource(root, normalized);
  closeSync(fd);
  return normalized;
}

export function decodeText(bytes: Uint8Array): string {
  if (bytes.includes(0))
    throw new Error("Binary files cannot be read or searched as source text.");
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u.test(text))
      throw new Error("Private key material is outside the source context.");
    const controls = (text.match(/[\x01-\x08\x0b\x0e-\x1f]/gu) ?? []).length;
    if (controls > Math.max(1, text.length * 0.001)) throw new Error("binary");
    return text;
  } catch {
    throw new Error("The file is binary or is not valid UTF-8 text.");
  }
}

async function sourceText(root: string, path: string): Promise<string> {
  const fd = openSource(root, path);
  try {
    if (fstatSync(fd).size > MAX_SOURCE_BYTES)
      throw new Error(
        `Source file exceeds the ${MAX_SOURCE_BYTES / 1024 / 1024} MiB read limit.`,
      );
    const buffer = Buffer.alloc(MAX_SOURCE_BYTES + 1);
    let count = 0;
    while (count < buffer.length) {
      const bytes = readSync(fd, buffer, count, buffer.length - count, null);
      if (!bytes) break;
      count += bytes;
    }
    if (count > MAX_SOURCE_BYTES)
      throw new Error("Source file exceeds the 2 MiB read limit.");
    return decodeText(buffer.subarray(0, count));
  } finally {
    closeSync(fd);
  }
}

async function* walk(
  root: string,
  directoryScope?: unknown,
): AsyncGenerator<{ path: string; exhausted?: boolean }> {
  checkRoot(root);
  let scope = "";
  if (directoryScope !== undefined && directoryScope !== "") {
    scope = relativeSourcePath(directoryScope);
    let location = root;
    for (const segment of scope.split("/")) {
      location = join(location, segment);
      const entry = lstatSync(location);
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        realpathSync(location) !== location ||
        !contains(root, location)
      )
        throw new Error(
          "Search scope must be a real directory inside the linked repository.",
        );
    }
  }
  const queue = [scope];
  let visited = 0;
  for (let index = 0; index < queue.length; index++) {
    const directory = queue[index]!;
    let location = root;
    let safe = true;
    for (const segment of directory.split("/").filter(Boolean)) {
      location = join(location, segment);
      try {
        if (lstatSync(location).isSymbolicLink()) {
          safe = false;
          break;
        }
      } catch {
        safe = false;
        break;
      }
    }
    if (!safe) continue;
    const entries = [];
    let exhausted = false;
    try {
      const directoryHandle = await opendir(location);
      for await (const entry of directoryHandle) {
        if (++visited > MAX_WALK_ENTRIES) {
          exhausted = true;
          break;
        }
        entries.push(entry);
      }
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (
        SKIP.has(entry.name.toLowerCase()) ||
        credentialPath(entry.name) ||
        entry.isSymbolicLink() ||
        /[\\\x00-\x1f]/u.test(entry.name)
      )
        continue;
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) queue.push(path);
      else if (entry.isFile()) {
        try {
          const fd = openSource(root, path);
          closeSync(fd);
        } catch {
          continue;
        }
        yield { path };
      }
    }
    if (exhausted) {
      yield { path: "", exhausted: true };
      return;
    }
  }
}

export async function repositoryFiles(
  repository: Repository,
  query: unknown,
  requestedLimit: unknown,
  directory?: unknown,
): Promise<FileList> {
  const limit = boundedInteger(requestedLimit, "File limit", 500, 1, 2000);
  if (query !== undefined && (typeof query !== "string" || query.length > 1000))
    throw new Error(
      "File filter must be a string of at most 1,000 characters.",
    );
  const paths: string[] = [];
  for await (const item of walk(repository.path, directory)) {
    if (item.exhausted) return { paths, truncated: true };
    if (query && !item.path.toLowerCase().includes(String(query).toLowerCase()))
      continue;
    if (paths.length === limit) return { paths, truncated: true };
    paths.push(item.path);
  }
  return { paths, truncated: false };
}

export async function repositoryRead(
  repository: Repository,
  path: unknown,
  start: unknown,
  end: unknown,
): Promise<SourceRead> {
  const sourcePath = relativeSourcePath(path);
  const startLine = boundedInteger(start, "Start line", 1, 1, 10_000_000);
  const endLine = boundedInteger(
    end,
    "End line",
    startLine + 499,
    startLine,
    Math.min(10_000_000, startLine + 1999),
  );
  const content = await sourceText(repository.path, sourcePath);
  const lines = content.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (startLine > Math.max(1, lines.length))
    throw new Error(`Start line exceeds the file's ${lines.length} lines.`);
  const selected = lines.slice(startLine - 1, endLine);
  const retained: string[] = [];
  let characters = 0;
  let clipped = false;
  for (const line of selected) {
    const extra = line.length + (retained.length ? 1 : 0);
    if (characters + extra > 128_000) {
      if (!retained.length) retained.push(line.slice(0, 128_000));
      clipped = true;
      break;
    }
    retained.push(line);
    characters += extra;
  }
  const lastLine = startLine + retained.length - 1;
  return {
    repositoryId: repository.id,
    path: sourcePath,
    revision: repository.revision,
    startLine,
    endLine: lastLine,
    totalLines: lines.length,
    text: retained.join("\n"),
    truncated: clipped || lastLine < lines.length,
  };
}

export async function repositorySearch(
  repository: Repository,
  query: unknown,
  requestedLimit: unknown,
  directory?: unknown,
): Promise<RepositorySearch> {
  if (
    typeof query !== "string" ||
    !query ||
    query.length > 1000 ||
    /[\r\n\x00]/u.test(query)
  )
    throw new Error(
      "Search query must contain 1 to 1,000 characters on one line.",
    );
  const limit = boundedInteger(requestedLimit, "Search limit", 100, 1, 500);
  const hits: RepositorySearch["hits"] = [];
  let searchedFiles = 0;
  let inspectedFiles = 0;
  let bytes = 0;
  let incomplete = false;
  for await (const item of walk(repository.path, directory)) {
    if (item.exhausted || inspectedFiles >= 5000 || bytes >= MAX_SEARCH_BYTES)
      return { hits, truncated: true, searchedFiles };
    inspectedFiles++;
    let content: string;
    try {
      const size = lstatSync(join(repository.path, item.path)).size;
      if (size > MAX_SOURCE_BYTES) {
        incomplete = true;
        continue;
      }
      if (bytes + size > MAX_SEARCH_BYTES)
        return { hits, truncated: true, searchedFiles };
      bytes += size;
      content = await sourceText(repository.path, item.path);
    } catch {
      continue;
    }
    searchedFiles++;
    const lines = content.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      const match = line.indexOf(query);
      if (match === -1) continue;
      if (hits.length === limit)
        return { hits, truncated: true, searchedFiles };
      const begin = Math.max(0, match - 200);
      hits.push({
        path: item.path,
        line: index + 1,
        text: `${begin ? "…" : ""}${line.slice(begin, begin + 2000)}${line.length > begin + 2000 ? "…" : ""}`,
      });
    }
  }
  return { hits, truncated: incomplete, searchedFiles };
}

export async function repositoryDetails(
  path: string,
): Promise<Pick<Repository, "revision" | "branch">> {
  try {
    const result = await run(
      "git",
      [
        "-C",
        path,
        "rev-parse",
        "--show-toplevel",
        "HEAD",
        "--abbrev-ref",
        "HEAD",
      ],
      { timeout: 10_000, maxBuffer: 64 * 1024 },
    );
    const [top, revision, branch] = result.stdout.trim().split("\n");
    if (top && (await realpath(top)) === path) return { revision, branch };
  } catch {}
  return {};
}

export async function localDirectory(value: unknown): Promise<string> {
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0"))
    throw new Error(
      "Repository path must be an absolute local directory path.",
    );
  try {
    const path = await realpath(value);
    if (credentialPath(path)) throw new Error("credentials");
    if (!(await stat(path)).isDirectory()) throw new Error("directory");
    return path;
  } catch {
    throw new Error("Repository directory does not exist or cannot be read.");
  }
}

export async function cloneRepository(
  url: unknown,
  destination: unknown,
): Promise<string> {
  if (
    typeof url !== "string" ||
    !url ||
    url.length > 4096 ||
    /[\x00-\x1f\x7f]/u.test(url) ||
    (!isAbsolute(url) && url.includes(" ")) ||
    url.startsWith("-")
  )
    throw new Error(
      "Provide a valid Git URL or absolute local repository path.",
    );
  if (
    !isAbsolute(url) &&
    !/^(https:\/\/|ssh:\/\/|git:\/\/|file:\/\/|[\w.-]+@[\w.-]+:)/u.test(url)
  )
    throw new Error(
      "Git URL must use HTTPS, SSH, Git, file, or an absolute local path.",
    );
  if (/^(?:https|ssh|git|file):\/\//u.test(url)) {
    const parsed = new URL(url);
    if (
      parsed.search ||
      parsed.hash ||
      parsed.password ||
      (parsed.protocol === "https:" && parsed.username)
    )
      throw new Error(
        "Do not include credentials, query strings, or fragments in the Git URL. Use your configured Git credential helper.",
      );
  }
  if (
    typeof destination !== "string" ||
    !isAbsolute(destination) ||
    destination.includes("\0")
  )
    throw new Error("Clone destination must be a new absolute directory path.");
  const requestedTarget = resolve(destination);
  const parent = await localDirectory(resolve(requestedTarget, ".."));
  const target = join(parent, requestedTarget.split(sep).at(-1)!);
  try {
    lstatSync(target);
    throw new Error(
      "Clone destination already exists. Choose a new directory.",
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
  }
  try {
    await mkdir(target, { mode: 0o700 });
  } catch {
    throw new Error(
      "Clone destination could not be reserved. Choose a new, writable directory.",
    );
  }
  try {
    await run(
      "git",
      [
        "-c",
        "protocol.ext.allow=never",
        "-c",
        "core.hooksPath=/dev/null",
        "clone",
        "--",
        url,
        target,
      ],
      { timeout: 120_000, maxBuffer: 512 * 1024 },
    );
  } catch {
    throw new Error(
      "Git clone failed. Check the URL, native Git credentials, and destination. A partial destination may remain; existing folders were not overwritten.",
    );
  }
  return localDirectory(target);
}
