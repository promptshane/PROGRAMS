import type { ReactNode } from "react";
import type { StatusTone } from "@shared/types";

export interface ToastItem {
  id: string;
  level: "info" | "success" | "error";
  message: string;
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  compact = false,
  fullscreen = false,
  headerLeading,
  showCloseButton = true,
  dismissOnOverlayClick = true,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  compact?: boolean;
  fullscreen?: boolean;
  headerLeading?: ReactNode;
  showCloseButton?: boolean;
  dismissOnOverlayClick?: boolean;
}) {
  return (
    <div className="modalOverlay" onClick={dismissOnOverlayClick ? onClose : undefined}>
      <div className={`modalFrame${wide ? " wide" : ""}${compact ? " compact" : ""}${fullscreen ? " fullscreen" : ""}`} onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <div className="modalHeaderLead">
            {headerLeading ? <div className="modalHeaderLeading">{headerLeading}</div> : null}
            {title ? <h3>{title}</h3> : null}
          </div>
          {showCloseButton ? (
            <button className="textButton" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function BottomSheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="bottomSheetOverlay" onClick={onClose}>
      <div className="bottomSheetFrame" onClick={(event) => event.stopPropagation()}>
        <div className="bottomSheetHandle" aria-hidden="true" />
        <div className="bottomSheetHeader">
          <h3>{title}</h3>
          <button className="textButton" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ToastHost({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="toastHost">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.level}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}

export function StatusChip({
  tone,
  children,
}: {
  tone: StatusTone;
  children: ReactNode;
}) {
  return <span className={`statusChip statusChip-${tone}`}>{children}</span>;
}
