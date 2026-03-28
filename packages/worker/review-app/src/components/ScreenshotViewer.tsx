import { useRef, useState } from "react";
import type { CaptureEntry } from "../types";

interface ScreenshotViewerProps {
  captures: CaptureEntry[];
}

function resolveUrl(path?: string): string | undefined {
  if (!path) return undefined;
  return path.startsWith("/") ? path : `/review-data/${path}`;
}

export function ScreenshotViewer({ captures }: ScreenshotViewerProps) {
  const [activeRoute, setActiveRoute] = useState(0);
  const [viewMode, setViewMode] = useState<"slider" | "side-by-side" | "diff">(
    "slider",
  );
  const capture = captures[activeRoute];

  return (
    <div style={{ marginTop: 6 }}>
      {/* Route tabs + view mode in one row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {captures.map((c, i) => (
            <button
              key={c.route}
              onClick={() => setActiveRoute(i)}
              style={{
                padding: "3px 10px",
                border: "1px solid #ccc",
                borderRadius: 4,
                background: i === activeRoute ? "#1976d2" : "#fff",
                color: i === activeRoute ? "#fff" : "#333",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: i === activeRoute ? 600 : 400,
              }}
            >
              {c.route}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {(
            [
              { key: "slider", label: "Slider" },
              { key: "side-by-side", label: "Side by Side" },
              { key: "diff", label: "Diff" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setViewMode(key)}
              style={{
                padding: "3px 8px",
                border: "1px solid #ccc",
                borderRadius: 3,
                background: viewMode === key ? "#333" : "#fff",
                color: viewMode === key ? "#fff" : "#555",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Screenshot comparison */}
      {capture && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e0e0e0",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {viewMode === "slider" && (
            <SliderComparison
              before={resolveUrl(capture.before)}
              after={resolveUrl(capture.after)}
            />
          )}
          {viewMode === "side-by-side" && (
            <div style={{ display: "flex", height: "55vh" }}>
              <ScreenshotPane label="Before" src={resolveUrl(capture.before)} />
              <div style={{ width: 2, background: "#e0e0e0", flexShrink: 0 }} />
              <ScreenshotPane label="After" src={resolveUrl(capture.after)} />
            </div>
          )}
          {viewMode === "diff" && (
            <div
              style={{
                position: "relative",
                height: "55vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#f0f0f0",
              }}
            >
              <img
                src={resolveUrl(capture.diff)}
                alt="Visual diff"
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                  display: "block",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 8,
                  left: 8,
                  background: "rgba(0,0,0,0.7)",
                  color: "#fff",
                  padding: "4px 10px",
                  borderRadius: 4,
                  fontSize: 12,
                }}
              >
                Pink/red pixels = changed areas
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SliderComparison({
  before,
  after,
}: {
  before?: string;
  after?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sliderPos, setSliderPos] = useState(50);
  const [imageLoaded, setImageLoaded] = useState(false);

  function updatePosition(clientX: number) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPos(pct);
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        cursor: "col-resize",
        userSelect: "none",
        overflow: "hidden",
        height: "55vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f0f0f0",
      }}
      onMouseMove={(e) => updatePosition(e.clientX)}
      onTouchMove={(e) => updatePosition(e.touches[0].clientX)}
    >
      {/* After image (full size, scaled to fit) */}
      {after && (
        <img
          src={after}
          alt="After"
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            display: "block",
          }}
          onLoad={() => setImageLoaded(true)}
        />
      )}

      {/* Before image (clipped) */}
      {before && imageLoaded && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            clipPath: `inset(0 ${100 - sliderPos}% 0 0)`,
          }}
        >
          <img
            src={before}
            alt="Before"
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              display: "block",
            }}
          />
        </div>
      )}

      {/* Slider line and handle */}
      {imageLoaded && (
        <>
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${sliderPos}%`,
              width: 3,
              background: "#fff",
              boxShadow: "0 0 6px rgba(0,0,0,0.5)",
              transform: "translateX(-50%)",
              zIndex: 10,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: `${sliderPos}%`,
              transform: "translate(-50%, -50%)",
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "#fff",
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 11,
              fontSize: 14,
            }}
          >
            ⟨⟩
          </div>
          {/* Labels pinned to slider divider */}
          <div
            style={{
              position: "absolute",
              top: 8,
              left: `${sliderPos}%`,
              transform: "translateX(calc(-100% - 8px))",
              background: "rgba(220,60,60,0.85)",
              color: "#fff",
              padding: "4px 10px",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
              zIndex: 12,
            }}
          >
            ◄ Before
          </div>
          <div
            style={{
              position: "absolute",
              top: 8,
              left: `${sliderPos}%`,
              transform: "translateX(8px)",
              background: "rgba(46,125,50,0.85)",
              color: "#fff",
              padding: "4px 10px",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
              zIndex: 12,
            }}
          >
            After ►
          </div>
        </>
      )}
    </div>
  );
}

function ScreenshotPane({ label, src }: { label: string; src?: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          fontWeight: 600,
          padding: "4px 12px",
          background: "#f5f5f5",
          fontSize: 12,
          flexShrink: 0,
        }}
      >
        {label}
      </div>
      {src ? (
        <img
          src={src}
          alt={label}
          style={{
            width: "100%",
            flex: 1,
            objectFit: "contain",
            display: "block",
            minHeight: 0,
          }}
        />
      ) : (
        <div
          style={{
            background: "#f5f5f5",
            padding: 40,
            textAlign: "center",
            color: "#999",
          }}
        >
          No screenshot available
        </div>
      )}
    </div>
  );
}
