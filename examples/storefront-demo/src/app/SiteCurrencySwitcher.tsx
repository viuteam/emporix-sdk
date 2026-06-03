import { useSites, useSiteContext } from "@viu/emporix-sdk-react";

export function SiteCurrencySwitcher() {
  const { siteCode, setSite } = useSiteContext();
  const { data: sites } = useSites();
  if (!sites || sites.length <= 1) return null;
  return (
    <select
      aria-label="Site"
      value={siteCode ?? ""}
      onChange={(e) => void setSite(e.target.value || null)}
      className="field__control"
      style={{
        width: "auto",
        border: "none",
        padding: "0.2em 0.3em",
        fontSize: "var(--step--2)",
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        background: "transparent",
      }}
    >
      {sites.map((s) => (
        <option key={s.code} value={s.code}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
