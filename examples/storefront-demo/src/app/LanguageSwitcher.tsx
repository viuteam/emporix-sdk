import { useActiveSite, useSiteContext } from "@viu/emporix-sdk-react";

export function LanguageSwitcher() {
  const { language, setLanguage } = useSiteContext();
  const activeSite = useActiveSite();
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
      className="switcher"
    >
      {languages.map((l) => (
        <option key={l} value={l}>
          {l.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
