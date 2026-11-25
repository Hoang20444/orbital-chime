import React from "react";
import type { Strings } from "../i18n.ts";

interface WinBannerProps {
  t: Strings;
  hasNext: boolean;
  onNextTrack: () => void;
  onKeepListening: () => void;
}

export const WinBanner: React.FC<WinBannerProps> = ({
  t,
  hasNext,
  onNextTrack,
  onKeepListening,
}) => {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 92,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 25,
        backgroundColor: "#FFFFFF",
        border: "1.5px solid #4D8A78",
        borderRadius: 14,
        padding: "10px 14px",
        boxShadow: "0 12px 28px rgba(28, 35, 33, 0.12)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        maxWidth: "92vw",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            backgroundColor: "#4D8A78",
            display: "inline-block",
          }}
        />
        <span style={{ fontWeight: 600, fontSize: 14 }}>{t.trackComplete}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          onClick={onKeepListening}
          style={{
            border: "1px solid var(--border)",
            backgroundColor: "var(--tray)",
            borderRadius: 9,
            padding: "6px 11px",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {t.keepListening}
        </button>

        {hasNext && (
          <button
            type="button"
            onClick={onNextTrack}
            style={{
              border: "none",
              backgroundColor: "#4D8A78",
              color: "#F6F7F4",
              borderRadius: 9,
              padding: "6px 13px",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {t.nextTrack} →
          </button>
        )}
      </div>
    </div>
  );
};
