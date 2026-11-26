import React from "react";
import type { MaterialType, PieceBudget, ToolType } from "../engine/types.ts";
import type { Strings } from "../i18n.ts";
import { MATERIALS, TOKENS } from "../theme/tokens.ts";

interface DockBarProps {
  t: Strings;
  mode: "puzzle" | "sandbox";
  isPlaying: boolean;
  onTogglePlay: () => void;
  activeTool: ToolType;
  onSelectTool: (tool: ToolType) => void;
  remainingBudget: PieceBudget;
  hasSelection: boolean;
  onDeleteSelected: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onResetOrClear: () => void;
  showHint: boolean;
  onToggleHint: () => void;
  onShareLink: () => void;
  shareCopied: boolean;
  showTip: boolean;
}

const INSTRUMENT_TOOLS: MaterialType[] = ["marimba", "brass", "ceramic", "bass"];
const PHYSICS_TOOLS: ToolType[] = ["bumper", "splitter", "rail", "emitter"];

const MaterialSwatch: React.FC<{ material: MaterialType }> = ({ material }) => {
  const spec = MATERIALS[material];
  return (
    <span
      style={{
        display: "inline-block",
        width: 16,
        height: material === "bass" ? 8 : 6,
        borderRadius: material === "brass" ? 999 : 2,
        backgroundColor: spec.color,
        border: `1px solid ${spec.borderColor}`,
        boxShadow: `0 1.5px 0 ${spec.bevelColor}`,
      }}
    />
  );
};

