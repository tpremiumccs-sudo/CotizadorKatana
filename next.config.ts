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

  typescript: {
    // Igual que el lint: CI lo comprueba en su propio paso (`npm run typecheck`).
    // Dentro de la imagen se salta porque `next build` type-chequea de paso los
    // tests —casi 700 KB de TypeScript que no acaban en la imagen— y ese pico de
    // memoria es el que tumba la compilación en un servidor de 4 GB.
    // Fuera de Docker sigue activo: en local y en CI el type-check no se toca.
    ignoreBuildErrors: process.env.SALTAR_TYPECHECK === '1',
  },
}

export default nextConfig
