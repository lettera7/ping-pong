import { StrictMode, Component, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error;
      return (
        <div style={{ fontFamily: "monospace", padding: 20, background: "#fff1f0", color: "#c0392b", border: "2px solid #c0392b", margin: 20, borderRadius: 4 }}>
          <strong>❌ Errore React</strong>
          <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", fontSize: 12 }}>{err.message}{"\n"}{err.stack}</pre>
        </div>
      );
    }
    return this.state.error === null ? this.props.children : null;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
