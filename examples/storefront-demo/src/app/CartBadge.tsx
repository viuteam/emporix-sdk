import { Link } from "react-router-dom";
import { useActiveCart } from "@viu/emporix-sdk-react";

export function CartBadge() {
  const { data: cart } = useActiveCart();
  const count = cart?.items?.length ?? 0;
  return (
    <Link to="/cart" className="cart-link">
      Cart
      {count ? (
        <span className="cart-link__count">
          {count}
          <span className="sr-only"> items</span>
        </span>
      ) : null}
    </Link>
  );
}
