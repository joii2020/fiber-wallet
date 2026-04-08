import { Modal } from "./ui";

type ReceiveModalProps = {
  receiveStep: "idle" | "creating" | "waiting" | "paid";
  receiveInvoiceAddress: string;
  receiveInvoiceStatus: string;
  receiveError: string;
  receiveCopyStatus: string;
  onCopy: () => void;
  onClose: () => void;
};

export function ReceiveModal({
  receiveStep,
  receiveInvoiceAddress,
  receiveInvoiceStatus,
  receiveError,
  receiveCopyStatus,
  onCopy,
  onClose
}: ReceiveModalProps) {
  return (
    <Modal title="Receive" onClose={onClose}>
      <>
        {(receiveStep === "creating" || receiveStep === "waiting") && (
          <div className="wait-box">
            <div className="spinner" aria-hidden="true" />
            <span>{receiveStep === "creating" ? "Creating invoice" : "Waiting for payment"}</span>
          </div>
        )}
        {receiveInvoiceAddress && (
          <div className="box">
            <span className="subtle">Invoice Address</span>
            <div className="copy-row">
              <strong className="truncate-line" title={receiveInvoiceAddress}>
                {receiveInvoiceAddress}
              </strong>
              <button className="secondary" onClick={onCopy} type="button">
                Copy
              </button>
            </div>
          </div>
        )}
        {receiveCopyStatus && <p className="subtle">{receiveCopyStatus}</p>}
        {receiveInvoiceStatus && <p className="subtle">Status: {receiveInvoiceStatus}</p>}
        {receiveStep === "paid" && <p className="success-text">Payment received successfully.</p>}
        {receiveError && <p className="error-text">{receiveError}</p>}
        <div className="modal-actions">
          <button className="secondary" onClick={onClose} type="button">
            Close
          </button>
        </div>
      </>
    </Modal>
  );
}
