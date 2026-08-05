import 'server-only'
import { prisma } from '@/lib/db'
import { autorizar } from '@/server/data/autorizar'

/**
 * Fichas de talento.
 *
 * La ficha existe para responder lo que se pregunta antes de cotizar: qué
 * formatos tiene tarifados, cuántos seguidores trae el roster y de dónde salió
 * cada dato.
 */

export async function listarTalentos() {
  await autorizar('talento.ver')

  const talentos = await prisma.talent.findMany({
    where: { isActive: true },
    orderBy: { displayName: 'asc' },
    select: {
      id: true, slug: true, displayName: true, canonicalName: true, code: true,
      category: true, roster: true, esMenorDeEdad: true,
      missingInLastImport: true, rateStatus: true,
      rates: { select: { priceStatus: true, amountCents: true } },
      metrics: {
        // La tabla es de sólo añadir y el roster se actualiza cada dos semanas:
        // interesa la captura más reciente de cada plataforma.
        orderBy: { capturedAt: 'desc' },
        select: { platform: true, followers: true, needsReview: true },
      },
    },
  })

  return talentos.map((t) => {
    const conPrecio = t.rates.filter((r) => r.priceStatus === 'QUOTED')
    // Se queda la métrica más reciente por plataforma: la tabla es de sólo
    // añadir y el roster se actualiza cada dos semanas.
    const porPlataforma = new Map<string, number | null>()
    for (const m of t.metrics) {
      if (!porPlataforma.has(m.platform)) porPlataforma.set(m.platform, m.followers)
    }
    const alcance = [...porPlataforma.values()].reduce<number>(
      (suma, v) => suma + (v ?? 0),
      0,
    )

    return {
      id: t.id,
      slug: t.slug,
      nombre: t.displayName,
      nombreCanonico: t.canonicalName,
      codigo: t.code,
      categoria: t.category,
      roster: t.roster,
      esMenorDeEdad: t.esMenorDeEdad,
      ausente: t.missingInLastImport,
      estadoTarifas: t.rateStatus,
      formatosConPrecio: conPrecio.length,
      formatosTarifados: t.rates.length,
      // Sumar seguidores de plataformas distintas cuenta a la misma persona
      // varias veces; se llama "alcance" y no "seguidores" a propósito.
      alcance,
      plataformas: [...porPlataforma.entries()].map(([plataforma, seguidores]) => ({
        plataforma,
        seguidores,
      })),
    }
  })
}

export async function leerTalento(slug: string) {
  await autorizar('talento.ver')

  const t = await prisma.talent.findUnique({
    where: { slug },
    include: {
      identifiers: { orderBy: { creadoEn: 'asc' } },
      metrics: { orderBy: { capturedAt: 'desc' } },
      rates: {
        include: { deliverableType: { select: { name: true, sortOrder: true } } },
        orderBy: { deliverableType: { sortOrder: 'asc' } },
      },
    },
  })
  if (!t) return null

  const vistas = new Set<string>()
  const metricas = t.metrics.filter((m) => {
    if (vistas.has(m.platform)) return false
    vistas.add(m.platform)
    return true
  })

  return {
    id: t.id,
    slug: t.slug,
    nombre: t.displayName,
    nombreCanonico: t.canonicalName,
    codigo: t.code,
    categoria: t.category,
    roster: t.roster,
    pais: t.country,
    ciudad: t.city,
    verticales: t.verticals,
    relacion: t.relationshipType,
    notaPlataforma: t.primaryPlatformNote,
    estadoTarifas: t.rateStatus,
    notasTarifa: t.rateNotes,
    notasComerciales: t.commercialNotes,
    usuario: t.username,
    enlaces: [
      { plataforma: 'Instagram', url: t.linkInstagram },
      { plataforma: 'TikTok', url: t.linkTiktok },
      { plataforma: 'YouTube', url: t.linkYoutube },
    ].filter((e): e is { plataforma: string; url: string } => Boolean(e.url)),
    bio: t.bio,
    logros: t.achievements,
    campanas: t.campaigns,
    esMenorDeEdad: t.esMenorDeEdad,
    ausente: t.missingInLastImport,
    identificadores: t.identifiers.map((i) => ({
      raw: i.raw,
      normalizado: i.normalized,
      canonico: i.isCanonical,
      origen: i.source,
    })),
    metricas: metricas.map((m) => ({
      plataforma: m.platform,
      seguidores: m.followers,
      crudo: m.rawValue,
      estado: m.parseStatus,
      requiereRevision: m.needsReview,
      notas: m.notes,
    })),
    tarifas: t.rates.map((r) => ({
      formato: r.deliverableType.name,
      amountCents: r.amountCents,
      priceStatus: r.priceStatus,
      editadaAMano: r.manuallyEditedAt !== null,
      nota: r.note,
    })),
  }
}
