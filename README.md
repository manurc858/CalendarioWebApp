# Agenda · Horas de trabajo

Web app (React + SQLite) para controlar horas de trabajo, to-dos, eventos/entregas y calendario laboral (Madrid 2026 precargado).

## Estructura
- `server/` — API Express + SQLite (`better-sqlite3`). La BBDD se guarda en `server/agenda.db`.
- `client/` — React + Vite.

## Primer uso

```powershell
# 1) Instalar dependencias (raíz, server y client)
npm run install:all

# 2) Cargar el calendario laboral Madrid 2026 en la BBDD
npm run seed

# 3) Arrancar API (4000) y cliente (5173) a la vez
npm run dev
```

Abre http://localhost:5173

> Si prefieres, puedes abrir dos terminales y usar `npm run dev:server` y `npm run dev:client`.

## Características

- **Calendario mensual** con el día actual resaltado; cada casilla muestra las horas totales, proyectos y eventos del día.
- **Modal del día**: añade entradas de horas `HH:MM–HH:MM` asignándolas a un **proyecto**, lista de **to-dos** y **eventos/entregas**.
- **Proyectos** con color propio (desplegable en la barra superior).
- **Calendario laboral lateral** (mini-vista del año) editable con un pincel por color según leyenda:
  - Festivos España (rojo), Festivos IDOM (azul), Festivos c. autónoma (verde), Festivos locales (cian) y **Vacaciones (amarillo)**.
  - Pulsando una casilla con el color activo se borra la marca.
- **Barra de vacaciones**: indica días usados y **restantes** sobre el total (editable en el input).
- Botón para **ocultar/mostrar** el panel lateral.

## API
- `GET/POST/PUT/DELETE /api/projects`
- `GET/POST/PUT/DELETE /api/work?from=&to=&date=`
- `GET/POST/PUT/DELETE /api/todos?date=`
- `GET/POST/PUT/DELETE /api/events?from=&to=&date=`
- `GET /api/labor?from=&to=` · `PUT/DELETE /api/labor/:date`
- `GET /api/settings` · `PUT /api/settings/:key`
- `GET /api/day/:date`

## Notas
- Semana iniciada en lunes (L-D).
- La BBDD SQLite se crea automáticamente al arrancar el servidor; el `seed` solo rellena el calendario laboral.

## Compartir el proyecto sin datos personales

- La base de datos local (`server/agenda.db` y archivos derivados) esta ignorada por Git.
- La configuracion local del servidor (`server/.env`, `server/.env.*`) tambien esta ignorada.
- Hay un archivo de ejemplo versionado: `server/.env.example`.

### Configuracion de Outlook (cada persona en su equipo)

1. Copia `server/.env.example` como `server/.env`.
2. En `server/.env`, define tu URL ICS:

```env
OUTLOOK_ICS_URL=https://.../calendar.ics
```

3. Si `OUTLOOK_ICS_URL` se deja vacia, la app funciona igualmente, pero sin cargar reuniones de Outlook.

## Supabase (multi-dispositivo)

El servidor soporta dos backends de datos:

- **SQLite local** (`server/agenda.db`) — por defecto, si `DATABASE_URL` no esta definida.
- **Supabase/Postgres** — si `DATABASE_URL` esta definida en `server/.env` (o en el hosting).

### Migrar los datos locales a Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com) y copia la *connection string*
   (Settings → Database → Connection string → URI, variante *Session pooler*).
2. En `server/.env`:

```env
DATABASE_URL=postgresql://postgres.xxxx:TU_PASSWORD@aws-0-xx.pooler.supabase.com:5432/postgres
```

3. Copia todos los datos de `agenda.db` a Supabase:

```powershell
npm run migrate:supabase --prefix server
```

4. Arranca normal (`npm run dev`). El log dira `[db] Backend: Postgres (Supabase)`.

> El script de migracion es idempotente: vacia las tablas destino y vuelve a copiar.
> `agenda.db` no se toca; si quitas `DATABASE_URL` vuelves al modo local.

## Despliegue en Vercel

El cliente (`client/dist`) se sirve como estático desde la CDN de Vercel y la
API Express de `server/` se ejecuta como función serverless (`api/index.js`);
`vercel.json` reescribe `/api/*` hacia ella. Los datos siguen en Supabase.

1. En [vercel.com](https://vercel.com): **Add New → Project** e importa este repo de GitHub.
   Vercel lee `vercel.json` (instalación, build, rewrites y cron ya configurados).
2. Variables de entorno (**Settings → Environment Variables**):
   - `DATABASE_URL` — en Supabase: **Connect → Transaction pooler** (puerto **6543**).
     En serverless hay que usar este pooler, no el *Session pooler* (5432), o se
     agotan las conexiones. **Nunca la subas al repo.**
   - `APP_PASSWORD` — contraseña de acceso a la app. Sin ella la API queda pública.
   - `OUTLOOK_ICS_URL` (opcional) — calendario de Outlook.
   - `CRON_SECRET` (recomendada) — protege el cron diario de reuniones
     (`api/cron/cache-meetings.js`); Vercel la envía sola en la cabecera `Authorization`.
3. Despliega. API y cliente comparten dominio (`https://tu-app.vercel.app`), así
   que `VITE_API_URL` debe quedar vacía.

> La copia diaria de reuniones de Outlook la hace un **Vercel Cron Job**; de paso
> mantiene activo el proyecto gratuito de Supabase, que se pausa tras una semana sin uso.

### Otros hosts (Render, VPS)

Sigue funcionando como un único servicio Node: build
`npm run install:all && npm run build --prefix client`, arranque
`npm start --prefix server`, y las mismas variables de entorno (aquí
`DATABASE_URL` puede ser el *Session pooler*).

### Probar en local con contraseña

La configuración `prueba-local` de `.claude/launch.json` arranca el servidor con
SQLite local y una contraseña de prueba, sin tocar Supabase.

### Comprobacion rapida antes de hacer push

```powershell
git status --ignored
git ls-files | findstr /I "agenda.db .env"
```
