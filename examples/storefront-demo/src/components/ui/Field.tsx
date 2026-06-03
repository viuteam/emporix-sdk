import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function Field({ label, error, hint, id, className, ...rest }: FieldProps) {
  const fid = id ?? `f-${slug(label)}`;
  return (
    <label className="field" htmlFor={fid}>
      <span className="field__label">{label}</span>
      <input
        id={fid}
        className={["field__control", className].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {error ? <span className="field__error">{error}</span> : null}
      {!error && hint ? <span className="muted" style={{ fontSize: "var(--step--1)" }}>{hint}</span> : null}
    </label>
  );
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  children: ReactNode;
}

export function SelectField({ label, id, className, children, ...rest }: SelectFieldProps) {
  const fid = id ?? `f-${slug(label)}`;
  return (
    <label className="field" htmlFor={fid}>
      <span className="field__label">{label}</span>
      <select id={fid} className={["field__control", className].filter(Boolean).join(" ")} {...rest}>
        {children}
      </select>
    </label>
  );
}
