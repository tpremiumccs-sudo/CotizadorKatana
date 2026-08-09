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
      // Sólo el roster de casa. Sin este filtro entran los aliados de KIF —30
      // nombres que la agencia no cotiza desde aquí— porque el importador los
      // da de alta correctamente marcados y la consulta no miraba el campo.
      // El índice [roster, isActive] existe justo para esto.
      where: { isActive: true, roster: 'KATANA' },
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

export interface CardRoster {
  id: string
  nombre: string
  categoria: string | null
  fotoUrl: string | null
  /** Formatos con precio de verdad: distingue a quien está listo para cotizar. */
  conTarifa: number
}

/**
 * El roster que se enseña como cards en la hoja de cotización.
 *
 * Deliberadamente escueto —foto, nombre y categoría—: elegir a quién cotizar no
 * requiere la biografía ni las métricas, y cargarlas aquí volvería lento el
 * gesto más frecuente de la aplicación. Eso vive en la ficha del talento.
 */
export async function rosterParaHoja(): Promise<CardRoster[]> {
  await autorizar('cotizacion.crear')

  const talentos = await prisma.talent.findMany({
    where: { isActive: true, roster: 'KATANA' },
    orderBy: { displayName: 'asc' },
    select: {
      id: true, displayName: true, category: true, photoUrl: true,
      _count: { select: { rates: { where: { priceStatus: 'QUOTED' } } } },
    },
  })

  return talentos.map((t) => ({
    id: t.id,
    nombre: t.displayName,
    categoria: t.category,
    fotoUrl: t.photoUrl,
    conTarifa: t._count.rates,
  }))
}
