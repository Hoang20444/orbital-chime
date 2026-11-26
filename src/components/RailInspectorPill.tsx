import React from "react";
import type { TransferRailPiece } from "../engine/types.ts";
import type { Locale } from "../i18n.ts";

interface RailInspectorPillProps {
  locale: Locale;
  rail: TransferRailPiece;
  onUpdateRail: (patch: Partial<TransferRailPiece>) => void;
}

export const RailInspectorPill: React.FC<RailInspectorPillProps> = ({
  locale,
  rail,
  onUpdateRail,
}) => {
  const rotDeg = Math.round((rail.rotation * 180) / Math.PI);

  return (
    <div
      style={{
        position: "fixed",
        top: 64,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 22,
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 9,
        padding: "6px 12px",
        backgroundColor: "rgba(26, 32, 40, 0.94)",
        color: "#F2F5F7",
        border: "1px solid rgba(56, 226, 255, 0.44)",
        borderRadius: 999,
        boxShadow: "0 6px 20px rgba(15, 22, 28, 0.24)",
        fontSize: 11.5,
      }}
    >
      <span style={{ fontWeight: 700, color: "#38E2FF", letterSpacing: "0.02em" }}>
        Twin Rail
      </span>

      <div style={{ display: "flex", gap: 4 }}>
        {(["straight", "v"] as const).map((v) => {
          const active = rail.variant === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onUpdateRail({ variant: v })}
              style={{
                padding: "2px 7px",
                borderRadius: 999,
                border: "1px solid rgba(56, 226, 255, 0.5)",
                background: active ? "#38E2FF" : "transparent",
                color: active ? "#121820" : "#CFE9F2",
                fontWeight: 700,
                fontSize: 10.5,
                cursor: "pointer",
              }}
            >
              {v === "straight"
                ? locale === "vi"
                  ? "Thẳng"
                  : "Straight"
                : locale === "vi"
                  ? "Chữ V"
                  : "V-Shape"}
            </button>
          );
        })}
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ opacity: 0.8 }}>{locale === "vi" ? "Xoay" : "Rot"}</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={2}
          value={rotDeg}
          onChange={(e) =>
            onUpdateRail({ rotation: (Number(e.target.value) * Math.PI) / 180 })
          }
          style={{ width: 56, accentColor: "#38E2FF" }}
        />
        <span style={{ width: 30, fontFamily: "var(--font-mono)", fontSize: 10.5 }}>
          {rotDeg}°
        </span>
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ opacity: 0.8 }}>{locale === "vi" ? "Dài" : "Len"}</span>
        <input
          type="range"
          min={65}
          max={210}
          step={5}
          value={Math.round(rail.armLength)}
          onChange={(e) => onUpdateRail({ armLength: Number(e.target.value) })}
          style={{ width: 52, accentColor: "#38E2FF" }}
        />
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ opacity: 0.8 }}>{locale === "vi" ? "Khe" : "Gap"}</span>
        <input
          type="range"
          min={20}
          max={36}
          step={1}
          value={Math.round(rail.channelWidth)}
          onChange={(e) => onUpdateRail({ channelWidth: Number(e.target.value) })}
          style={{ width: 46, accentColor: "#38E2FF" }}
        />
      </label>

      {rail.variant === "v" && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ opacity: 0.8 }}>{locale === "vi" ? "Góc" : "Angle"}</span>
            <input
              type="range"
              min={50}
              max={140}
              step={2}
              value={Math.round(rail.openingAngle)}
              onChange={(e) => onUpdateRail({ openingAngle: Number(e.target.value) })}
              style={{ width: 48, accentColor: "#38E2FF" }}
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ opacity: 0.8 }}>{locale === "vi" ? "Cong" : "Curve"}</span>
            <input
              type="range"
              min={25}
              max={85}
              step={5}
              value={Math.round(rail.curvature * 100)}
              onChange={(e) => onUpdateRail({ curvature: Number(e.target.value) / 100 })}
              style={{ width: 44, accentColor: "#38E2FF" }}
            />
          </label>
        </>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ opacity: 0.8 }}>{locale === "vi" ? "Đẩy" : "Boost"}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(rail.boost * 100)}
          onChange={(e) => onUpdateRail({ boost: Number(e.target.value) / 100 })}
          style={{ width: 44, accentColor: "#38E2FF" }}
        />
      </label>

      <button
        type="button"
        onClick={() => onUpdateRail({ flipped: !rail.flipped })}
        style={{
          padding: "2px 8px",
          borderRadius: 999,
          border: "1px solid rgba(56, 226, 255, 0.55)",
          background: rail.flipped ? "#38E2FF" : "transparent",
          color: rail.flipped ? "#131A22" : "#38E2FF",
          fontWeight: 700,
          fontSize: 10.5,
          cursor: "pointer",
        }}
        title={locale === "vi" ? "Đảo chiều vào/ra" : "Flip entry & exit direction"}
      >
        ⇄ {locale === "vi" ? "Đảo" : "Flip"}
      </button>
    </div>
  );
};
