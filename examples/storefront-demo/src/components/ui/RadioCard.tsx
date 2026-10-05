import type { ReactNode } from "react";

/**
 * A radio button inside a bordered card, for sites, saved addresses, delivery
 * methods and payment modes. The whole card is the label, so a click anywhere
 * selects it; the checked card is highlighted by `.radio-card:has(input:checked)`.
 */
export function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  aside,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  title: ReactNode;
  description?: ReactNode | undefined;
  aside?: ReactNode | undefined;
}) {
  return (
    <label className="radio-card">
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} />
      <span>
        <span className="radio-card__title">{title}</span>
        {description ? <span className="radio-card__desc">{description}</span> : null}
      </span>
      <span className="radio-card__value">{aside}</span>
    </label>
  );
}
