import { Link } from "react-router-dom";
import { useCustomerSession } from "@viu/emporix-sdk-react";

export function AccountMenu() {
  const { isAuthenticated } = useCustomerSession();
  return (
    <Link to="/account" className="main-bar__link">
      {isAuthenticated ? "Account" : "Sign in"}
    </Link>
  );
}
