# Cotizador Katana Talent

Cotizador de talento para **Katana Talent**: arma tabuladores de tarifas y
cotizaciones para marcas, con una **vista previa idéntica al PDF** que se envía.
Lo que se cambia en el editor cambia en el preview y en el PDF descargable.

## Qué hace

- **Importa** los Excel del CRM (`KATANA ENGINE — CRM COMERCIAL 2026` y
  `CRM_Roster_Katana_Actualizado`) a una base de datos, con vista previa de
  cambios antes de aplicar.
- **Genera dos documentos**: el *Tabulador de Tarifas* (matriz talento × formato)
  y la *Cotización* con entregables, descuento, IVA y total.
- **Permite ajustar precios por cotización** sin tocar el tarifario maestro,
  marcando visualmente qué está ajustado y cuánto se movió respecto a la base.
- **Funciona en iPad, celular y escritorio**, porque las cotizaciones se enseñan
  en junta y se mandan por WhatsApp.

## Requisitos

- Docker y el plugin `docker compose` v2
- Un túnel de Cloudflare (para publicarlo sin abrir puertos)

## Instalación

```bash
cp .env.example .env
$EDITOR .env          # cambia TODOS los valores marcados CAMBIAR
./deploy.sh instalar
```

La guía completa está en [`docs/GUIA_DESPLIEGUE.md`](docs/GUIA_DESPLIEGUE.md) y
el manual de uso en [`docs/MANUAL_USUARIO.md`](docs/MANUAL_USUARIO.md).

## Operación

```bash
./deploy.sh estado         # qué está corriendo
./deploy.sh logs app       # registros en vivo
./deploy.sh respaldar      # respaldo inmediato y verificado
./deploy.sh actualizar     # traer nueva versión
```

## Desarrollo

```bash
npm install
docker compose -f docker-compose.dev.yml up -d   # solo Postgres
npx prisma migrate deploy && npm run db:seed
npm run dev
```

| Comando | Qué hace |
|---|---|
| `npm run test:unit` | Motor de dinero, parsers, política de permisos |
| `npm run test:integracion` | Importación contra los `.xlsx` reales |
| `npm run test:pdf` | **Fidelidad del PDF contra el original de HONOR** |
| `npm run test:e2e` | Flujo completo en 3 tamaños de pantalla |

El diseño técnico detallado está en [`docs/DISENO_TECNICO.md`](docs/DISENO_TECNICO.md).
