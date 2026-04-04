"use client";

import { useEffect, useState } from "react";

export type TxState = "idle" | "pending" | "confirming" | "confirmed" | "reverted";

interface TransactionStatusProps {
  state: TxState;
  hash?: string;
  error?: string;
  onDismiss?: () => void;
}

export function TransactionStatus({ state, hash, error, onDismiss }: TransactionStatusProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (state !== "idle") setVisible(true);
    if (state === "confirmed") {
      const t = setTimeout(() => setVisible(false), 5000);
      return () => clearTimeout(t);
    }
  }, [state]);

  if (!visible || state === "idle") return null;

  const config: Record<TxState, { bg: string; text: string; icon: string }> = {
    idle: { bg: "", text: "", icon: "" },
    pending: {
      bg: "bg-blue-900/50 border-blue-500/50",
      text: "Transaction pending - confirm in wallet...",
      icon: "animate-spin",
    },
    confirming: {
      bg: "bg-yellow-900/50 border-yellow-500/50",
      text: "Waiting for confirmation...",
      icon: "animate-spin",
    },
    confirmed: {
      bg: "bg-green-900/50 border-green-500/50",
      text: "Transaction confirmed!",
      icon: "",
    },
    reverted: {
      bg: "bg-red-900/50 border-red-500/50",
      text: error || "Transaction reverted",
      icon: "",
    },
  };

  const c = config[state];

  return (
    <div className={`fixed bottom-4 right-4 z-50 max-w-sm p-4 rounded-lg border ${c.bg}`}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          {state === "pending" || state === "confirming" ? (
            <svg className="w-5 h-5 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : state === "confirmed" ? (
            <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{c.text}</p>
          {hash && (
            <p className="mt-1 text-xs text-gray-400 truncate font-mono">
              tx: {hash.slice(0, 10)}...{hash.slice(-8)}
            </p>
          )}
        </div>
        <button
          onClick={() => { setVisible(false); onDismiss?.(); }}
          className="flex-shrink-0 text-gray-400 hover:text-white"
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
}
