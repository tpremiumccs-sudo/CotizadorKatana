import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Cotizador · Katana Talent',
    template: '%s · Cotizador Katana',
  },
  description:
    'Cotizador de talento de Katana Talent: tabuladores de tarifas y cotizaciones para marcas.',
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Sin maximumScale: bloquear el zoom rompe la accesibilidad y iPadOS lo ignora.
  viewportFit: 'cover',
  themeColor: '#7B2FBE',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  )
}
