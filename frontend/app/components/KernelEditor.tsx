"use client";

import { useState, useCallback, useRef, useEffect } from "react";

const X15 = BigInt(2) ** BigInt(15); // 32768

interface KernelEditorProps {
  spacing: bigint;
  onChange: (breakpoints: Array<[bigint, bigint]>) => void;
}

interface Point {
  x: number; // 0..1 normalized position
  y: number; // 0..1 normalized height
}

const W = 400, H = 180, PAD = 30;

function toSvgX(x: number) { return PAD + x * (W - 2 * PAD); }
function toSvgY(y: number) { return H - PAD - y * (H - 2 * PAD); }
function fromSvgX(sx: number) { return Math.max(0, Math.min(1, (sx - PAD) / (W - 2 * PAD))); }
function fromSvgY(sy: number) { return Math.max(0, Math.min(1, (H - PAD - sy) / (H - 2 * PAD))); }

export function KernelEditor({ spacing, onChange }: KernelEditorProps) {
  // Internal points are normalized [0..1, 0..1]. First=(0,0), Last=(1,1) always.
  const [points, setPoints] = useState<Point[]>([
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]);
  const [dragging, setDragging] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Convert to protocol breakpoints whenever points change
  useEffect(() => {
    const breakpoints: Array<[bigint, bigint]> = points.map((p) => [
      BigInt(Math.round(p.x * Number(spacing))),
      BigInt(Math.round(p.y * Number(X15))),
    ]);
    // Ensure first is [0,0] and last is [spacing, X15]
    breakpoints[0] = [0n, 0n];
    breakpoints[breakpoints.length - 1] = [spacing, X15];
    onChange(breakpoints);
  }, [points, spacing, onChange]);

  const sortPoints = (pts: Point[]) =>
    [...pts].sort((a, b) => a.x - b.x || a.y - b.y);

  const handleMouseDown = useCallback(
    (idx: number, e: React.MouseEvent) => {
      e.preventDefault();
      if (idx === 0 || idx === points.length - 1) return; // can't drag endpoints
      setDragging(idx);
    },
    [points]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragging === null || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setPoints((prev) => {
        const next = [...prev];
        next[dragging] = { x: fromSvgX(sx), y: fromSvgY(sy) };
        return next;
      });
    },
    [dragging]
  );

  const handleMouseUp = useCallback(() => {
    if (dragging !== null) {
      setPoints((prev) => sortPoints(prev));
      setDragging(null);
    }
  }, [dragging]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (dragging !== null) return;
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = fromSvgX(e.clientX - rect.left);
      const y = fromSvgY(e.clientY - rect.top);
      if (x <= 0.01 || x >= 0.99) return; // too close to endpoints
      setPoints((prev) => sortPoints([...prev, { x, y }]));
    },
    [dragging]
  );

  const handleDoubleClick = useCallback(
    (idx: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (idx === 0 || idx === points.length - 1) return;
      setPoints((prev) => prev.filter((_, i) => i !== idx));
    },
    [points]
  );

  const setPreset = (preset: "linear" | "step" | "concentrated") => {
    if (preset === "linear") {
      setPoints([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    } else if (preset === "step") {
      setPoints([
        { x: 0, y: 0 },
        { x: 0.5, y: 0 },
        { x: 0.5, y: 1 },
        { x: 1, y: 1 },
      ]);
    } else {
      setPoints([
        { x: 0, y: 0 },
        { x: 0.3, y: 0 },
        { x: 0.3, y: 0.5 },
        { x: 0.7, y: 0.5 },
        { x: 0.7, y: 1 },
        { x: 1, y: 1 },
      ]);
    }
  };

  // Build SVG path
  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toSvgX(p.x)} ${toSvgY(p.y)}`)
    .join(" ");

  // Fill area under curve
  const fillD =
    pathD +
    ` L ${toSvgX(1)} ${toSvgY(0)} L ${toSvgX(0)} ${toSvgY(0)} Z`;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-gray-400">Kernel Shape (Liquidity Distribution)</p>
        <div className="flex gap-1">
          {(["linear", "step", "concentrated"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className="px-2 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 rounded transition capitalize"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-gray-700 rounded-lg bg-gray-900 overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full cursor-crosshair select-none"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleClick}
        >
          {/* Grid */}
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <g key={`grid-${v}`}>
              <line
                x1={toSvgX(v)} y1={toSvgY(0)} x2={toSvgX(v)} y2={toSvgY(1)}
                stroke="#374151" strokeWidth="0.5"
              />
              <line
                x1={toSvgX(0)} y1={toSvgY(v)} x2={toSvgX(1)} y2={toSvgY(v)}
                stroke="#374151" strokeWidth="0.5"
              />
            </g>
          ))}

          {/* Axes labels */}
          <text x={W / 2} y={H - 4} textAnchor="middle" fill="#6b7280" fontSize="9">
            Position (0 to qSpacing)
          </text>
          <text x={8} y={H / 2} textAnchor="middle" fill="#6b7280" fontSize="9"
            transform={`rotate(-90, 8, ${H / 2})`}>
            k(h)
          </text>
          <text x={toSvgX(0)} y={H - PAD + 14} textAnchor="middle" fill="#4b5563" fontSize="8">0</text>
          <text x={toSvgX(1)} y={H - PAD + 14} textAnchor="middle" fill="#4b5563" fontSize="8">1</text>
          <text x={PAD - 8} y={toSvgY(0) + 3} textAnchor="end" fill="#4b5563" fontSize="8">0</text>
          <text x={PAD - 8} y={toSvgY(1) + 3} textAnchor="end" fill="#4b5563" fontSize="8">1</text>

          {/* Fill under curve */}
          <path d={fillD} fill="#3b82f6" opacity="0.1" />

          {/* Curve */}
          <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="2" />

          {/* Breakpoints */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={toSvgX(p.x)}
              cy={toSvgY(p.y)}
              r={i === 0 || i === points.length - 1 ? 4 : 6}
              fill={
                dragging === i
                  ? "#f59e0b"
                  : i === 0 || i === points.length - 1
                  ? "#6b7280"
                  : "#3b82f6"
              }
              stroke="#fff"
              strokeWidth="1.5"
              className={
                i === 0 || i === points.length - 1
                  ? ""
                  : "cursor-grab hover:fill-blue-400"
              }
              onMouseDown={(e) => handleMouseDown(i, e)}
              onDoubleClick={(e) => handleDoubleClick(i, e)}
            />
          ))}
        </svg>
      </div>

      <p className="text-xs text-gray-500 mt-1">
        Click to add points. Drag to move. Double-click to remove. {points.length} breakpoints.
      </p>
    </div>
  );
}
