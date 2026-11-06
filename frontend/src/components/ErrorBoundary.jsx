import { Component } from "react";

/**
 * Last line of defence. The dashboard is a static SPA reading committed JSON,
 * so there is no server-side fallback: an unhandled render error leaves the
 * customer with a blank white page and no explanation. A saved zero-share
 * trade did exactly that in production (see trades.js).
 *
 * The boundary keeps the shell, explains what happened, and offers a way out
 * (reload). It deliberately does NOT swallow the error: it is logged so it
 * shows up in the console and in any future error reporting.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("Dashboard crashed:", error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="app">
        <div className="empty-state" role="alert">
          <h2>Something broke in the dashboard</h2>
          <p>
            The scan data loaded, but rendering it failed. This is a bug in the
            dashboard, not in the scan.
          </p>
          <p className="perf-fineprint">
            <code>{String(error?.message || error)}</code>
          </p>
          <p>
            <button type="button" className="link-button" onClick={this.handleReset}>
              Try again
            </button>
            {" · "}
            <button
              type="button"
              className="link-button"
              onClick={() => window.location.reload()}
            >
              Reload the page
            </button>
            {" · "}
            <a href="/data/latest_scan.json">View the raw scan JSON</a>
          </p>
          <p className="perf-fineprint">
            If it keeps happening, your saved trade journal or watchlist in this
            browser may be in an unexpected shape.
          </p>
        </div>
      </div>
    );
  }
}
