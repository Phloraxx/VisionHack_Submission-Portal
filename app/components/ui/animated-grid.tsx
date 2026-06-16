/**
 * AnimatedGrid — fine SVG grid with staggered amber cell pulses.
 *
 * Grid lines: white, 1px stroke, ~18% opacity — visible structure.
 * Lit cells:  console amber at 15% peak — crisp warm pixel, not a blob.
 * No JS runtime. Deterministic positions = no hydration mismatch.
 */

import { cn } from "~/lib/utils";

interface AnimatedGridProps {
  cellSize?:    number;
  numCells?:    number;
  maxOpacity?:  number;
  lineOpacity?: number;
  lineColor?:   string; // default "white"; pass "black" or a CSS color for light panels
  cellColor?:   string; // default warm off-white
  className?:   string;
}

function sr(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

export function AnimatedGrid({
  cellSize    = 20,
  numCells    = 30,
  maxOpacity  = 0.15,
  lineOpacity = 0.18,
  lineColor   = "white",
  cellColor   = "oklch(0.92 0.04 75)",
  className,
}: AnimatedGridProps) {
  const cols = 48;
  const rows = 32;

  const cells = Array.from({ length: numCells }, (_, i) => ({
    col: Math.floor(sr(i * 3)     * cols),
    row: Math.floor(sr(i * 3 + 1) * rows),
    dur: 4 + sr(i * 3 + 2) * 5,
    del: sr(i * 7 + 5)     * 9,
  }));

  const vbW = cols * cellSize;
  const vbH = rows * cellSize;

  return (
    <svg
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full",
        className,
      )}
      viewBox={`0 0 ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern
          id="vh-agl"
          width={cellSize}
          height={cellSize}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${cellSize} 0 L 0 0 0 ${cellSize}`}
            fill="none"
            stroke={lineColor}
            strokeWidth="1"
            strokeOpacity={lineOpacity}
          />
        </pattern>
      </defs>

      <rect width="100%" height="100%" fill="url(#vh-agl)" />

      {cells.map(({ col, row, dur, del }, i) => (
        <rect
          key={i}
          className="vh-gc"
          x={col * cellSize + 1}
          y={row * cellSize + 1}
          width={cellSize - 2}
          height={cellSize - 2}
          fill={cellColor}
          fillOpacity={maxOpacity}
          style={{
            animation: `vh-grid-pulse ${dur.toFixed(2)}s ease-in-out ${del.toFixed(2)}s infinite`,
          }}
        />
      ))}
    </svg>
  );
}
