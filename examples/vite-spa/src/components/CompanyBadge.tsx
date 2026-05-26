import { useActiveCompany } from "@viu/emporix-sdk-react";

/** Small badge showing the current B2B/B2C mode. */
export function CompanyBadge(): React.JSX.Element {
  const { mode, activeCompany } = useActiveCompany();
  const label =
    mode === "b2b"
      ? (activeCompany?.name ?? "")
      : mode === "b2c"
        ? "B2C"
        : "Bitte Firma wählen";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        marginLeft: 8,
        borderRadius: 4,
        background: "#eef",
        fontSize: 12,
      }}
    >
      {label}
    </span>
  );
}
