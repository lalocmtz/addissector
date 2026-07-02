import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdDNA — La inteligencia detrás de tus anuncios ganadores",
  description: "Sube el creativo que ya te funciona, entiende por qué convierte y genera variantes listas para producir. La plataforma de inteligencia creativa para dueños de ecommerce.",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔬</text></svg>",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">
        <div className="min-h-screen flex flex-col">
          {children}
        </div>
      </body>
    </html>
  );
}
