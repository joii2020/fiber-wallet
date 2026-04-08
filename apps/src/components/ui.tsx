import type { ReactNode } from "react";

type ActionCardProps = {
  title: string;
  meta?: string;
  disabled?: boolean;
  onClick: () => void;
  centered?: boolean;
};

export function ActionCard({
  title,
  meta,
  disabled,
  onClick,
  centered
}: ActionCardProps) {
  return (
    <button
      className={`action-card${centered ? " centered" : ""}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <strong>{title}</strong>
      {meta && <span>{meta}</span>}
    </button>
  );
}

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-button" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
