import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Creiai Cinema — ver películas con amigos",
  description: "Sala virtual sincronizada para ver películas con amigos",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${geist.variable} h-full`}>
      <body className="min-h-full bg-neutral-950 text-white antialiased">
        {children}
      </body>
    </html>
  );
}
