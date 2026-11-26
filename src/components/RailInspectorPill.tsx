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
        gap: 10,
        padding: "6px 12px",
        backgroundColor: "rgba(30, 36, 44, 0.94)",
        color: "#F2F5F7",
        border: "1px solid rgba(56, 226, 255, 0.42)",
        borderRadius: 999,
        boxShadow: "0 6px 20px rgba(15, 22, 28, 0.22)",
        fontSize: 11.5,
      }}
    >
      <span style={{ fontWeight: 700, color: "#38E2FF", letterSpacing: "0.02em" }}>
        V-Rail
      </span>

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
          style={{ width: 62, accentColor: "#38E2FF" }}
        />
        <span style={{ width: 32, fontFamily: "var(--font-mono)", fontSize: 10.5 }}>
          {rotDeg}°
        </span>
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ opacity: 0.8 }}>{locale === "vi" ? "Dài" : "Size"}</span>
        <input
          type="range"
          min={65}
          max={210}
          step={5}
          value={Math.round(rail.armLength)}
          onChange={(e) => onUpdateRail({ armLength: Number(e.target.value) })}
          style={{ width: 58, accentColor: "#38E2FF" }}
        />
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ opacity: 0.8 }}>{locale === "vi" ? "Góc mở" : "Angle"}</span>
        <input
          type="range"
          min={50}
          max={140}
          step={2}
          value={Math.round(rail.openingAngle)}
          onChange={(e) => onUpdateRail({ openingAngle: Number(e.target.value) })}
          style={{ width: 54, accentColor: "#38E2FF" }}
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
          style={{ width: 48, accentColor: "#38E2FF" }}
        />
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ opacity: 0.8 }}>{locale === "vi" ? "Dốc" : "Slope"}</span>
        <input
          type="range"
          min={-40}
          max={40}
          step={5}
          value={Math.round(rail.slopeBias * 100)}
          onChange={(e) => onUpdateRail({ slopeBias: Number(e.target.value) / 100 })}
          style={{ width: 48, accentColor: "#38E2FF" }}
        />
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ opacity: 0.8 }}>{locale === "vi" ? "Đẩy" : "Boost"}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(rail.boost * 100)}
          onChange={(e) => onUpdateRail({ boost: Number(e.target.value) / 100 })}
          style={{ width: 48, accentColor: "#38E2FF" }}
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
        ⇄ {locale === "vi" ? "Đảo chiều" : "Flip"}
      </button>
    </div>
  );
};
