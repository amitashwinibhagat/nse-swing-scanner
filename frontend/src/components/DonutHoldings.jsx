const COLORS = ["var(--accent)", "var(--success)", "var(--warning)"];
const LABELS = ["Promoter", "FII", "DII"];

function polarToCartesian(cx, cy, r, angleDeg) {
  // 0deg = top, increases clockwise
  const a = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

export default function DonutHoldings({ promoter, fii, dii, size = 88 }) {
  const segs = [
    { v: promoter, color: COLORS[0], name: LABELS[0] },
    { v: fii,      color: COLORS[1], name: LABELS[1] },
    { v: dii,      color: COLORS[2], name: LABELS[2] },
  ];
  const total = segs.reduce((a, s) => a + (s.v || 0), 0);

  if (!total || segs.every((s) => s.v == null)) {
    return <p className="na">No holdings breakdown available</p>;
  }

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  let acc = 0;
  const arcs = segs
    .filter((s) => s.v != null && s.v > 0)
    .map((s, i) => {
      const startAngle = (acc / total) * 360;
      acc += s.v;
      const endAngle = (acc / total) * 360;
      return (
        <path
          key={i}
          d={arcPath(cx, cy, r, startAngle, endAngle)}
          fill={s.color}
          style={{ transition: "all 600ms var(--ease-out)" }}
        >
          <title>
            {s.name} {s.v.toFixed(1)}%
          </title>
        </path>
      );
    });

  const ariaLabel = segs
    .map((s) => `${s.name} ${s.v != null ? s.v.toFixed(1) : 0}%`)
    .join(", ");

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="donut"
      role="img"
      aria-label={`Holdings breakdown: ${ariaLabel}`}
    >
      {arcs}
      <circle cx={cx} cy={cy} r={r * 0.55} fill="var(--surface-1)" />
      <text
        x="50%"
        y="48%"
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="9"
        fontWeight="600"
        fill="var(--text-faint)"
        style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}
      >
        mix
      </text>
    </svg>
  );
}
