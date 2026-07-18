export default function Kpi({ label, value, delta, accent, title }) {
  const classes = ["kpi"];
  if (accent) classes.push(`kpi-${accent}`);
  return (
    <div className={classes.join(" ")} title={title}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {delta != null && <span className="kpi-delta">{delta}</span>}
    </div>
  );
}
