import { emporixSession } from "@viu/emporix-sdk-next";
import type { ReactNode } from "react";
import { Providers } from "./providers";

export const metadata = { title: "Emporix SDK — Next App Router example" };

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<React.JSX.Element> {
  // Read-only session: a Server Component may not write cookies.
  const { customerToken } = await emporixSession();
  const providerProps = customerToken !== null ? { initialCustomerToken: customerToken } : {};
  return (
    <html lang="en">
      <body>
        <Providers {...providerProps}>{children}</Providers>
      </body>
    </html>
  );
}
