import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Providers } from "./providers";

export const metadata = { title: "Emporix SDK — Next App Router example" };

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const token = cookies().get("emporix.customerToken")?.value;
  const providerProps = token !== undefined ? { initialCustomerToken: token } : {};
  return (
    <html lang="en">
      <body>
        <Providers {...providerProps}>{children}</Providers>
      </body>
    </html>
  );
}
