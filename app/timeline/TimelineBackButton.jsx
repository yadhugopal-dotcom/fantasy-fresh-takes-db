"use client";

import { useRouter } from "next/navigation";

export default function TimelineBackButton({ fallbackHref = "/#live-sheet-data", label = "Return to dashboard" }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
          return;
        }
        router.push(fallbackHref);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "12px 18px",
        borderRadius: 999,
        border: "1px solid rgba(28, 25, 23, 0.12)",
        background: "#fffdf8",
        color: "#1f1b16",
        fontWeight: 700,
        cursor: "pointer",
        boxShadow: "0 10px 26px rgba(57, 47, 31, 0.08)",
      }}
    >
      <span aria-hidden="true">←</span>
      {label}
    </button>
  );
}
