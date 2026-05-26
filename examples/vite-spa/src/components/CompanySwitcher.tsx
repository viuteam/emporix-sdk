import { useCompanySwitcher } from "@viu/emporix-sdk-react";

/** Header dropdown listing the customer's assigned legal entities. */
export function CompanySwitcher(): React.JSX.Element | null {
  const { companies, active, status, switch: switchTo, clear } = useCompanySwitcher();
  if (companies.length === 0) return null;
  return (
    <select
      aria-label="Active company"
      disabled={status === "switching"}
      value={active?.id ?? ""}
      onChange={(e) => {
        const value = e.target.value;
        if (value === "") void clear();
        else void switchTo(value);
      }}
    >
      <option value="">Privat (B2C)</option>
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
