import { test as base, expect, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { hash } from '@node-rs/argon2'
import AxeBuilder from '@axe-core/playwright'

/**
 * Utilerías compartidas de las pruebas de extremo a extremo.
 *
 * Los datos los siembra directamente en Postgres: montar el estado desde la
 * interfaz haría que un fallo en el alta de usuarios rompiera veinte pruebas
 * que no tienen nada que ver con eso.
 */

export const prisma = new PrismaClient()

export const CUENTAS = {
  admin: {
    email: 'e2e-admin@katana.local',
    nombre: 'Chuy E2E',
    rol: 'ADMIN' as const,
    password: 'una frase larga para las pruebas',
  },
  comercial: {
    email: 'e2e-comercial@katana.local',
    nombre: 'Beto E2E',
    rol: 'COMERCIAL' as const,
    password: 'otra frase larga para las pruebas',
  },
  lectura: {
    email: 'e2e-lectura@katana.local',
    nombre: 'Ana E2E',
    rol: 'LECTURA' as const,
    password: 'una tercera frase de pruebas',
  },
}

export const CLIENTE_E2E = 'PRUEBAS E2E SA'
const PREFIJO_SLUG = 'e2e-'

async function hashear(clave: string) {
  return hash(clave, {
    memoryCost: 65536, timeCost: 3, parallelism: 1, algorithm: 2,
  })
}

export async function sembrar() {
  await limpiar()

  for (const c of Object.values(CUENTAS)) {
    await prisma.usuario.create({
      data: {
        email: c.email, nombre: c.nombre, rol: c.rol, estado: 'ACTIVO',
        esAprobador: c.rol === 'ADMIN',
        debeCambiarPassword: false,
        passwordHash: await hashear(c.password),
      },
    })
  }

  const [espejo, tiktok, reel, story] = await Promise.all([
    prisma.deliverableType.findUniqueOrThrow({ where: { code: 'TIKTOK_REEL_MIRROR' } }),
    prisma.deliverableType.findUniqueOrThrow({ where: { code: 'TIKTOK' } }),
    prisma.deliverableType.findUniqueOrThrow({ where: { code: 'REEL_IG' } }),
    prisma.deliverableType.findUniqueOrThrow({ where: { code: 'STORY_IG' } }),
  ])

  // Los talentos y precios del tabulador de HONOR real, incluidos los tres
  // "Pendiente" de Mariel: son el caso que el producto tiene que resolver.
  const definiciones = [
    {
      slug: `${PREFIJO_SLUG}ronny`, nombre: 'Ronny', canonico: 'Ronaldo BXM',
      tarifas: [
        [tiktok.id, 9_000_000], [reel.id, 13_000_000],
        [espejo.id, 19_500_000], [story.id, 4_000_000],
      ] as const,
      pendientes: [] as string[],
    },
    {
      slug: `${PREFIJO_SLUG}mariel`, nombre: 'Mariel Estrella', canonico: 'Mariel Estrella',
      tarifas: [[tiktok.id, 10_000_000]] as const,
      pendientes: [reel.id, espejo.id, story.id],
    },
    {
      slug: `${PREFIJO_SLUG}tony`, nombre: 'Tony Gastélum', canonico: 'Tony Gastélum',
      tarifas: [
        [tiktok.id, 3_000_000], [reel.id, 6_000_000],
        [espejo.id, 9_000_000], [story.id, 2_500_000],
      ] as const,
      pendientes: [] as string[],
    },
  ]

  for (const d of definiciones) {
    await prisma.talent.create({
      data: {
        canonicalName: d.canonico, displayName: d.nombre, slug: d.slug,
        rates: {
          create: [
            ...d.tarifas.map(([deliverableTypeId, amountCents]) => ({
              deliverableTypeId, amountCents, priceStatus: 'QUOTED' as const,
            })),
            ...d.pendientes.map((deliverableTypeId) => ({
              deliverableTypeId, priceStatus: 'PENDING' as const,
            })),
          ],
        },
      },
    })
  }

  return { espejo, tiktok, reel, story }
}

export async function limpiar() {
  const correos = Object.values(CUENTAS).map((c) => c.email)
  await prisma.$executeRaw`ALTER TABLE "Bitacora" DISABLE TRIGGER bitacora_inmutable`
  await prisma.bitacora.deleteMany({ where: { actorEmail: { in: correos } } })
  await prisma.$executeRaw`ALTER TABLE "Bitacora" ENABLE TRIGGER bitacora_inmutable`
  await prisma.$executeRaw`ALTER TABLE "TalentRateRevision" DISABLE TRIGGER rate_revision_inmutable`
  await prisma.talentRateRevision.deleteMany({
    where: { talent: { slug: { startsWith: PREFIJO_SLUG } } },
  })
  await prisma.$executeRaw`ALTER TABLE "TalentRateRevision" ENABLE TRIGGER rate_revision_inmutable`
  await prisma.quote.deleteMany({ where: { client: { displayName: CLIENTE_E2E } } })
  await prisma.client.deleteMany({ where: { displayName: CLIENTE_E2E } })
  await prisma.talent.deleteMany({ where: { slug: { startsWith: PREFIJO_SLUG } } })
  await prisma.sesion.deleteMany({ where: { usuario: { email: { in: correos } } } })
  await prisma.usuario.deleteMany({ where: { email: { in: correos } } })
}

/** Entra con una de las cuentas de prueba. */
export async function entrar(page: Page, cuenta: keyof typeof CUENTAS = 'admin') {
  const c = CUENTAS[cuenta]
  await page.goto('/acceso')
  await page.fill('#email', c.email)
  await page.fill('#password', c.password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL('/', { timeout: 30_000 })
}

/** Crea una cotización con los tres talentos sembrados y cuatro formatos. */
export async function crearCotizacion(page: Page): Promise<string> {
  await page.goto('/cotizaciones/nueva')
  await page.fill('#cliente', CLIENTE_E2E)
  await page.fill('#contacto', 'Fer Nicolini')
  for (const t of ['Ronny', 'Mariel Estrella', 'Tony Gastélum']) {
    await page.getByRole('checkbox', { name: new RegExp(`^${t}`) }).first().check()
  }
  for (const f of ['TikTok', 'Reel de Instagram', 'Story de Instagram']) {
    await page.getByRole('checkbox', { name: f, exact: true }).check()
  }
  await page.getByRole('checkbox', { name: /réplica en Reel/ }).check()
  await page.getByRole('button', { name: 'Crear y abrir el editor' }).click()
  await page.waitForURL(/\/cotizaciones\/[a-z0-9]{16,}$/, { timeout: 60_000 })
  return page.url()
}

/** Espera a que el editor termine de guardar. */
export async function esperarGuardado(page: Page) {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid=estado-guardado]')?.getAttribute('data-fase') ===
      'guardado',
    undefined,
    { timeout: 30_000 },
  )
}

