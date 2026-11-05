import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Application view failed to render.", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="state error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <b>This page could not be displayed.</b>
          <span>Reload the workspace to try again.</span>
          <button className="btn ghost" type="button" onClick={() => window.location.reload()}>
            <RefreshCw size={15} aria-hidden="true" />
            Reload workspace
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}
