import 'server-only'
import { prisma } from '@/lib/db'
import { autorizar } from '@/server/data/autorizar'

/**
 * Catálogo: talentos y formatos que se pueden meter en una cotización.
 */

export async function opcionesParaNueva() {
  await autorizar('cotizacion.crear')

  const [talentos, formatos] = await Promise.all([
    prisma.talent.findMany({
      where: { isActive: true },
      orderBy: { displayName: 'asc' },
      select: {
        id: true, displayName: true, category: true,
        // Cuántos formatos tienen precio de verdad: es lo que distingue a un
        // talento listo para cotizar de uno que sólo está dado de alta.
        _count: { select: { rates: { where: { priceStatus: 'QUOTED' } } } },
      },
    }),
    prisma.deliverableType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, pdfLabel: true, pdfSublabel: true },
    }),
  ])

  return {
    talentos: talentos.map((t) => ({
      id: t.id,
      nombre: t.displayName,
      categoria: t.category,
      conTarifa: t._count.rates,
    })),
    formatos: formatos.map((f) => ({
      id: f.id,
      nombre: f.name,
      etiquetaPdf: f.pdfLabel,
      sublabel: f.pdfSublabel,
    })),
  }
}
