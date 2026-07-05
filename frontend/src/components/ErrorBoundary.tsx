import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("JurisGuard dashboard boundary caught an error", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="rounded-xl border border-amber-200 dark:border-amber-400/25 bg-amber-50 dark:bg-amber-400/10 px-4 py-3 text-sm font-medium text-amber-800 dark:text-amber-300">
            This section could not be loaded. Other dashboard sections remain available.
          </div>
        )
      );
    }

    return this.props.children;
  }
}

