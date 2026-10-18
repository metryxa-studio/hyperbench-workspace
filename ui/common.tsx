import React, {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

export type IconName =
  | "plus"
  | "close"
  | "chevron"
  | "system"
  | "code"
  | "document"
  | "plug"
  | "search"
  | "folder"
  | "arrow"
  | "check"
  | "trash"
  | "upload"
  | "download"
  | "link"
  | "chip"
  | "layers"
  | "zoomIn"
  | "zoomOut"
  | "fit"
  | "undo"
  | "save"
  | "external"
  | "copy"
  | "settings"
  | "eye"
  | "draft"
  | "globe"
  | "terminal";
const paths: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  system: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1.3" />
      <rect x="15" y="15" width="6" height="6" rx="1.3" />
      <rect x="3" y="15" width="6" height="6" rx="1.3" />
      <path d="M6 9v6m3 3h6m-6-12h9v9" />
    </>
  ),
  code: <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16" />,
  document: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v5m6-5v5M7 8h10v4a5 5 0 0 1-10 0V8Zm5 9v4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3V7Z" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" />
    </>
  ),
  link: (
    <>
      <path
        d="m10 13 4-4m-6 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"
        transform="translate(1 0)"
      />
    </>
  ),
  chip: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3M10 10h4v4h-4z" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m15 15 6 6M6 10h8m-4-4v8" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m15 15 6 6M6 10h8" />
    </>
  ),
  fit: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8z" />,
  undo: (
    <>
      <path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 7 7v4" />
    </>
  ),
  save: (
    <>
      <path d="M4 3h13l4 4v14H3V3h1Zm3 0v6h10V3M7 21v-8h10v8" />
    </>
  ),
  external: <path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7" />,
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="m10 3-1 3-3 1-3-1v4l3 2-1 3-2 2 3 3 3-2 3 1 2 2 3-2v-3l2-2 3-1-1-4-3-1-1-3-3-1-2 2Z" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  draft: (
    <>
      <path d="M13 3H5v18h14v-8M9 15l1-5 8-8 4 4-8 8-5 1Z" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3m6 0h4" />
    </>
  ),
};
export function Icon({
  name,
  size = 18,
  ...props
}: { name: IconName; size?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
export function Button({
  children,
  icon,
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button {...props} className={`button ${variant} ${className}`}>
      {icon && <Icon name={icon} size={16} />} {children}
    </button>
  );
}
export function IconButton({
  name,
  label,
  ...props
}: {
  name: IconName;
  label: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="icon-button" title={label} aria-label={label} {...props}>
      <Icon name={name} size={17} />
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current
      ?.querySelector<HTMLElement>("input, select, textarea, button")
      ?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const items = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]",
          ) || []),
        ];
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-heading">
          <div>
            <h2>{title}</h2>
          </div>
          <IconButton name="close" label="Close dialog" onClick={onClose} />
        </header>
        {children}
      </div>
    </div>
  );
}
export function Empty({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {action}
    </div>
  );
}
export function ErrorBanner({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="error-banner" role="alert">
      <span>{children}</span>
      {onClose && (
        <IconButton name="close" label="Dismiss error" onClick={onClose} />
      )}
    </div>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const child = isValidElement<{ id?: string }>(children) ? children : null;
  const id = child?.props.id || generatedId;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {child ? cloneElement(child, { id }) : children}
    </div>
  );
}
export function Loading({
  children = "Loading context…",
}: {
  children?: ReactNode;
}) {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      {children}
    </div>
  );
}
export function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
