import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmporixErrorBoundary } from "../src/errors";

function Boom(): React.JSX.Element {
  throw new Error("kaboom");
}

describe("EmporixErrorBoundary", () => {
  it("renders fallback on error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <EmporixErrorBoundary fallback={<span>failed</span>}>
        <Boom />
      </EmporixErrorBoundary>,
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("renders children when no error", () => {
    render(
      <EmporixErrorBoundary fallback={<span>failed</span>}>
        <span>ok</span>
      </EmporixErrorBoundary>,
    );
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
