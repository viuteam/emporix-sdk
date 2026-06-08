import { useSites, useSiteContext } from "@viu/emporix-sdk-react";

const selectStyle = {
  width: "auto",
  border: "none",
  padding: "0.2em 0.3em",
  fontSize: "var(--step--2)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.12em",
  background: "transparent",
};

export function LanguageSwitcher() {
  const { siteCode, language, setLanguage } = useSiteContext();
  const { data: sites } = useSites();
  const activeSite = sites?.find((s) => s.code === siteCode);
  const languages =
    activeSite?.languages && activeSite.languages.length > 0
      ? activeSite.languages
      : language
        ? [language]
        : [];
  if (languages.length <= 1) return null;
  return (
    <select
      aria-label="Language"
      value={language ?? ""}
      onChange={(e) => void setLanguage(e.target.value)}
      className="field__control"
      style={selectStyle}
    >
      {languages.map((l) => (
        <option key={l} value={l}>
          {l.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
