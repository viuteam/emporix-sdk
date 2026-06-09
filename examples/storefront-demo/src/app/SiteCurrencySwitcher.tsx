import { useActiveSite, useSites, useSiteContext } from "@viu/emporix-sdk-react";

const selectStyle = {
  width: "auto",
  border: "none",
  padding: "0.2em 0.3em",
  fontSize: "var(--step--2)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.12em",
  background: "transparent",
};

export function SiteCurrencySwitcher() {
  const { siteCode, currency, setSite, setCurrency } = useSiteContext();
  const { data: sites } = useSites();
  const activeSite = useActiveSite();
  // Currencies the active site supports; fall back to just the active currency.
  const currencies =
    activeSite?.availableCurrencies && activeSite.availableCurrencies.length > 0
      ? activeSite.availableCurrencies
      : currency
        ? [currency]
        : [];

  const showSites = !!sites && sites.length > 1;
  const showCurrencies = currencies.length > 1;
  if (!showSites && !showCurrencies) return null;

  return (
    <div className="cluster" style={{ gap: "var(--s-1)", alignItems: "center" }}>
      {showSites ? (
        <select
          aria-label="Site"
          value={siteCode ?? ""}
          onChange={(e) => void setSite(e.target.value || null)}
          className="field__control"
          style={selectStyle}
        >
          {sites!.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
      ) : null}
      {showCurrencies ? (
        <select
          aria-label="Currency"
          value={currency ?? ""}
          onChange={(e) => void setCurrency(e.target.value)}
          className="field__control"
          style={selectStyle}
        >
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
