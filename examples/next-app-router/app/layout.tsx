import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Providers } from "./providers";

export const metadata = { title: "Emporix SDK — Next App Router example" };

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<React.JSX.Element> {
  // Next 15: `cookies()` is async.
  const token = (await cookies()).get("emporix.customerToken")?.value;
  const providerProps = token !== undefined ? { initialCustomerToken: token } : {};
  return (
    <html lang="en">
      <body>
        <Providers {...providerProps}>{children}</Providers>
      </body>
    </html>
  );
}
