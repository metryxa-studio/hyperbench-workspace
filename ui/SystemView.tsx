import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  Component,
  Connection,
  DocumentSummary,
  Evidence,
  Project,
  Repository,
  SystemDraft,
  SystemLayout,
  SystemModel,
} from "../src/types";
import { SYSTEM_LAYOUTS } from "../src/types";
import { message, newId } from "./api";
import {
  Badge,
  Button,
  Empty,
  ErrorBanner,
  Field,
  Icon,
  IconButton,
  Modal,
} from "./common";
import { EvidenceEditor, EvidencePreview, evidenceLabel } from "./Evidence";
import { DeviceOutline, OUTLINE_BOUNDS } from "./DeviceOutline";

const outlineLabels: Record<SystemLayout, string> = {
  blank: "Blank canvas",
  quadrotor: "Quadrotor",
  hexarotor: "Hexarotor",
  octorotor: "Octorotor",
  "fixed-wing": "Fixed-wing aircraft",
  "robot-arm": "Robot arm",
  truck: "Truck",
};

function parsePorts(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((port) => port.trim())
        .filter(Boolean),
    ),
  ];
}

function PortsInput({
  id,
  ports,
  readOnly,
  onChange,
}: {
  id?: string;
  ports: string[];
  readOnly: boolean;
  onChange: (ports: string[]) => void;
}) {
  const canonical = ports.join(", ");
  const [text, setText] = useState(canonical);
  useEffect(() => {
    setText((current) =>
      !readOnly && parsePorts(current).join(", ") === canonical
        ? current
        : canonical,
    );
  }, [canonical, readOnly]);
  return (
    <input
      id={id}
      aria-label="Ports"
      value={text}
      readOnly={readOnly}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parsePorts(event.target.value));
      }}
      onBlur={() => setText(canonical)}
      placeholder="UART, I2C, power"
    />
  );
}

function PortSelect({
  id,
  value,
  ports,
  readOnly,
  onChange,
}: {
  id?: string;
  value?: string;
  ports: string[];
  readOnly: boolean;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <select
      id={id}
      value={value || ""}
      disabled={readOnly}
      onChange={(event) => onChange(event.target.value || undefined)}
    >
      <option value="">None</option>
      {value && !ports.includes(value) && (
        <option value={value} disabled>
          {value} (removed)
        </option>
      )}
      {ports.map((port) => (
        <option key={port} value={port}>
          {port}
        </option>
      ))}
    </select>
  );
}

