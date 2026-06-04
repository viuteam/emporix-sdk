import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "accent" | "solid" | "outline" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  block?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "solid",
  size = "md",
  block = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  const cls = ["btn", `btn--${variant}`, size === "sm" && "btn--sm", block && "btn--block", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
