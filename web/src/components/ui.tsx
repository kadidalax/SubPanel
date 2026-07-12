import { ReactNode, useEffect, useState } from "react";

export function Modal({
  open,
  title,
  description,
  children,
  onClose,
  wide,
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const body = document.body;
    const html = document.documentElement;
    const prevOverflow = body.style.overflow;
    const prevPad = body.style.paddingRight;
    const prevHtmlOverflow = html.style.overflow;
    const sb = Math.max(0, window.innerWidth - html.clientWidth);
    body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    if (sb > 0) body.style.paddingRight = sb + "px";
    return () => {
      document.removeEventListener("keydown", onKey);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPad;
      html.style.overflow = prevHtmlOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-root" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-backdrop" onClick={onClose} />
      <div className={"modal-panel" + (wide ? " wide" : "")}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {description ? <p className="muted">{description}</p> : null}
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "确认",
  danger,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      description={message}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn secondary" onClick={onClose} disabled={loading}>取消</button>
          <button type="button" className={"btn" + (danger ? " danger" : "")} onClick={() => void onConfirm()} disabled={loading}>
            {loading ? "处理中..." : confirmText}
          </button>
        </>
      }
    />
  );
}

export function Flash({
  error,
  msg,
  onDismissError,
  onDismissMsg,
  autoHideMs = 4000,
}: {
  error?: string;
  msg?: string;
  onDismissError?: () => void;
  onDismissMsg?: () => void;
  autoHideMs?: number;
}) {
  const [errorLeaving, setErrorLeaving] = useState(false);
  const [msgLeaving, setMsgLeaving] = useState(false);
  const [errorKey, setErrorKey] = useState(0);
  const [msgKey, setMsgKey] = useState(0);

  useEffect(() => {
    if (!error) {
      setErrorLeaving(false);
      return;
    }
    setErrorLeaving(false);
    setErrorKey((k) => k + 1);
  }, [error]);

  useEffect(() => {
    if (!msg) {
      setMsgLeaving(false);
      return;
    }
    setMsgLeaving(false);
    setMsgKey((k) => k + 1);
  }, [msg]);

  // auto start leave after delay
  useEffect(() => {
    if (!error || !autoHideMs) return;
    const t = window.setTimeout(() => setErrorLeaving(true), autoHideMs);
    return () => window.clearTimeout(t);
  }, [error, autoHideMs, errorKey]);

  useEffect(() => {
    if (!msg || !autoHideMs) return;
    const t = window.setTimeout(() => setMsgLeaving(true), autoHideMs);
    return () => window.clearTimeout(t);
  }, [msg, autoHideMs, msgKey]);

  // finish after leave animation (fallback timeout)
  useEffect(() => {
    if (!error || !errorLeaving) return;
    const t = window.setTimeout(() => {
      setErrorLeaving(false);
      onDismissError?.();
    }, 220);
    return () => window.clearTimeout(t);
  }, [error, errorLeaving, onDismissError]);

  useEffect(() => {
    if (!msg || !msgLeaving) return;
    const t = window.setTimeout(() => {
      setMsgLeaving(false);
      onDismissMsg?.();
    }, 220);
    return () => window.clearTimeout(t);
  }, [msg, msgLeaving, onDismissMsg]);

  if (!error && !msg) return null;

  return (
    <div className="flash-stack" role="status" aria-live="polite">
      {error ? (
        <div
          key={`e-${errorKey}`}
          className={`flash-toast error${errorLeaving ? " leaving" : ""}`}
        >
          <div className="flash-toast-body">{error}</div>
          <button
            type="button"
            className="flash-close"
            aria-label="关闭"
            onClick={() => setErrorLeaving(true)}
          >
            ×
          </button>
        </div>
      ) : null}
      {msg ? (
        <div
          key={`m-${msgKey}`}
          className={`flash-toast success${msgLeaving ? " leaving" : ""}`}
        >
          <div className="flash-toast-body">{msg}</div>
          <button
            type="button"
            className="flash-close"
            aria-label="关闭"
            onClick={() => setMsgLeaving(true)}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
export function PageHeader({
  title,
  sub,
  actions,
  steps,
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
  steps?: string[];
}) {
  return (
    <div className="page-header">
      {steps?.length ? (
        <div className="flow-steps" aria-label="操作流程">
          {steps.map((s, i) => (
            <span key={s} className="flow-step">
              <span className="flow-n">{i + 1}</span>
              {s}
              {i < steps.length - 1 ? <span className="flow-sep">→</span> : null}
            </span>
          ))}
        </div>
      ) : null}
      <div className="page-header-main">
        <h2>{title}</h2>
      </div>
      {(sub || actions) ? (
        <div className="page-header-subrow">
          {sub ? <div className="sub">{sub}</div> : <div className="sub" />}
          {actions ? <div className="page-actions">{actions}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
export function BatchBar({
  count,
  total,
  onClear,
  children,
}: {
  count: number;
  total: number;
  onClear: () => void;
  children: ReactNode;
  /** @deprecated ignored — only show when count > 0 */
  always?: boolean;
}) {
  if (!count) return null;
  return (
    <div className="batch-inline active">
      <div className="batch-meta">
        已选 <strong>{count}</strong> / {total}
        <button type="button" className="btn ghost sm" onClick={onClear}>清除</button>
      </div>
      <div className="batch-actions">{children}</div>
    </div>
  );
}
export function ListLoading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="list-loading" aria-busy="true" aria-live="polite">
      <div className="muted list-loading-label">加载中…</div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton list-loading-row" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  desc,
  action,
}: {
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-ico" aria-hidden="true" />
      <h3>{title}</h3>
      {desc ? <p className="muted">{desc}</p> : null}
      {action}
    </div>
  );
}