interface Props {
  project: Project;
  system: SystemModel;
  savedSystem: SystemModel;
  onChange: (model: SystemModel) => void;
  repositories: Repository[];
  documents: DocumentSummary[];
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  drafts: SystemDraft[];
  onAcceptDraft: (draft: SystemDraft) => Promise<boolean>;
  onDeleteDraft: (draft: SystemDraft) => Promise<void>;
  onNavigate: (view: "repositories" | "documents") => void;
}
type Selection = { type: "component" | "connection"; id: string } | null;
export function SystemView(props: Props) {
  const {
    project,
    system,
    savedSystem,
    onChange,
    repositories,
    documents,
    dirty,
    saving,
    onSave,
    onDiscard,
    drafts,
    onAcceptDraft,
    onDeleteDraft,
    onNavigate,
  } = props;
  const [selection, setSelection] = useState<Selection>(null);
  const [filter, setFilter] = useState<"all" | Component["kind"]>("all");
  const [viewport, setViewport] = useState({ x: 80, y: 90, scale: 1 });
  const [modal, setModal] = useState<
    "component" | "connection" | "evidence" | "drafts" | null
  >(null);
  const [preview, setPreview] = useState<Evidence | null>(null);
  const [draft, setDraft] = useState<SystemDraft | null>(null);
  const [error, setError] = useState(""),
    [working, setWorking] = useState(false);
  const [label, setLabel] = useState(""),
    [kind, setKind] = useState<Component["kind"]>("hardware");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [connectionLabel, setConnectionLabel] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const systemRef = useRef(system);
  systemRef.current = system;
  const dragRef = useRef<{
    id?: string;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
    scale: number;
  } | null>(null);
  const displayed = draft?.system || system;
  const hasOutline = filter === "all" && displayed.layout !== "blank";
  const visibleComponents = displayed.components.filter(
    (item) => filter === "all" || item.kind === filter,
  );
  const visibleIds = new Set(visibleComponents.map((item) => item.id));
  const component =
    selection?.type === "component"
      ? visibleComponents.find((item) => item.id === selection.id)
      : undefined;
  const connection =
    selection?.type === "connection"
      ? displayed.connections.find(
          (item) =>
            item.id === selection.id &&
            visibleIds.has(item.from) &&
            visibleIds.has(item.to),
        )
      : undefined;
  const selected = component || connection;
  const readOnly = !!draft;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        if (dirty && !saving && !readOnly) onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saving, readOnly, onSave]);
  function openComponent() {
    setKind(filter === "all" ? "hardware" : filter);
    setModal("component");
  }
  const updateComponent = (update: Partial<Component>) => {
    if (!component || readOnly) return;
    onChange({
      ...system,
      components: system.components.map((item) =>
        item.id === component.id ? { ...item, ...update } : item,
      ),
    });
    if (update.kind && filter !== "all" && update.kind !== filter)
      setFilter(update.kind);
  };
  const updateConnection = (update: Partial<Connection>) => {
    if (!connection || readOnly) return;
    const next = { ...connection, ...update };
    onChange({
      ...system,
      connections: system.connections.map((item) =>
        item.id === connection.id ? next : item,
      ),
    });
    if (!visibleIds.has(next.from) || !visibleIds.has(next.to))
      setFilter("all");
  };
  function addComponent(e: React.FormEvent) {
    e.preventDefault();
    const first = system.components.length === 0;
    const item: Component = {
      id: newId("component"),
      label: label.trim(),
      kind,
      description: "",
      x: first
        ? hasOutline
          ? (OUTLINE_BOUNDS.width - 224) / 2
          : 0
        : Math.max(20, (120 - viewport.x) / viewport.scale) +
          (system.components.length % 3) * 50,
      y: first
        ? hasOutline
          ? (OUTLINE_BOUNDS.height - 124) / 2
          : 0
        : Math.max(20, (120 - viewport.y) / viewport.scale) +
          (system.components.length % 5) * 45,
      ports: [],
      evidence: [],
    };
    if (first && !hasOutline) {
      const rect = canvasRef.current?.getBoundingClientRect();
      setViewport({
        x: Math.min(48, Math.max(16, ((rect?.width || 320) - 224) / 2)),
        y: Math.max(16, Math.min(64, ((rect?.height || 400) - 124) / 2)),
        scale: 1,
      });
    }
    onChange({ ...system, components: [...system.components, item] });
    if (filter !== "all" && filter !== kind) setFilter(kind);
    setSelection({ type: "component", id: item.id });
    setModal(null);
    setLabel("");
  }
  function removeSelected() {
    if (!selection || readOnly) return;
    if (selection.type === "component")
      onChange({
        ...system,
        components: system.components.filter(
          (item) => item.id !== selection.id,
        ),
        connections: system.connections.filter(
          (item) => item.from !== selection.id && item.to !== selection.id,
        ),
        links: system.links.filter((item) => item.componentId !== selection.id),
      });
    else
      onChange({
        ...system,
        connections: system.connections.filter(
          (item) => item.id !== selection.id,
        ),
      });
    setSelection(null);
  }
  function fit() {
    if ((!visibleComponents.length && !hasOutline) || !canvasRef.current) {
      setViewport({ x: 80, y: 90, scale: 1 });
      return;
    }
    const minX = Math.min(
        ...visibleComponents.map((c) => c.x),
        ...(hasOutline ? [OUTLINE_BOUNDS.x] : []),
      ),
      minY = Math.min(
        ...visibleComponents.map((c) => c.y),
        ...(hasOutline ? [OUTLINE_BOUNDS.y] : []),
      );
    const maxX = Math.max(
        ...visibleComponents.map((c) => c.x + 224),
        ...(hasOutline ? [OUTLINE_BOUNDS.width] : []),
      ),
      maxY = Math.max(
        ...visibleComponents.map((c) => c.y + 124),
        ...(hasOutline ? [OUTLINE_BOUNDS.height] : []),
      );
    const rect = canvasRef.current.getBoundingClientRect();
    const paddingX = rect.width < 600 ? 32 : 80;
    const scale = Math.min(
      1,
      Math.max(
        0.25,
        Math.min(
          (rect.width - paddingX) / Math.max(1, maxX - minX),
          (rect.height - 64) / Math.max(1, maxY - minY),
        ),
      ),
    );
    setViewport({
      x: (rect.width - (maxX - minX) * scale) / 2 - minX * scale,
      y: (rect.height - (maxY - minY) * scale) / 2 - minY * scale,
      scale,
    });
  }
  useLayoutEffect(() => {
    fit();
  }, [project.id, displayed.layout, draft?.id, filter]);
  function zoom(factor: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setViewport((v) => {
      const scale = Math.max(0.25, Math.min(2, v.scale * factor));
      return {
        scale,
        x: rect.width / 2 - ((rect.width / 2 - v.x) * scale) / v.scale,
        y: rect.height / 2 - ((rect.height / 2 - v.y) * scale) / v.scale,
      };
    });
  }
  function startPan(e: React.PointerEvent) {
    if (
      e.button !== 0 ||
      !(e.target === e.currentTarget || (e.target as HTMLElement).dataset.pan)
    )
      return;
    setSelection(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      x: viewport.x,
      y: viewport.y,
      scale: viewport.scale,
    };
  }
  function movePointer(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    if (d.id && !readOnly) {
      const next = systemRef.current;
      onChange({
        ...next,
        components: next.components.map((item) =>
          item.id === d.id
            ? {
                ...item,
                x: Math.round(d.x + (e.clientX - d.clientX) / d.scale),
                y: Math.round(d.y + (e.clientY - d.clientY) / d.scale),
              }
            : item,
        ),
      });
    } else if (!d.id)
      setViewport((v) => ({
        ...v,
        x: d.x + e.clientX - d.clientX,
        y: d.y + e.clientY - d.clientY,
      }));
  }
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = canvas.getBoundingClientRect();
        const anchorX = event.clientX - rect.left,
          anchorY = event.clientY - rect.top;
        setViewport((v) => {
          const scale = Math.max(
            0.25,
            Math.min(2, v.scale * (event.deltaY > 0 ? 0.93 : 1.07)),
          );
          return {
            scale,
            x: anchorX - ((anchorX - v.x) * scale) / v.scale,
            y: anchorY - ((anchorY - v.y) * scale) / v.scale,
          };
        });
      } else
        setViewport((v) => ({
          ...v,
          x: v.x - event.deltaX,
          y: v.y - event.deltaY,
        }));
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, []);
  const counts = (kind: string) =>
    displayed.components.filter((c) => c.kind === kind).length;
  async function accept(item: SystemDraft) {
    setWorking(true);
    setError("");
    try {
      if (!(await onAcceptDraft(item))) return;
      setDraft(null);
      setModal(null);
      setSelection(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setWorking(false);
    }
  }
  async function deleteItem(item: SystemDraft) {
    setWorking(true);
    setError("");
    try {
      await onDeleteDraft(item);
      if (draft?.id === item.id) setDraft(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setWorking(false);
    }
  }
  return (
    <section className="system-view">
      <div className="page-heading">
        <div>
          <h1>{system.title || project.name}</h1>
        </div>
        <div className="heading-actions">
          <Button icon="draft" onClick={() => setModal("drafts")}>
            Agent drafts
            {drafts.length > 0 && (
              <span className="button-count">{drafts.length}</span>
            )}
          </Button>
          <Button
            icon="plus"
            variant="primary"
            disabled={readOnly}
            onClick={openComponent}
          >
            Add component
          </Button>
        </div>
      </div>
      <div className="canvas-toolbar">
        <div className="canvas-view-controls">
          {filter === "all" && (
            <div className="outline-control">
              <select
                className="outline-select"
                aria-label="Device outline"
                value={displayed.layout}
                disabled={readOnly || saving}
                onChange={(event) =>
                  onChange({
                    ...system,
                    layout: event.target.value as SystemLayout,
                  })
                }
              >
                {SYSTEM_LAYOUTS.map((layout) => (
                  <option key={layout} value={layout}>
                    {outlineLabels[layout]}
                  </option>
                ))}
              </select>
              <Icon name="chevron" />
            </div>
          )}
          <div className="filter-tabs" aria-label="Component filter">
            {[
              ["all", "Diagram", displayed.components.length],
              ["hardware", "Hardware", counts("hardware")],
              ["software", "Software", counts("software")],
              ["external", "External", counts("external")],
            ].map(([value, name, count]) => (
              <button
                key={value}
                className={filter === value ? "active" : ""}
                aria-pressed={filter === value}
                onClick={() => {
                  setSelection(null);
                  setFilter(value as typeof filter);
                }}
              >
                {name}
                <span>{count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar-right">
          <Button
            icon="link"
            variant="ghost"
            disabled={readOnly || visibleComponents.length < 2}
            onClick={() => {
              const initialFrom =
                component?.id || visibleComponents[0]?.id || "";
              setFrom(initialFrom);
              setTo(
                visibleComponents.find((c) => c.id !== initialFrom)?.id || "",
              );
              setConnectionLabel("");
              setModal("connection");
            }}
          >
            Connect
          </Button>
          <div className="toolbar-divider" />
          <Button
            variant="ghost"
            onClick={onDiscard}
            disabled={!dirty || saving || readOnly}
          >
            Discard
          </Button>
          <Button
            variant={dirty ? "primary" : "secondary"}
            icon="save"
            disabled={!dirty || saving || readOnly}
            onClick={onSave}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      {error && <ErrorBanner onClose={() => setError("")}>{error}</ErrorBanner>}
      {draft && (
        <div className="draft-review-bar">
          <div>
            <Icon name="draft" />
            <strong>Reviewing agent draft</strong>
            <span>{draft.summary}</span>
            <Badge>Based on revision {draft.baseRevision}</Badge>
          </div>
          <Button
            onClick={() => {
              setDraft(null);
              setSelection(null);
            }}
          >
            Close preview
          </Button>
          <Button
            variant="primary"
            icon="check"
            disabled={working || draft.baseRevision !== savedSystem.revision}
            onClick={() => accept(draft)}
          >
            Accept & save
          </Button>
        </div>
      )}
      <div className="canvas-layout">
        <div
          ref={canvasRef}
          className="canvas"
          tabIndex={0}
          aria-label="System canvas. Drag the background to pan, use zoom buttons to zoom."
          onPointerDown={startPan}
          onPointerMove={movePointer}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "+" || e.key === "=") {
              e.preventDefault();
              zoom(1.2);
            }
            if (e.key === "-") {
              e.preventDefault();
              zoom(1 / 1.2);
            }
            if (e.key === "Home") {
              e.preventDefault();
              fit();
            }
            if (e.key === "Escape") setSelection(null);
          }}
        >
          <div
            className="canvas-world"
            data-pan="true"
            style={{
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            }}
          >
            {hasOutline && <DeviceOutline layout={displayed.layout} />}
            <svg
              className="connection-layer"
              width="1"
              height="1"
              aria-label="System connections"
            >
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="8"
                  markerHeight="8"
                  refX="6.5"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8" fill="currentColor" />
                </marker>
              </defs>
              {displayed.connections.map((item) => {
                const a = visibleComponents.find((c) => c.id === item.from),
                  b = visibleComponents.find((c) => c.id === item.to);
                if (!a || !b) return null;
                const ax = a.x + 224,
                  ay = a.y + 60,
                  bx = b.x,
                  by = b.y + 60,
                  bend = Math.max(70, Math.abs(bx - ax) / 2);
                return (
                  <g
                    key={item.id}
                    className={`canvas-connection ${selection?.id === item.id ? "selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Connection from ${a.label} to ${b.label}${item.label ? `: ${item.label}` : ""}`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelection({ type: "connection", id: item.id });
                      }
                    }}
                    onClick={() =>
                      setSelection({ type: "connection", id: item.id })
                    }
                  >
                    <path
                      className="connection-hit"
                      d={`M${ax} ${ay}C${ax + bend} ${ay},${bx - bend} ${by},${bx} ${by}`}
                    />
                    <path
                      className="connection-line"
                      markerEnd="url(#arrowhead)"
                      d={`M${ax} ${ay}C${ax + bend} ${ay},${bx - bend} ${by},${bx} ${by}`}
                    />
                    {item.label && (
                      <text
                        x={(ax + bx) / 2}
                        y={(ay + by) / 2 - 10}
                        textAnchor="middle"
                      >
                        {item.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {visibleComponents.map((item) => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                aria-label={`${item.label}, ${item.kind} component`}
                className={`canvas-node ${item.kind} ${selection?.id === item.id ? "selected" : ""}`}
                style={{ left: item.x, top: item.y }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelection({ type: "component", id: item.id });
                  }
                  if (
                    !readOnly &&
                    [
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                    ].includes(e.key)
                  ) {
                    e.preventDefault();
                    onChange({
                      ...system,
                      components: system.components.map((c) =>
                        c.id === item.id
                          ? {
                              ...c,
                              x:
                                c.x +
                                (e.key === "ArrowRight"
                                  ? 10
                                  : e.key === "ArrowLeft"
                                    ? -10
                                    : 0),
                              y:
                                c.y +
                                (e.key === "ArrowDown"
                                  ? 10
                                  : e.key === "ArrowUp"
                                    ? -10
                                    : 0),
                            }
                          : c,
                      ),
                    });
                  }
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (e.button !== 0) return;
                  setSelection({ type: "component", id: item.id });
                  if (!readOnly) {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    dragRef.current = {
                      id: item.id,
                      clientX: e.clientX,
                      clientY: e.clientY,
                      x: item.x,
                      y: item.y,
                      scale: viewport.scale,
                    };
                  }
                }}
              >
                <span className="node-port input-port" />
                <div className="node-top">
                  <span className={`node-icon ${item.kind}`}>
                    <Icon
                      name={
                        item.kind === "hardware"
                          ? "chip"
                          : item.kind === "software"
                            ? "code"
                            : "globe"
                      }
                      size={18}
                    />
                  </span>
                  <span>{item.kind}</span>
                </div>
                <strong>{item.label}</strong>
                <div className="node-footer">
                  <span>
                    {item.ports.length
                      ? `${item.ports.length} ports`
                      : "Component"}
                  </span>
                  <span>
                    <Icon name="link" size={12} />
                    {item.evidence.length}
                  </span>
                </div>
                <span className="node-port output-port" />
              </div>
            ))}
          </div>
          {!visibleComponents.length && !hasOutline && (
            <div className="canvas-empty">
              <h2>
                {filter === "all" ? "No components" : `No ${filter} components`}
              </h2>
              <Button
                variant="primary"
                icon="plus"
                onClick={openComponent}
                disabled={readOnly}
              >
                Add component
              </Button>
            </div>
          )}
          <div className="zoom-controls">
            <IconButton
              name="zoomOut"
              label="Zoom out"
              onClick={() => zoom(1 / 1.2)}
            />
            <span>{Math.round(viewport.scale * 100)}%</span>
            <IconButton
              name="zoomIn"
              label="Zoom in"
              onClick={() => zoom(1.2)}
            />
            <span className="toolbar-divider" />
            <IconButton name="fit" label="Fit system to view" onClick={fit} />
          </div>
        </div>
        <aside
          className={`inspector ${selected ? "has-selection" : "no-selection"}`}
        >
          {selected ? (
            <>
              <div className="inspector-title">
                <span>{component ? "Component" : "Connection"}</span>
                <IconButton
                  name="close"
                  label="Deselect item"
                  onClick={() => setSelection(null)}
                />
              </div>
              <div className="inspector-body">
                <Field label="Name">
                  <input
                    value={selected.label}
                    readOnly={readOnly}
                    onChange={(e) =>
                      component
                        ? updateComponent({ label: e.target.value })
                        : updateConnection({ label: e.target.value })
                    }
                  />
                </Field>
                {component && (
                  <>
                    <Field label="Type">
                      <select
                        value={component.kind}
                        disabled={readOnly}
                        onChange={(e) =>
                          updateComponent({
                            kind: e.target.value as Component["kind"],
                          })
                        }
                      >
                        <option value="hardware">Hardware</option>
                        <option value="software">Software</option>
                        <option value="external">External</option>
                      </select>
                    </Field>
                    <Field label="Description">
                      <textarea
                        rows={4}
                        placeholder="What does this component do?"
                        readOnly={readOnly}
                        value={component.description}
                        onChange={(e) =>
                          updateComponent({ description: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Ports">
                      <PortsInput
                        key={component.id}
                        ports={component.ports}
                        readOnly={readOnly}
                        onChange={(ports) => updateComponent({ ports })}
                      />
                    </Field>
                    <div className="field-grid">
                      <Field label="X position">
                        <input
                          type="number"
                          readOnly={readOnly}
                          value={component.x}
                          onChange={(e) =>
                            updateComponent({ x: Number(e.target.value) })
                          }
                        />
                      </Field>
                      <Field label="Y position">
                        <input
                          type="number"
                          readOnly={readOnly}
                          value={component.y}
                          onChange={(e) =>
                            updateComponent({ y: Number(e.target.value) })
                          }
                        />
                      </Field>
                    </div>
                  </>
                )}
                {connection && (
                  <>
                    <Field label="From">
                      <select
                        disabled={readOnly}
                        value={connection.from}
                        onChange={(e) =>
                          updateConnection({
                            from: e.target.value,
                            fromPort: undefined,
                          })
                        }
                      >
                        {displayed.components.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="To">
                      <select
                        disabled={readOnly}
                        value={connection.to}
                        onChange={(e) =>
                          updateConnection({
                            to: e.target.value,
                            toPort: undefined,
                          })
                        }
                      >
                        {displayed.components.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="From port">
                      <PortSelect
                        readOnly={readOnly}
                        value={connection.fromPort}
                        ports={
                          displayed.components.find(
                            (item) => item.id === connection.from,
                          )?.ports || []
                        }
                        onChange={(fromPort) => updateConnection({ fromPort })}
                      />
                    </Field>
                    <Field label="To port">
                      <PortSelect
                        readOnly={readOnly}
                        value={connection.toPort}
                        ports={
                          displayed.components.find(
                            (item) => item.id === connection.to,
                          )?.ports || []
                        }
                        onChange={(toPort) => updateConnection({ toPort })}
                      />
                    </Field>
                  </>
                )}
                <div className="inspector-section-title">
                  <span>Evidence</span>
                  <Badge>{selected.evidence.length}</Badge>
                </div>
                <div className="evidence-list">
                  {selected.evidence.map((item, index) => (
                    <div className="evidence-row" key={index}>
                      <button onClick={() => setPreview(item)}>
                        <Icon
                          name={item.type === "source" ? "code" : "document"}
                          size={15}
                        />
                        <span>
                          {evidenceLabel(item, repositories, documents)}
                        </span>
                      </button>
                      {!readOnly && (
                        <IconButton
                          name="close"
                          label="Remove evidence"
                          onClick={() => {
                            const evidence = selected.evidence.filter(
                              (_, i) => i !== index,
                            );
                            component
                              ? updateComponent({ evidence })
                              : updateConnection({ evidence });
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
                {component &&
                  displayed.links
                    .filter((link) => link.componentId === component.id)
                    .map((link) => (
                      <div className="evidence-row" key={link.id}>
                        <button
                          onClick={() =>
                            setPreview({
                              type: "document",
                              documentId: link.documentId,
                              page: link.page,
                              excerpt: link.note,
                            })
                          }
                        >
                          <Icon name="document" size={15} />
                          <span>
                            {documents.find((doc) => doc.id === link.documentId)
                              ?.name || "Document"}
                            {link.page ? ` · p. ${link.page}` : ""}
                            {link.note && (
                              <small className="linked-note">{link.note}</small>
                            )}
                          </span>
                        </button>
                        {!readOnly && (
                          <IconButton
                            name="close"
                            label="Remove linked document"
                            onClick={() =>
                              onChange({
                                ...system,
                                links: system.links.filter(
                                  (item) => item.id !== link.id,
                                ),
                              })
                            }
                          />
                        )}
                      </div>
                    ))}

                {!readOnly && (
                  <Button
                    icon="plus"
                    className="full-width"
                    onClick={() => setModal("evidence")}
                    disabled={!repositories.length && !documents.length}
                  >
                    Attach evidence
                  </Button>
                )}
                {!readOnly && (
                  <Button
                    icon="trash"
                    variant="ghost"
                    className="delete-item"
                    onClick={removeSelected}
                  >
                    Delete {component ? "component" : "connection"}
                  </Button>
                )}
              </div>
            </>
          ) : null}
        </aside>
      </div>
      {modal === "component" && (
        <Modal title="Add a component" onClose={() => setModal(null)}>
          <form onSubmit={addComponent}>
            <Field label="Component name">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Flight controller"
                required
                autoFocus
                maxLength={200}
              />
            </Field>
            <Field label="Type">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Component["kind"])}
              >
                <option value="hardware">Hardware</option>
                <option value="software">Software</option>
                <option value="external">External system</option>
              </select>
            </Field>
            <footer className="modal-actions">
              <Button type="button" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                icon="plus"
                disabled={!label.trim()}
              >
                Add component
              </Button>
            </footer>
          </form>
        </Modal>
      )}
      {modal === "connection" && (
        <Modal title="Connect components" onClose={() => setModal(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const item: Connection = {
                id: newId("connection"),
                from,
                to,
                label: connectionLabel.trim(),
                evidence: [],
              };
              onChange({
                ...system,
                connections: [...system.connections, item],
              });
              if (!visibleIds.has(from) || !visibleIds.has(to))
                setFilter("all");
              setSelection({ type: "connection", id: item.id });
              setModal(null);
            }}
          >
            <Field label="From">
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                {system.components.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="To">
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                {system.components.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Connection label">
              <input
                value={connectionLabel}
                onChange={(e) => setConnectionLabel(e.target.value)}
                placeholder="e.g. SPI · sensor data"
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
                disabled={!from || !to || from === to}
              >
                Add connection
              </Button>
            </footer>
          </form>
        </Modal>
      )}
      {modal === "evidence" && selected && (
        <EvidenceEditor
          repositories={repositories}
          documents={documents}
          onClose={() => setModal(null)}
          onAdd={(item) =>
            component
              ? updateComponent({ evidence: [...component.evidence, item] })
              : connection &&
                updateConnection({ evidence: [...connection.evidence, item] })
          }
        />
      )}
      {preview && (
        <EvidencePreview
          item={preview}
          project={project}
          repositories={repositories}
          documents={documents}
          onClose={() => setPreview(null)}
        />
      )}
      {modal === "drafts" && (
        <Modal title="Agent drafts" onClose={() => setModal(null)} wide>
          {error && <ErrorBanner>{error}</ErrorBanner>}
          {!drafts.length ? (
            <Empty title="No drafts to review" />
          ) : (
            <div className="draft-list">
              {drafts.map((item) => (
                <article className="draft-card" key={item.id}>
                  <div className="draft-card-title">
                    <Icon name="draft" />
                    <strong>{item.summary}</strong>
                    <Badge
                      tone={
                        item.baseRevision === savedSystem.revision
                          ? "green"
                          : "orange"
                      }
                    >
                      {item.baseRevision === savedSystem.revision
                        ? "Ready to review"
                        : "Revision conflict"}
                    </Badge>
                  </div>
                  <p>
                    {new Date(item.createdAt).toLocaleString()} · Based on
                    revision {item.baseRevision}
                  </p>
                  <div className="draft-stats">
                    <span>
                      {item.system.components.length} components{" "}
                      <small>
                        (
                        {item.system.components.length -
                          savedSystem.components.length >=
                        0
                          ? "+"
                          : ""}
                        {item.system.components.length -
                          savedSystem.components.length}
                        )
                      </small>
                    </span>
                    <span>{item.system.connections.length} connections</span>
                    <span>{item.system.links.length} document links</span>
                  </div>
                  {item.baseRevision !== savedSystem.revision && (
                    <p className="conflict-note">
                      The saved system has changed. Ask your agent to propose a
                      new draft from revision {savedSystem.revision}.
                    </p>
                  )}
                  <div className="draft-card-actions">
                    <Button
                      icon="trash"
                      variant="ghost"
                      disabled={working}
                      onClick={() => deleteItem(item)}
                    >
                      Delete draft
                    </Button>
                    <div />
                    <Button
                      icon="eye"
                      onClick={() => {
                        setDraft(item);
                        setSelection(null);
                        setModal(null);
                        setFilter("all");
                      }}
                    >
                      Review on canvas
                    </Button>
                    <Button
                      variant="primary"
                      icon="check"
                      disabled={
                        working || item.baseRevision !== savedSystem.revision
                      }
                      onClick={() => accept(item)}
                    >
                      Accept & save
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Modal>
      )}
    </section>
  );
}
