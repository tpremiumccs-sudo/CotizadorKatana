import { PrismaClient } from '@prisma/client'
import { hash } from '@node-rs/argon2'
import { FORMATOS } from '../src/server/import/catalogo'
import { validarPassword } from '../src/lib/politica-password'

/**
 * Semilla de la base.
 *
 * IDEMPOTENTE: correrla tres veces deja el mismo estado y NO rota la contraseña
 * del administrador. Se ejecuta en cada arranque del contenedor, así que no
 * puede tener efectos acumulativos.
 */

const prisma = new PrismaClient()

// Parámetros de argon2id. m=64 MiB es el mínimo recomendado por OWASP para
// argon2id con t=3; con menos memoria el hash se vuelve barato de atacar en GPU.
export const ARGON2 = { memoryCost: 65536, timeCost: 3, parallelism: 1, algorithm: 2 as const }

/**
 * Consideraciones por omisión, tomadas literalmente del tabulador de HONOR.
 * Son 9, no 8: la novena ("Sujetas a confirmación…") estaba en el documento.
 */
const CONSIDERACIONES = [
  'Tarifas expresadas en pesos mexicanos (MXN).',
  'No incluyen IVA.',
  'No incluyen producción.',
  'No incluyen viáticos.',
  'No incluyen derechos de uso de imagen.',
  'No incluyen pauta digital (whitelisting).',
  'No incluyen exclusividad.',
  'Sujetas a disponibilidad del talento.',
  'Sujetas a confirmación y aprobación final por Katana Talent.',
]

/** Términos y condiciones, también literales del documento original. */
const TERMINOS = [
  'Vigencia de este tabulador: 15 días naturales a partir de la fecha de envío.',
  'Los precios podrán actualizarse sin previo aviso una vez concluida la vigencia.',
  'La confirmación de talento, fechas y entregables está sujeta a disponibilidad al momento de la solicitud.',
  'Toda campaña incluye hasta dos (2) rondas de cambios sobre el alcance aprobado; cada ronda adicional tendrá un costo equivalente al 10% del valor del entregable afectado.',
  'Producción, viáticos, hospedaje, traslados, derechos adicionales, pauta y exclusividad se cotizan por separado, salvo que se indiquen expresamente como incluidos.',
  'El pago y forma de facturación se definen en la orden de compra o contrato correspondiente a cada proyecto.',
  'Esta cotización es de carácter informativo y no representa una confirmación de talento hasta contar con aprobación comercial de Katana Talent.',
]

const CONFIDENCIALIDAD =
  'La información de este documento —tarifas, contactos y condiciones comerciales— es ' +
  'confidencial entre Katana Talent y {CLIENTE}, y no podrá compartirse con terceros sin ' +
  'autorización previa.'

const FIRMA =
  'Katana Talent · Representación · Influencer Marketing · Sports & Entertainment · ' +
  'chuygallardo@katanatalent.com'

async function sembrarFormatos(): Promise<number> {
  let n = 0
  for (const f of FORMATOS) {
    await prisma.deliverableType.upsert({
      where: { code: f.code },
      update: {
        name: f.name,
        pdfLabel: f.pdfLabel,
        pdfSublabel: f.pdfSublabel ?? null,
        excelHeader: f.excelHeader,
        category: f.category,
        unit: f.unit,
        unitLabel: f.unitLabel,
        allowsQuantity: f.allowsQuantity,
        sortOrder: f.sortOrder,
        isActive: true,
      },
      create: {
        code: f.code,
        name: f.name,
        pdfLabel: f.pdfLabel,
        pdfSublabel: f.pdfSublabel ?? null,
        excelHeader: f.excelHeader,
        category: f.category,
        unit: f.unit,
        unitLabel: f.unitLabel,
        allowsQuantity: f.allowsQuantity,
        sortOrder: f.sortOrder,
      },
    })
    n++
  }
  return n
}

async function sembrarAjustes(): Promise<void> {
  const ajustes: Array<[string, unknown]> = [
    ['iva.bps', 1600],
    ['moneda.default', 'MXN'],
    ['vigencia.default', '15 días naturales'],
    ['consideraciones.default', CONSIDERACIONES],
    ['terminos.default', TERMINOS],
    ['confidencialidad.texto', CONFIDENCIALIDAD],
    ['firma.texto', FIRMA],
    ['pie.texto', 'Katana Talent  ·  Información confidencial'],
    ['marca.eyebrow', 'KATANA TALENT'],
    // El PDF original imprime los importes en azul marino. Se replica tal cual;
    // este interruptor permite pasarlos al morado de marca si se decide.
    ['marca.preciosEnMorado', false],
    ['aprobacion.modo', 'umbral'],
    ['aprobacion.umbralBps', 2000],
  ]
  for (const [key, value] of ajustes) {
    await prisma.appSetting.upsert({
      where: { key },
      update: {}, // NO se pisa lo que el usuario haya cambiado en la app.
      create: { key, value: value as never },
    })
  }
}

async function sembrarAdmin(): Promise<string | null> {
  const email = process.env.SEED_ADMIN_EMAIL
  const nombre = process.env.SEED_ADMIN_NOMBRE ?? 'Administrador'
  const password = process.env.SEED_ADMIN_PASSWORD

  if (!email || !password) {
    console.log('[seed] Sin SEED_ADMIN_EMAIL/PASSWORD: no se crea administrador.')
    return null
  }

  const existente = await prisma.usuario.findUnique({ where: { email } })
  if (existente) {
    // Clave: NO se rota la contraseña. El seed corre en cada arranque y volver
    // a poner la del .env desharía cualquier cambio que el usuario hiciera.
    console.log(`[seed] El administrador ${email} ya existe; no se toca.`)
    return existente.id
  }

  // La misma política que se le exigirá al cambiarla. Sin esto, la única cuenta
  // ADMIN del sistema recién instalado nacía con una credencial que el propio
  // validador rechaza — y la persona lo descubría a base de intentos en la
  // pantalla de cambio obligatorio.
  const politica = validarPassword(password, { email, nombre })
  if (!politica.ok) {
    throw new Error(
      `SEED_ADMIN_PASSWORD no cumple la política: ${politica.motivo}\n` +
        'Corrígela en el .env antes de instalar: es la contraseña con la que se ' +
        'entra por primera vez.',
    )
  }

  const usuario = await prisma.usuario.create({
    data: {
      email,
      nombre,
      rol: 'ADMIN',
      estado: 'ACTIVO',
      esAprobador: true,
      passwordHash: await hash(password, ARGON2),
      passwordCambiadoEn: new Date(),
      // Se obliga a cambiarla: la contraseña inicial viajó en un archivo .env.
      debeCambiarPassword: true,
    },
  })
  console.log(`[seed] Administrador creado: ${email} (debe cambiar su contraseña).`)
  return usuario.id
}

async function main() {
  console.log('[seed] Sembrando datos base…')

  const formatos = await sembrarFormatos()
  console.log(`[seed] ${formatos} formatos cotizables.`)

  await sembrarAjustes()
  console.log('[seed] Ajustes y plantillas del documento.')

  await sembrarAdmin()

  const totales = {
    formatos: await prisma.deliverableType.count(),
    ajustes: await prisma.appSetting.count(),
    usuarios: await prisma.usuario.count(),
    talentos: await prisma.talent.count(),
  }
  console.log('[seed] Listo:', totales)
}

main()
  .catch((e) => {
    console.error('[seed] Falló:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
