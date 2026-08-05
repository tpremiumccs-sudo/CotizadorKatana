import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Necesario para la imagen Docker: produce .next/standalone con sus dependencias.
  output: 'standalone',

  reactStrictMode: true,
  poweredByHeader: false,

  // Paquetes que deben resolverse en Node y nunca empaquetarse por Turbopack/webpack.
  serverExternalPackages: ['@node-rs/argon2', 'exceljs', 'playwright', 'pino'],

  experimental: {
    serverActions: {
      // El origen público detrás de Cloudflare Tunnel; sin esto Next rechaza las
      // Server Actions por comprobación de origen cruzado.
      allowedOrigins: [
        new URL(process.env.APP_PUBLIC_URL ?? 'http://localhost:3000').host,
      ],
      // La subida de Excel NO va por Server Action (usa /api/importaciones),
      // así que el límite se queda pequeño a propósito.
      bodySizeLimit: '1mb',
    },
  },

  eslint: {
    // El lint corre como paso propio en CI; no debe bloquear el build de la imagen.
    ignoreDuringBuilds: true,
  },
}

export default nextConfig
