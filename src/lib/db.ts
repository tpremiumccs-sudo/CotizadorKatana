import 'server-only'
import { PrismaClient } from '@prisma/client'

/**
 * Cliente Prisma como singleton. En desarrollo Next recarga los módulos en
 * cada cambio; sin el global se abrirían decenas de pools contra Postgres.
 */
const globalParaPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalParaPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalParaPrisma.prisma = prisma
}
