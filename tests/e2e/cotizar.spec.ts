import {
  test, expect, sembrar, limpiar, entrar, crearCotizacion, esperarGuardado, prisma,
} from './apoyo'

/**
 * El recorrido que hace Chuy de verdad: armar el tabulador, ajustar un precio
 * para la marca, ver el documento cambiar y bajar el PDF.
 */

test.beforeAll(async () => {
  await sembrar()
})

test.afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

test('de cero a PDF', async ({ page }) => {
  await entrar(page)
  await crearCotizacion(page)

  // ── El documento sale con los precios del tarifario ──────────────────────
  const marco = page.locator('iframe[title="Vista previa del documento"]')
  await expect(async () => {
    const t = await marco.evaluate(
      (f: HTMLIFrameElement) => f.contentDocument?.body?.innerText ?? '',
    )
    expect(t).toContain('$195,000')
  }).toPass({ timeout: 30_000 })

  const inicial = await marco.evaluate(
    (f: HTMLIFrameElement) => f.contentDocument?.body?.innerText ?? '',
  )
  expect(inicial, 'el cliente').toContain('PRUEBAS E2E SA')
  expect(inicial, 'los talentos').toContain('Ronny')
  // Mariel tiene tres formatos en "Pendiente": el documento lo dice, no
  // imprime cero.
  expect(inicial, 'lo pendiente').toContain('Cotizar')
  expect(inicial).not.toContain('$0')

  // ── Ajustar Ronny × espejo a $150,000 ────────────────────────────────────
  const campo = page.getByLabel(/^Precio de Ronny, TIKTOK \+ REEL/)
  await campo.fill('150000')
  await campo.press('Enter')

  await expect(async () => {
    const t = await marco.evaluate(
      (f: HTMLIFrameElement) => f.contentDocument?.body?.innerText ?? '',
    )
    expect(t).toContain('$150,000')
    expect(t).not.toContain('$195,000')
  }).toPass({ timeout: 15_000 })

  // La celda explica de dónde salió: es lo que se responde en la junta.
  const celda = page.locator('td', {
    has: page.getByLabel(/^Precio de Ronny, TIKTOK \+ REEL/),
  })
  await expect(celda.locator('p').first()).toHaveText(
    /● Base \$195,000 · −\$45,000 \(−23\.1%\)/,
  )

  await esperarGuardado(page)

  // ── Poner cifra sobre un "Pendiente" ─────────────────────────────────────
  const marielReel = page.getByLabel(/^Precio de Mariel Estrella, REEL \(IG\)/)
  await marielReel.fill('120000')
  await marielReel.press('Enter')
  await esperarGuardado(page)

  const celdaMariel = page.locator('td', {
    has: page.getByLabel(/^Precio de Mariel Estrella, REEL \(IG\)/),
  })
  // Sin tarifa base no hay porcentaje que calcular: no se inventa uno.
  await expect(celdaMariel.locator('p').first()).toHaveText(
    /Sin tarifa base \(Por validar\)/,
  )

  // ── Persiste ─────────────────────────────────────────────────────────────
  await page.reload()
  await page.waitForSelector('table')
  await expect(page.getByLabel(/^Precio de Ronny, TIKTOK \+ REEL/)).toHaveValue('150,000')

  // Y el tarifario maestro NO se tocó: bajarle el precio a esta marca no se lo
  // baja a todas.
  const tarifa = await prisma.talentRate.findFirstOrThrow({
    where: {
      talent: { slug: 'e2e-ronny' },
      deliverableType: { code: 'TIKTOK_REEL_MIRROR' },
    },
  })
  expect(tarifa.amountCents).toBe(19_500_000)

  // ── El PDF ───────────────────────────────────────────────────────────────
  const [descarga] = await Promise.all([
    page.waitForEvent('download', { timeout: 90_000 }),
    page.getByTestId('boton-pdf').click(),
  ])
  expect(descarga.suggestedFilename()).toMatch(
    /^Tabulador_PRUEBAS_E2E_SA_\d{4}-\d{2}-\d{2}\.pdf$/,
  )
  const ruta = await descarga.path()
  expect(ruta).toBeTruthy()
})

test('el PDF no se puede bajar con un cambio sin guardar', async ({ page }) => {
  await entrar(page)
  await crearCotizacion(page)

  const campo = page.getByLabel(/^Precio de Ronny, TIKTOK$/).first()
  await campo.fill('88000')
  await campo.press('Enter')

  // El PDF lo dibuja el servidor con lo guardado: con un cambio en vuelo
  // saldría con la cifra anterior, y ese archivo es el que ve la marca.
  await expect(page.getByTestId('boton-pdf')).toBeDisabled()
  await esperarGuardado(page)
  await expect(page.getByTestId('boton-pdf')).toBeEnabled()
})

test('dos pestañas no se pisan', async ({ page, context }) => {
  await entrar(page)
  const url = await crearCotizacion(page)

  const segunda = await context.newPage()
  await segunda.goto(url)
  await segunda.waitForSelector('table')

  // La primera guarda.
  const a = page.getByLabel(/^Precio de Tony Gastélum, TIKTOK$/).first()
  await a.fill('35000')
  await a.press('Enter')
  await esperarGuardado(page)

  // La segunda todavía cree tener la revisión vieja.
  const b = segunda.getByLabel(/^Precio de Tony Gastélum, TIKTOK$/).first()
  await b.fill('20000')
  await b.press('Enter')

  const banner = segunda.getByTestId('banner-conflicto')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('Chuy E2E')
  // Lo tecleado NO se revierte: se puede copiar antes de recargar.
  await expect(b).toHaveValue('20,000')

  // Y el cambio de la primera sigue en pie. Se consulta POR ESTA cotización:
  // otras pruebas crean cotizaciones para el mismo cliente, y buscar por
  // nombre de cliente devolvía la de otra prueba según el orden de ejecución.
  const quoteId = new URL(url).pathname.split('/').pop()!
  const tarifa = await prisma.quotePrice.findFirstOrThrow({
    where: {
      quoteId,
      quoteTalent: { talent: { slug: 'e2e-tony' } },
      deliverableType: { code: 'TIKTOK' },
    },
  })
  expect(tarifa.overrideAmountCents).toBe(3_500_000)
  await segunda.close()
})

test('un rol de solo lectura consulta pero no edita', async ({ page, context }) => {
  // Primero un admin arma la cotización.
  await entrar(page)
  const url = await crearCotizacion(page)
  await context.clearCookies()

  await entrar(page, 'lectura')
  await page.goto(url)
  await page.waitForSelector('table')

  await expect(page.getByTestId('aviso-solo-lectura')).toBeVisible()
  await expect(page.getByLabel(/^Precio de Ronny, TIKTOK$/).first()).toBeDisabled()

  // Pero sí puede bajar el PDF: para eso está el rol.
  await expect(page.getByTestId('boton-pdf')).toBeEnabled()

  // Y la navegación no le ofrece lo que no puede hacer.
  const nav = page.getByRole('navigation', { name: 'Principal' })
  await expect(nav.getByRole('link', { name: 'Tarifario' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Importar' })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: 'Usuarios' })).toHaveCount(0)
})
