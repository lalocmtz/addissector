import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { LocaleProvider, DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Addissector",
  description: "Creative strategy for Meta Ads.",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔬</text></svg>",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jar = await cookies();
  const raw = jar.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const theme = jar.get("theme")?.value === "dark" ? "dark" : "light";
  return (
    <html lang={locale} data-theme={theme}>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,500;0,6..72,600;1,6..72,500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">
        <LocaleProvider locale={locale}>
          <div className="min-h-screen flex flex-col">{children}</div>
        </LocaleProvider>
      </body>
    </html>
  );
}
