import { describe, it, expect } from 'vitest'
import {
  can, assertCan, ForbiddenError, etiquetaRol,
  type Actor, type Accion, type Rol,
} from '@/lib/authz/policy'
import {
  validarPassword, necesitaRehash, PARAMETROS_ARGON2,
} from '@/server/auth/password'

const actor = (rol: Rol, over: Partial<Actor> = {}): Actor => ({
  id: 'u1', nombre: 'Prueba', email: 'p@katana.mx',
  rol, estado: 'ACTIVO', esAprobador: false, ...over,
})

const ADMIN = actor('ADMIN')
const COMERCIAL = actor('COMERCIAL')
const LECTURA = actor('LECTURA')

const TODAS_LAS_ACCIONES: Accion[] = [
  'cotizacion.ver', 'cotizacion.crear', 'cotizacion.editar', 'cotizacion.eliminar',
  'cotizacion.emitir', 'cotizacion.aprobar', 'cotizacion.descargarPdf',
  'talento.ver', 'talento.editar', 'tarifario.ver', 'tarifario.editar',
  'importacion.subir', 'importacion.aplicar',
  'usuario.ver', 'usuario.administrar', 'bitacora.ver', 'ajustes.editar',
]

describe('matriz de permisos', () => {
  // Tabla explícita: si alguien cambia la política, esta tabla lo obliga a
  // decirlo aquí. Es el documento de referencia de quién puede hacer qué.
  const ESPERADO: Record<Accion, Record<Rol, boolean>> = {
    'cotizacion.ver':          { ADMIN: true,  COMERCIAL: true,  LECTURA: true  },
    'cotizacion.descargarPdf': { ADMIN: true,  COMERCIAL: true,  LECTURA: true  },
    'talento.ver':             { ADMIN: true,  COMERCIAL: true,  LECTURA: true  },
    'tarifario.ver':           { ADMIN: true,  COMERCIAL: true,  LECTURA: true  },
    'cotizacion.crear':        { ADMIN: true,  COMERCIAL: true,  LECTURA: false },
    'cotizacion.editar':       { ADMIN: true,  COMERCIAL: true,  LECTURA: false },
    'cotizacion.emitir':       { ADMIN: true,  COMERCIAL: true,  LECTURA: false },
    'talento.editar':          { ADMIN: true,  COMERCIAL: true,  LECTURA: false },
    'tarifario.editar':        { ADMIN: true,  COMERCIAL: true,  LECTURA: false },
    'importacion.subir':       { ADMIN: true,  COMERCIAL: true,  LECTURA: false },
    'bitacora.ver':            { ADMIN: true,  COMERCIAL: true,  LECTURA: false },
    'cotizacion.eliminar':     { ADMIN: true,  COMERCIAL: false, LECTURA: false },
    'cotizacion.aprobar':      { ADMIN: true,  COMERCIAL: false, LECTURA: false },
    'importacion.aplicar':     { ADMIN: true,  COMERCIAL: false, LECTURA: false },
    'usuario.ver':             { ADMIN: true,  COMERCIAL: false, LECTURA: false },
    'usuario.administrar':     { ADMIN: true,  COMERCIAL: false, LECTURA: false },
    'ajustes.editar':          { ADMIN: true,  COMERCIAL: false, LECTURA: false },
  }

  it('cubre todas las acciones declaradas', () => {
    expect(Object.keys(ESPERADO).sort()).toEqual([...TODAS_LAS_ACCIONES].sort())
  })

  for (const accion of TODAS_LAS_ACCIONES) {
    for (const rol of ['ADMIN', 'COMERCIAL', 'LECTURA'] as Rol[]) {
      it(`${rol} · ${accion} → ${ESPERADO[accion][rol] ? 'permitido' : 'denegado'}`, () => {
        expect(can(actor(rol), accion).permitido).toBe(ESPERADO[accion][rol])
      })
    }
  }
})

describe('recurso propio contra ajeno', () => {
  it('un comercial edita lo suyo pero no lo de otro', () => {
    expect(can(COMERCIAL, 'cotizacion.editar', { creadoPorId: 'u1' }).permitido).toBe(true)
    const ajena = can(COMERCIAL, 'cotizacion.editar', { creadoPorId: 'otro' })
    expect(ajena.permitido).toBe(false)
    expect(ajena.motivo).toContain('que tú creaste')
  })

  it('un administrador edita cualquiera', () => {
    expect(can(ADMIN, 'cotizacion.editar', { creadoPorId: 'otro' }).permitido).toBe(true)
  })
})

