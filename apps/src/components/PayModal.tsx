import { Modal } from "./ui";

type PayInvoiceInfo = {
  invoiceAddress: string;
  paymentHash: string;
  currency: string;
  amountCkb: number | null;
  expiry: string;
  description: string;
};

type PayModalProps = {
  payStep: "input" | "review";
  payId: string;
  payAmount: number | null;
  payInvoiceInfo: PayInvoiceInfo | null;
  payLookupError: string;
  isPayLookupLoading: boolean;
  isPaySubmitting: boolean;
  formatCkb: (value: number) => string;
  onPayIdChange: (value: string) => void;
  onLookup: () => void;
  onClose: () => void;
  onReset: () => void;
  onConfirm: () => void;
};

export function PayModal({
  payStep,
  payId,
  payAmount,
  payInvoiceInfo,
  payLookupError,
  isPayLookupLoading,
  isPaySubmitting,
  formatCkb,
  onPayIdChange,
  onLookup,
  onClose,
  onReset,
  onConfirm
}: PayModalProps) {
  return (
    <Modal title="Pay" onClose={onClose}>
      {payStep === "input" ? (
        <>
          <label className="field">
            <span>Invoice / Payment Hash</span>
            <input
              value={payId}
              onChange={(event) => onPayIdChange(event.target.value)}
              placeholder="Enter invoice or 0x... payment hash"
            />
          </label>
          <div className="modal-actions">
            <button className="secondary" onClick={onClose} type="button">
              Cancel
            </button>
            <button onClick={onLookup} type="button" disabled={!payId.trim() || isPayLookupLoading}>
              {isPayLookupLoading ? "Loading..." : "Confirm"}
            </button>
          </div>
          {payLookupError && <p className="error-text">{payLookupError}</p>}
        </>
      ) : (
        <>
          <div className="box">
            <span className="subtle">Amount</span>
            <strong>{payAmount === null ? "--" : formatCkb(payAmount)}</strong>
            <p className="subtle">Currency: {payInvoiceInfo?.currency ?? "--"}</p>
            <p className="subtle">Invoice Address: {payInvoiceInfo?.invoiceAddress ?? "--"}</p>
            <p className="subtle">Payment Hash: {payInvoiceInfo?.paymentHash ?? "--"}</p>
            <p className="subtle">Expiry: {payInvoiceInfo?.expiry ?? "--"}</p>
            <p className="subtle">Description: {payInvoiceInfo?.description ?? "--"}</p>
            <p>Confirm to send this payment.</p>
          </div>
          <div className="modal-actions">
            <button className="secondary" onClick={onReset} type="button">
              Cancel
            </button>
            <button onClick={onConfirm} type="button" disabled={isPaySubmitting}>
              {isPaySubmitting ? "Paying..." : "Confirm Payment"}
            </button>
          </div>
          {payLookupError && <p className="error-text">{payLookupError}</p>}
        </>
      )}
    </Modal>
  );
}
