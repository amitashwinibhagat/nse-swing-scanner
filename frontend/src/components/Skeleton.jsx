export function CardSkeleton() {
  return (
    <div className="stock-card skeleton-card" aria-hidden="true">
      <header className="stock-card-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="skeleton skeleton-line" style={{ width: "70%", height: 18 }} />
          <div className="skeleton skeleton-line" style={{ width: "50%", height: 11, marginTop: 10 }} />
          <div className="skeleton skeleton-line" style={{ width: "40%", height: 10, marginTop: 6 }} />
        </div>
        <div
          className="skeleton"
          style={{ width: 56, height: 56, borderRadius: "50%", flexShrink: 0 }}
        />
      </header>
      <div className="stock-card-metrics">
        {[1, 2, 3, 4].map((i) => (
          <div className="stock-card-metric" key={i}>
            <div className="skeleton skeleton-line" style={{ width: 32, height: 9 }} />
            <div className="skeleton skeleton-line" style={{ width: 56, height: 14, marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className="stock-card-plan">
        <div className="skeleton skeleton-line" style={{ width: "75%", height: 13 }} />
      </div>
      <footer className="stock-card-footer">
        <div className="skeleton skeleton-line" style={{ width: 48, height: 20 }} />
      </footer>
    </div>
  );
}

export function SkeletonGrid({ n = 6 }) {
  return (
    <div className="stock-grid" aria-busy="true" aria-label="Loading scan results">
      {Array.from({ length: n }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