describe('estados cerrados', () => {
  it('una cotización enviada ya no se edita, ni por un administrador', () => {
    for (const estado of ['SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED']) {
      const d = can(ADMIN, 'cotizacion.editar', { estado })
      expect(d.permitido, estado).toBe(false)
      expect(d.motivo).toContain('Duplícala')
    }
  })

  it('un borrador sí se edita', () => {
    expect(can(COMERCIAL, 'cotizacion.editar', { estado: 'DRAFT' }).permitido).toBe(true)
  })

  it('una cotización enviada no se elimina; se cancela', () => {
    const d = can(ADMIN, 'cotizacion.eliminar', { estado: 'SENT' })
    expect(d.permitido).toBe(false)
    expect(d.motivo).toContain('se cancela')
  })
})

describe('aprobación', () => {
  it('un comercial marcado como aprobador puede aprobar sin ser administrador', () => {
    // Es el caso de Ramiro en el CRM real: aprueba, pero no administra.
    const ramiro = actor('COMERCIAL', { esAprobador: true })
    expect(can(ramiro, 'cotizacion.aprobar').permitido).toBe(true)
    expect(can(ramiro, 'usuario.administrar').permitido).toBe(false)
  })

  it('una cotización que requiere aprobación no la emite quien no aprueba', () => {
    const d = can(COMERCIAL, 'cotizacion.emitir', { requiereAprobacion: true })
    expect(d.permitido).toBe(false)
    expect(d.motivo).toContain('aprobación')
  })

  it('quien sí aprueba puede emitirla', () => {
    const ramiro = actor('COMERCIAL', { esAprobador: true })
    expect(can(ramiro, 'cotizacion.emitir', { requiereAprobacion: true }).permitido).toBe(true)
    expect(can(ADMIN, 'cotizacion.emitir', { requiereAprobacion: true }).permitido).toBe(true)
  })
})

describe('estado de la cuenta', () => {
  it('sin sesión no se puede nada', () => {
    for (const accion of TODAS_LAS_ACCIONES) {
      const d = can(null, accion)
      expect(d.permitido, accion).toBe(false)
      expect(d.motivo).toContain('iniciar sesión')
    }
  })

  it('una cuenta suspendida no puede ni leer', () => {
    const suspendido = actor('ADMIN', { estado: 'SUSPENDIDO' })
    for (const accion of TODAS_LAS_ACCIONES) {
      expect(can(suspendido, accion).permitido, accion).toBe(false)
    }
    expect(can(suspendido, 'cotizacion.ver').motivo).toContain('suspendida')
  })

  it('una cuenta desactivada tampoco', () => {
    const baja = actor('ADMIN', { estado: 'DESACTIVADO' })
    expect(can(baja, 'cotizacion.ver').permitido).toBe(false)
  })
})

describe('assertCan', () => {
  it('lanza con el motivo, para poder registrarlo en la bitácora', () => {
    expect(() => assertCan(LECTURA, 'cotizacion.crear')).toThrow(ForbiddenError)
    try {
      assertCan(LECTURA, 'cotizacion.crear')
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError)
      expect((e as ForbiddenError).accion).toBe('cotizacion.crear')
      expect((e as ForbiddenError).message).toContain('solo lectura')
    }
  })

  it('no lanza cuando está permitido', () => {
    expect(() => assertCan(ADMIN, 'usuario.administrar')).not.toThrow()
  })
})

describe('etiquetas en español', () => {
  it('nombra los roles como los ve el usuario', () => {
    expect(etiquetaRol('ADMIN')).toBe('Administrador')
    expect(etiquetaRol('COMERCIAL')).toBe('Comercial')
    expect(etiquetaRol('LECTURA')).toBe('Solo lectura')
  })
})

describe('contraseñas', () => {
  it('exige al menos 12 caracteres', () => {
    expect(validarPassword('corta').ok).toBe(false)
    expect(validarPassword('unafrasesuficientementelarga').ok).toBe(true)
  })

  it('rechaza las que contienen el nombre del sistema o del usuario', () => {
    expect(validarPassword('katanatalent2026').ok).toBe(false)
    expect(validarPassword('cotizador123456').ok).toBe(false)
    const r = validarPassword('chuygallardo2026x', {
      email: 'chuygallardo@katanatalent.com', nombre: 'Chuy Gallardo',
    })
    expect(r.ok).toBe(false)
  })

  it('el motivo explica qué hacer', () => {
    const r = validarPassword('katana123456789')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('frase que solo tú conozcas')
  })

  it('detecta hashes con parámetros por debajo del mínimo', () => {
    const debil = '$argon2id$v=19$m=4096,t=2,p=1$c2FsdA$aGFzaA'
    const bueno = `$argon2id$v=19$m=${PARAMETROS_ARGON2.memoryCost},t=${PARAMETROS_ARGON2.timeCost},p=1$c2FsdA$aGFzaA`
    expect(necesitaRehash(debil)).toBe(true)
    expect(necesitaRehash(bueno)).toBe(false)
    // Un hash de otro algoritmo hay que migrarlo.
    expect(necesitaRehash('$2b$12$abcdefghijklmnopqrstuv')).toBe(true)
  })
})
