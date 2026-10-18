import React, { useEffect, useRef, useState } from "react";
import type { BenchCommandResult, Project, TestBench } from "../src/types";
import { call, message } from "./api";
import {
  Badge,
  Button,
  ErrorBanner,
  Field,
  Icon,
  Modal,
} from "./common";

type BenchForm = {
  name: string;
  description: string;
  host: string;
  port: string;
  username: string;
  identityFile: string;
  knownHostsFile: string;
  enabled: boolean;
};
const emptyForm: BenchForm = {
  name: "",
  description: "",
  host: "",
  port: "22",
  username: "",
  identityFile: "",
  knownHostsFile: "",
  enabled: false,
};
const displayLimit = 32_000;

function address(bench: TestBench) {
  const host = bench.host.includes(":") ? `[${bench.host}]` : bench.host;
  return `${bench.username ? `${bench.username}@` : ""}${host}:${bench.port}`;
}

export function BenchView({
  project,
  benches,
  onRefresh,
  notify,
}: {
  project: Project;
  benches: TestBench[];
  onRefresh: () => Promise<void>;
  notify: (text: string) => void;
}) {
  const [benchId, setBenchId] = useState(benches[0]?.id || "");
  const bench = benches.find((item) => item.id === benchId);
  const [modal, setModal] = useState<TestBench | "add" | null>(null);
  const [form, setForm] = useState<BenchForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [modalError, setModalError] = useState("");
  const [operation, setOperation] = useState<"test" | "execute" | "remove" | "refresh" | null>(null);
  const [command, setCommand] = useState("");
  const [timeoutSeconds, setTimeoutSeconds] = useState("30");
  const [result, setResult] = useState<{
    kind: "test" | "execute";
    value: BenchCommandResult;
  } | null>(null);
  const active = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!benches.some((item) => item.id === benchId)) {
      setBenchId(benches[0]?.id || "");
      setResult(null);
    }
  }, [benches, benchId]);

  function openForm(item?: TestBench) {
    setModal(item || "add");
    setModalError("");
    setForm(item ? {
      name: item.name,
      description: item.description,
      host: item.host,
      port: String(item.port),
      username: item.username || "",
      identityFile: item.identityFile || "",
      knownHostsFile: item.knownHostsFile || "",
      enabled: item.enabled,
    } : { ...emptyForm });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!modal || pending.current) return;
    pending.current = true;
    setSaving(true);
    setModalError("");
    let persisted = false;
    try {
      const saved = await call<TestBench>(
        modal === "add" ? "benches.add" : "benches.update",
        {
          projectId: project.id,
          ...(modal === "add" ? {} : {
            benchId: modal.id,
            expectedRevision: modal.revision,
          }),
          name: form.name.trim(),
          description: form.description.trim(),
          host: form.host.trim(),
          port: Number(form.port),
          username: form.username.trim() || undefined,
          identityFile: form.identityFile.trim() || undefined,
          knownHostsFile: form.knownHostsFile.trim() || undefined,
          enabled: form.enabled,
        },
      );
      persisted = true;
      if (!active.current) return;
      await onRefresh();
      if (!active.current) return;
      setBenchId(saved.id);
      setResult(null);
      setModal(null);
      notify(modal === "add" ? "Test bench added" : "Test bench saved");
    } catch (e) {
      if (active.current) {
        if (persisted) {
          setModal(null);
          setError(`The bench was saved, but the list could not refresh. ${message(e)}`);
        }
        else setModalError(message(e));
      }
    } finally {
      pending.current = false;
      if (active.current) setSaving(false);
    }
  }

  async function remove() {
    if (!bench || pending.current || !window.confirm(
      `Remove “${bench.name}” from this project? The remote bench and its files will stay in place.`,
    )) return;
    pending.current = true;
    setOperation("remove");
    setError("");
    try {
      await call("benches.remove", {
        projectId: project.id,
        benchId: bench.id,
        expectedRevision: bench.revision,
      });
      if (!active.current) return;
      await onRefresh();
      if (active.current) {
        setResult(null);
        notify("Test bench removed");
      }
    } catch (e) {
      if (active.current) setError(message(e));
    } finally {
      pending.current = false;
      if (active.current) setOperation(null);
    }
  }

  async function refresh() {
    if (pending.current) return;
    pending.current = true;
    setOperation("refresh");
    setError("");
    try {
      await onRefresh();
    } catch (e) {
      if (active.current) setError(message(e));
    } finally {
      pending.current = false;
      if (active.current) setOperation(null);
    }
  }

  async function run(kind: "test" | "execute") {
    if (!bench || pending.current || (kind === "execute" && (!bench.enabled || !command.trim()))) return;
    pending.current = true;
    setOperation(kind);
    setError("");
    setResult(null);
    try {
      const value = await call<BenchCommandResult>(`benches.${kind}`, {
        projectId: project.id,
        benchId: bench.id,
        ...(kind === "execute" ? { command, timeoutSeconds: Number(timeoutSeconds) } : {}),
      });
      if (active.current) setResult({ kind, value });
    } catch (e) {
      if (active.current) setError(message(e));
    } finally {
      pending.current = false;
      if (active.current) setOperation(null);
    }
  }

  const remoteBusy = operation === "test" || operation === "execute";
  const displayedResult = result?.value.benchId === bench?.id ? result : null;
  const succeeded = displayedResult && !displayedResult.value.timedOut && !displayedResult.value.truncated && displayedResult.value.exitCode === 0;

  return (
    <section className="resource-view bench-view">
      <header className="page-heading">
        <div>
          <h1>Test benches</h1>
          <p className="bench-page-description">Connect hardware hosts over SSH and make them available to your agent.</p>
        </div>
        <div className="heading-actions">
          <Button onClick={refresh} disabled={!!operation}>{operation === "refresh" ? "Refreshing…" : "Refresh"}</Button>
          <Button icon="plus" variant="primary" onClick={() => openForm()} disabled={!!operation}>Add test bench</Button>
        </div>
      </header>
      {error && <ErrorBanner onClose={() => setError("")}>{error}</ErrorBanner>}
      {!benches.length ? (
        <div className="empty-state bench-empty">
          <span className="bench-empty-icon"><Icon name="terminal" size={30} /></span>
          <h3>Bring your test bench into the workspace</h3>
          <p>Add an SSH host, verify the connection, and enable commands when the bench is ready.</p>
          <Button icon="plus" onClick={() => openForm()}>Add your first test bench</Button>
        </div>
      ) : (
        <div className="bench-workspace">
          <aside className="bench-list" aria-label="Test bench connections">
            <div className="bench-list-label">Connections <span>{benches.length}</span></div>
            {benches.map((item) => (
              <button
                key={item.id}
                className={`bench-choice ${item.id === benchId ? "selected" : ""}`}
                aria-pressed={item.id === benchId}
                disabled={!!operation}
                onClick={() => {
                  if (item.id === benchId) return;
                  setBenchId(item.id);
                  setResult(null);
                  setCommand("");
                  setError("");
                }}
              >
                <Icon name="terminal" size={19} />
                <span><strong>{item.name}</strong><small>{address(item)}</small><span className={`bench-availability ${item.enabled ? "enabled" : ""}`}>{item.enabled ? "Commands enabled" : "Commands disabled"}</span></span>
              </button>
            ))}
          </aside>
          {bench && <div className="bench-detail">
            <div className="bench-detail-heading">
              <div><h2>{bench.name}</h2><code>{address(bench)}</code></div>
              <div className="heading-actions">
                <Button icon="settings" onClick={() => openForm(bench)} disabled={!!operation}>Edit bench</Button>
                <Button icon="trash" variant="ghost" onClick={remove} disabled={!!operation}>{operation === "remove" ? "Removing…" : "Remove"}</Button>
              </div>
            </div>
            {bench.description && <p className="bench-description">{bench.description}</p>}
            <div className="bench-connection-panel">
              <div>
                <Badge tone={bench.enabled ? "green" : ""}>{bench.enabled ? "Available to your agent" : "Commands disabled"}</Badge>
                <p>{bench.enabled ? "Your connected agent can run shell commands on this bench using the bench tool." : "Test the connection now. Enable remote commands in Edit bench to use this bench as an agent tool."}</p>
              </div>
              <Button icon="plug" onClick={() => run("test")} disabled={!!operation}>{operation === "test" ? "Connecting…" : "Test connection"}</Button>
            </div>
            <form className="bench-command-form" onSubmit={(e) => { e.preventDefault(); void run("execute"); }}>
              <h3>Run a command</h3>
              <p>Commands run in the remote host’s shell using your SSH account.</p>
              <Field label="Shell command">
                <textarea value={command} onChange={(e) => setCommand(e.target.value)} placeholder="uname -a" rows={3} maxLength={16_000} required disabled={!bench.enabled || !!operation} spellCheck={false} />
              </Field>
              <div className="bench-command-actions">
                <Field label="Timeout (seconds)"><input type="number" min={1} max={300} required value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(e.target.value)} disabled={!bench.enabled || !!operation} /></Field>
                <Button type="submit" variant="primary" icon="terminal" disabled={!bench.enabled || !!operation || !command.trim()}>{operation === "execute" ? "Running…" : "Run command"}</Button>
              </div>
            </form>
            {remoteBusy && <div className="bench-progress" role="status"><span className="spinner" /><div>{operation === "test" ? "Checking SSH access…" : "Waiting for the remote command…"}<small>Leaving this view does not stop the remote command.</small></div></div>}
            {displayedResult && <section className="bench-result" aria-label="Command result">
              <div className="bench-result-heading" role="status">
                <strong>{displayedResult.value.timedOut ? "Command timed out" : displayedResult.value.truncated ? "Output limit reached" : displayedResult.kind === "test" ? (succeeded ? "Connection successful" : "Connection failed") : (succeeded ? "Command completed" : "Command failed")}</strong>
                <span>{displayedResult.value.exitCode !== null ? `Exit ${displayedResult.value.exitCode}` : displayedResult.value.signal || "No exit code"} · {(displayedResult.value.durationMs / 1000).toFixed(1)}s</span>
              </div>
              {displayedResult.kind === "execute" && <code className="bench-result-command">$ {displayedResult.value.command}</code>}
              {displayedResult.value.stdout && <div className="bench-output"><h4>Standard output</h4><pre tabIndex={0} aria-label="Standard output">{displayedResult.value.stdout.slice(0, displayLimit)}</pre></div>}
              {displayedResult.value.stderr && <div className="bench-output"><h4>Standard error</h4><pre tabIndex={0} aria-label="Standard error">{displayedResult.value.stderr.slice(0, displayLimit)}</pre></div>}
              {!displayedResult.value.stdout && !displayedResult.value.stderr && <p className="bench-output-empty">No output returned.</p>}
              {(displayedResult.value.truncated || displayedResult.value.stdout.length > displayLimit || displayedResult.value.stderr.length > displayLimit) && <p className="bench-output-note">Output was shortened to keep this result manageable.</p>}
            </section>}
            <p className="bench-auth-note"><Icon name="link" size={16} />Uses local SSH keys or your SSH agent and verifies the host against your known hosts. No passwords are stored.</p>
          </div>}
        </div>
      )}
      {modal && <Modal title={modal === "add" ? "Add test bench" : "Edit test bench"} onClose={() => { if (!saving) setModal(null); }}>
        <form onSubmit={save}>
          {modalError && <ErrorBanner>{modalError}</ErrorBanner>}
          <fieldset className="bench-fields" disabled={saving}>
            <Field label="Bench name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={200} placeholder="e.g. Motor controller bench" /></Field>
            <Field label="Description (optional)"><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} maxLength={20_000} placeholder="Hardware connected and tests available" /></Field>
            <div className="field-grid bench-host-fields">
              <Field label="SSH host or config alias"><input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required maxLength={253} placeholder="192.168.1.50 or lab-bench" autoCapitalize="none" spellCheck={false} /></Field>
              <Field label="Port"><input type="number" min={1} max={65535} required value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} /></Field>
            </div>
            <Field label="SSH username (optional)"><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} maxLength={64} placeholder="Use SSH config or local username" autoCapitalize="none" spellCheck={false} /></Field>
            <details className="bench-advanced" open={!!form.identityFile || !!form.knownHostsFile}>
              <summary>SSH key and host verification</summary>
              <Field label="Identity file (optional)"><input value={form.identityFile} onChange={(e) => setForm({ ...form, identityFile: e.target.value })} placeholder="~/.ssh/id_ed25519" spellCheck={false} /></Field>
              <Field label="Known hosts file (optional)"><input value={form.knownHostsFile} onChange={(e) => setForm({ ...form, knownHostsFile: e.target.value })} placeholder="Use your default known hosts" spellCheck={false} /></Field>
              <p>Paths are on the computer running Hyperbench. The host must already be trusted in the selected known hosts file.</p>
            </details>
            <label className="bench-enable"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /><span><strong>Enable remote commands for this bench</strong><small>Allow the app and your connected agent to execute shell commands with this SSH account’s permissions.</small></span></label>
          </fieldset>
          <div className="modal-actions"><Button type="button" onClick={() => setModal(null)} disabled={saving}>Cancel</Button><Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : modal === "add" ? "Add test bench" : "Save bench"}</Button></div>
        </form>
      </Modal>}
    </section>
  );
}
