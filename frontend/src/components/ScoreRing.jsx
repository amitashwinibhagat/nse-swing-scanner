import { useId } from "react";

/**
 * Animated radial score indicator.
 * size: outer pixel size of the square SVG (default 56).
 * strokeWidth: ring thickness (default 4).
 */
export default function ScoreRing({ score, size = 56, strokeWidth = 4 }) {
  const reactId = useId();
  const gradId = `ring-grad-${reactId.replace(/[:]/g, "")}`;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;

  if (score == null || Number.isNaN(score)) {
    return (
      <div className="score-ring-empty" style={{ width: size, height: size }} aria-label="No score">
        —
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, score)) / 100;
  const labelScore = Math.round(score);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="score-ring"
      role="img"
      aria-label={`Score ${labelScore} out of 100`}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent-bright)" />
          <stop offset="100%" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--border)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 700ms var(--ease-out)" }}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dy="0.35em"
        fontFamily="var(--font-mono)"
        fontSize={Math.max(11, size * 0.26)}
        fontWeight="600"
        fill="var(--text)"
      >
        {labelScore}
      </text>
    </svg>
  );
}