const PhysicsGlyph: React.FC<{ tool: ToolType }> = ({ tool }) => {
  if (tool === "bumper") {
    return (
      <span
        style={{
          display: "inline-block",
          width: 11,
          height: 11,
          borderRadius: 999,
          backgroundColor: TOKENS.accent,
          border: "1.5px solid #F7F8F5",
          boxShadow: `0 0 0 1px ${TOKENS.borderStrong}`,
        }}
      />
    );
  }
  if (tool === "splitter") {
    return (
      <span
        style={{
          display: "inline-block",
          width: 9,
          height: 9,
          transform: "rotate(45deg)",
          backgroundColor: TOKENS.splitterFill,
          border: `1.5px solid ${TOKENS.ink}`,
        }}
      />
    );
  }
  if (tool === "rail") {
    return (
      <svg
        width="16"
        height="13"
        viewBox="0 0 16 13"
        style={{ display: "inline-block", verticalAlign: "middle" }}
      >
        <path
          d="M1.5 2 Q8 9.2 14.5 2"
          fill="none"
          stroke="#1C232B"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M1.5 5.8 Q8 13 14.5 5.8"
          fill="none"
          stroke="#1C232B"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M1.5 2 Q8 9.2 14.5 2 M1.5 5.8 Q8 13 14.5 5.8"
          fill="none"
          stroke="#38E2FF"
          strokeWidth="0.7"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <span
      style={{
        display: "inline-block",
        width: 11,
        height: 11,
        borderRadius: 999,
        backgroundColor: TOKENS.tray,
        border: `2px solid ${TOKENS.ink}`,
      }}
    />
  );
};

export const DockBar: React.FC<DockBarProps> = ({
  t,
  mode,
  isPlaying,
  onTogglePlay,
  activeTool,
  onSelectTool,
  remainingBudget,
  hasSelection,
  onDeleteSelected,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onResetOrClear,
  showHint,
  onToggleHint,
  onShareLink,
  shareCopied,
  showTip,
}) => {
  const visibleInstruments =
    mode === "sandbox"
      ? INSTRUMENT_TOOLS
      : INSTRUMENT_TOOLS.filter((tool) => remainingBudget[tool] !== undefined);

  const visiblePhysics =
    mode === "sandbox"
      ? PHYSICS_TOOLS
      : PHYSICS_TOOLS.filter(
          (tool) => tool !== "emitter" && remainingBudget[tool] !== undefined
        );

  const groupLabelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    color: "var(--slate)",
    letterSpacing: "0.02em",
    lineHeight: 1,
    paddingLeft: 2,
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 10,
        left: 12,
        right: 12,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 7,
        pointerEvents: "none",
      }}
    >
      {showTip && (
        <div
          style={{
            backgroundColor: "rgba(247, 248, 245, 0.94)",
            border: "1px solid var(--border)",
            borderRadius: 999,
            padding: "4px 13px",
            fontSize: 12,
            color: "var(--slate)",
            fontWeight: 500,
          }}
        >
          {t.dragTip}
        </div>
      )}

      <div
        style={{
          pointerEvents: "auto",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 8,
          backgroundColor: "var(--tray)",
          border: "1px solid var(--border-strong)",
          borderRadius: 14,
          padding: "6px 9px",
          boxShadow: "0 8px 20px rgba(28, 35, 33, 0.08)",
          maxWidth: "100%",
        }}
      >
        {/* Play / Pause */}
        <div className="hw-tip-wrap" style={{ alignSelf: "center" }}>
          <button
            type="button"
            onClick={onTogglePlay}
            className={`hw-btn ${isPlaying ? "is-playing" : "is-accent"}`}
            style={{
              padding: "8px 15px",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 11 }}>{isPlaying ? "❚❚" : "▶"}</span>
            <span>{isPlaying ? t.pause : t.play}</span>
          </button>
          <span className="hw-tip">{t.tooltips.play}</span>
        </div>

        <div
          style={{
            width: 1,
            height: 30,
            backgroundColor: "var(--border-strong)",
            alignSelf: "center",
          }}
        />

        {/* Group 1: Instrument Materials */}
        {visibleInstruments.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={groupLabelStyle}>{t.groups.instruments}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {visibleInstruments.map((mat) => {
                const isActive = activeTool === mat;
                const count = remainingBudget[mat];
                const depleted =
                  mode === "puzzle" && count !== undefined && count <= 0;

                return (
                  <div key={mat} className="hw-tip-wrap">
                    <button
                      type="button"
                      onClick={() => onSelectTool(mat)}
                      className={`hw-btn ${isActive ? "is-selected" : ""}`}
                      style={{
                        opacity: depleted && !isActive ? 0.48 : 1,
                        padding: "5px 10px",
                        fontSize: 12.5,
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                      }}
                    >
                      <MaterialSwatch material={mat} />
                      <span>{t.tools[mat]}</span>
                      {mode === "puzzle" && count !== undefined && (
                        <span
                          className="mono"
                          style={{
                            fontSize: 10.5,
                            color: count > 0 ? "var(--ink)" : "var(--slate)",
                            backgroundColor: "var(--tray-well)",
                            padding: "1px 5px",
                            borderRadius: 5,
                          }}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                    <span className="hw-tip">{t.tooltips[mat]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Group 2: Physics Tools */}
        {visiblePhysics.length > 0 && (
          <>
            <div
              style={{
                width: 1,
                height: 30,
                backgroundColor: "var(--border-strong)",
                alignSelf: "center",
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={groupLabelStyle}>{t.groups.physics}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {visiblePhysics.map((tool) => {
                  const isActive = activeTool === tool;
                  const count = remainingBudget[tool];
                  const depleted =
                    mode === "puzzle" && count !== undefined && count <= 0;

                  return (
                    <div key={tool} className="hw-tip-wrap">
                      <button
                        type="button"
                        onClick={() => onSelectTool(tool)}
                        className={`hw-btn ${isActive ? "is-selected" : ""}`}
                        style={{
                          opacity: depleted && !isActive ? 0.48 : 1,
                          padding: "5px 10px",
                          fontSize: 12.5,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <PhysicsGlyph tool={tool} />
                        <span>{t.tools[tool]}</span>
                        {mode === "puzzle" && count !== undefined && (
                          <span
                            className="mono"
                            style={{
                              fontSize: 10.5,
                              color: count > 0 ? "var(--ink)" : "var(--slate)",
                              backgroundColor: "var(--tray-well)",
                              padding: "1px 5px",
                              borderRadius: 5,
                            }}
                          >
                            {count}
                          </span>
                        )}
                      </button>
                      <span className="hw-tip">{t.tooltips[tool]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div
          style={{
            width: 1,
            height: 30,
            backgroundColor: "var(--border-strong)",
            alignSelf: "center",
          }}
        />

        {/* Group 3: Studio Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={groupLabelStyle}>{t.groups.studio}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {hasSelection && (
              <div className="hw-tip-wrap">
                <button
                  type="button"
                  onClick={onDeleteSelected}
                  className="hw-btn"
                  style={{
                    borderColor: "var(--accent)",
                    backgroundColor: "var(--accent-tint)",
                    color: "var(--accent)",
                    padding: "5px 9px",
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  {t.deleteSelected}
                </button>
                <span className="hw-tip">{t.tooltips.remove}</span>
              </div>
            )}

            <div className="hw-tip-wrap">
              <button
                type="button"
                disabled={!canUndo}
                onClick={onUndo}
                className="hw-btn"
                style={{
                  opacity: canUndo ? 1 : 0.42,
                  padding: "5px 9px",
                  fontSize: 12.5,
                }}
              >
                {t.undo}
              </button>
              <span className="hw-tip">{t.tooltips.undo}</span>
            </div>

            <div className="hw-tip-wrap">
              <button
                type="button"
                disabled={!canRedo}
                onClick={onRedo}
                className="hw-btn"
                style={{
                  opacity: canRedo ? 1 : 0.42,
                  padding: "5px 9px",
                  fontSize: 12.5,
                }}
              >
                {t.redo}
              </button>
              <span className="hw-tip">{t.tooltips.redo}</span>
            </div>

            {mode === "puzzle" ? (
              <div className="hw-tip-wrap">
                <button
                  type="button"
                  onClick={onToggleHint}
                  className={`hw-btn ${showHint ? "is-selected" : ""}`}
                  style={{
                    padding: "5px 9px",
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  {showHint ? t.hideHint : t.hint}
                </button>
                <span className="hw-tip">{t.tooltips.hint}</span>
              </div>
            ) : (
              <div className="hw-tip-wrap">
                <button
                  type="button"
                  onClick={onShareLink}
                  className="hw-btn"
                  style={{
                    backgroundColor: shareCopied ? "#4D8A78" : "#F7F8F5",
                    borderColor: shareCopied ? "#2D5448" : "var(--border)",
                    color: shareCopied ? "#F7F8F5" : "var(--ink)",
                    padding: "5px 9px",
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  {shareCopied ? t.copied : t.shareLink}
                </button>
                <span className="hw-tip">{t.tooltips.share}</span>
              </div>
            )}

            <div className="hw-tip-wrap">
              <button
                type="button"
                onClick={onResetOrClear}
                className="hw-btn"
                style={{
                  padding: "5px 9px",
                  fontSize: 12.5,
                }}
              >
                {mode === "puzzle" ? t.reset : t.clear}
              </button>
              <span className="hw-tip">
                {mode === "puzzle" ? t.tooltips.reset : t.tooltips.clear}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
