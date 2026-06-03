import { Link } from "react-router-dom";
import { useCustomerSession } from "@viu/emporix-sdk-react";

export function AccountMenu() {
  const { isAuthenticated } = useCustomerSession();
  return (
    <Link to="/account" className="u-underline">
      {isAuthenticated ? "Account" : "Sign in"}
    </Link>
  );
}