/**
 * Cuánto se desborda la página en horizontal.
 *
 * Un solo píxel es tolerancia de redondeo; más que eso significa que en el
 * iPad hay que hacer scroll lateral para ver una columna, y eso en una junta
 * se nota.
 */
export async function desbordeHorizontal(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

/**
 * Objetivos táctiles por debajo de 44 px.
 *
 * Es la medida mínima de Apple y la razón por la que en un iPad se falla al
 * pulsar una celda. Se ignoran los elementos ocultos y los enlaces dentro de
 * un párrafo, que no son objetivos táctiles primarios.
 */
export async function objetivosPequenos(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const malos: string[] = []
    const candidatos = document.querySelectorAll<HTMLElement>(
      'button, a[href], input:not([type=hidden]), select, textarea, [role=button]',
    )
    for (const el of candidatos) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      const est = getComputedStyle(el)
      if (est.visibility === 'hidden' || est.display === 'none') continue
      // Enlaces en medio de un texto: se pulsan con el dedo, pero agrandarlos
      // rompería el párrafo. No son controles.
      if (el.tagName === 'A' && el.closest('p')) continue
      if (el.closest('.sr-only')) continue

      // Una casilla de 16 px dentro de una etiqueta de 44 SÍ se puede pulsar:
      // tocar la etiqueta la marca. Lo que hay que medir es el objetivo real,
      // no el cuadrito dibujado.
      const etiquetaPadre = el.closest('label')
      const caja =
        etiquetaPadre && etiquetaPadre.contains(el)
          ? etiquetaPadre.getBoundingClientRect()
          : r
      if (caja.height < 44 - 0.5) {
        const etiqueta =
          el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? ''
        malos.push(
          `${el.tagName.toLowerCase()} "${etiqueta}" ${caja.height.toFixed(0)}px`,
        )
      }
    }
    return malos
  })
}

/** Violaciones serias o críticas de accesibilidad en la página actual. */
export async function violacionesAxe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // El documento va dentro de un iframe con su propio CSS de impresión; se
    // audita la aplicación, no el papel.
    .exclude('iframe[title="Vista previa del documento"]')
    .analyze()
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
}

export const test = base
export { expect }
