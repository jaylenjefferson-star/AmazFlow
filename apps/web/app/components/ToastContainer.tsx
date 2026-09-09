"use client";

import type { Toast } from "../lib/hooks/useToast";

export function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        maxWidth: 420,
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            background: toast.type === "error" ? "#fff0eb" : toast.type === "success" ? "#e2f0e5" : "#f7f4eb",
            border: `1.5px solid ${toast.type === "error" ? "#ff765c" : toast.type === "success" ? "#4fb671" : "#dcd7c9"}`,
            borderRadius: 12,
            padding: "14px 16px",
            boxShadow: "0 6px 20px rgba(29, 33, 29, 0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            animation: "slideIn 0.3s ease-out",
          }}
        >
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{toast.message}</span>
          <button
            onClick={() => onDismiss(toast.id)}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 18,
              cursor: "pointer",
              padding: 0,
              color: "var(--muted)",
              lineHeight: 1,
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
      <style jsx>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
