import { Component, type ErrorInfo, type ReactNode } from "react";
import { EmporixError, EmporixAuthError } from "@viu/emporix-sdk";

interface Props {
  children: ReactNode;
  fallback: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}
interface State {
  error: Error | null;
}

/** Catches render errors (including thrown {@link EmporixError}) and shows a fallback. */
export class EmporixErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  render(): ReactNode {
    if (this.state.error) return this.props.fallback;
    return this.props.children;
  }
}

/** Returns a handler that runs `onAuthError` for {@link EmporixAuthError}, else `onError`. */
export function useEmporixErrorHandler(handlers: {
  onAuthError?: (e: EmporixAuthError) => void;
  onError?: (e: EmporixError) => void;
}): (error: unknown) => void {
  return (error: unknown) => {
    if (error instanceof EmporixAuthError) handlers.onAuthError?.(error);
    else if (error instanceof EmporixError) handlers.onError?.(error);
  };
}
