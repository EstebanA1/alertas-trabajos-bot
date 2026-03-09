# Alertas Trabajos Bot 🤖

Bot de Telegram que busca ofertas de empleo en múltiples portales chilenos cada 5 minutos y envía alertas automáticas al chat. Se ejecuta sin servidor mediante **GitHub Actions** y persiste el estado usando **Upstash Redis**.

## Arquitectura

```
GitHub Actions (cron cada 5 min)
        │
        ▼
  test_scraper.js          ← Punto de entrada principal
        │
        ├── scrapers/
        │   ├── computrabajo.js   ← ScraperAPI (proxy residencial)
        │   ├── laborum.js        ← API interna (sin proxy)
        │   ├── getonboard.js     ← API REST pública oficial
        │   └── telegram_channel.js ← Canal DCCEmpleoSinFiltro
        │
        ├── utils/html.js         ← htmlToText compartido entre scrapers
        ├── db/database.js        ← Dual: Redis (nube) o JSON (local)
        └── notifier/telegram.js  ← Envío de alertas al chat
```

## Flujo de ejecución

1. Se obtienen todos los IDs ya vistos desde Redis.
2. Cada scraper recupera las ofertas publicadas en las últimas 24h.
3. Las ofertas pasan por filtros de **blacklist** (se descarta) y **whitelist** (debe coincidir con alguna tecnología de interés).
4. Las ofertas nuevas que superan los filtros se marcan en Redis y se envían como mensaje Telegram.

> El canal de Telegram (`DCCEmpleoSinFiltro`) **no aplica whitelist** — se reenvía todo el contenido del canal.

## Portales soportados

| Portal | Método | Proxy requerido |
|---|---|---|
| Computrabajo Chile | HTML scraping con Cheerio | ✅ ScraperAPI |
| Laborum Chile | API interna REST | ❌ |
| GetOnBoard | API REST pública | ❌ |
| DCCEmpleoSinFiltro | Web Telegram (`t.me/s/`) | ❌ |

## Configuración

### Variables de entorno

Copia `.env.example` a `.env` para desarrollo local:

| Variable | Descripción |
|---|---|
| `TELEGRAM_TOKEN` | Token del bot (obtenido via [@BotFather](https://t.me/BotFather)) |
| `TELEGRAM_CHAT_ID` | ID del chat/grupo donde se envían las alertas |
| `UPSTASH_REDIS_REST_URL` | URL REST de tu instancia Upstash Redis |
| `UPSTASH_REDIS_REST_TOKEN` | Token de autenticación Upstash |
| `SCRAPERAPI_KEY` | API key de [ScraperAPI](https://www.scraperapi.com/) (necesaria para Computrabajo) |

> En **desarrollo local** sin Redis configurado, el bot usa un archivo `db/jobs.json` como base de datos.

### Personalización de búsquedas (`config.js`)

```js
CT_QUERY: 'desarrollador,programador,fullstack'   // Términos de búsqueda
WHITELIST_KEYWORDS: 'javascript,react,python,...' // La oferta DEBE incluir al menos uno
BLACKLIST_KEYWORDS: 'java,php,call center,...'     // Descarta la oferta si incluye alguno
```

Las variables `CT_QUERY`, `WHITELIST_KEYWORDS` y `BLACKLIST_KEYWORDS` también pueden definirse en el entorno para sobreescribir los valores de `config.js`.

## Instalación y uso local

```bash
npm install

# Probar el bot (envía un mensaje de prueba a Telegram)
node test_bot.js

# Ejecutar una ronda completa de scraping
node test_scraper.js
```

## Despliegue en GitHub Actions

El workflow `.github/workflows/scraper.yml` ejecuta `test_scraper.js` cada 5 minutos de forma automática.

### Secrets requeridos en el repositorio

Ve a **Settings → Secrets and variables → Actions** y agrega:

- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `SCRAPERAPI_KEY`

> El workflow también puede ejecutarse manualmente desde la pestaña **Actions** usando `workflow_dispatch`.

## Estructura de archivos

```
├── config.js                  # Términos de búsqueda y listas de filtro
├── test_scraper.js            # Punto de entrada (usado por GitHub Actions)
├── test_bot.js                # Script de prueba de conexión Telegram
├── utils/
│   └── html.js                # Utilidad htmlToText compartida
├── db/
│   └── database.js            # Capa de persistencia (Redis / JSON local)
├── notifier/
│   └── telegram.js            # Formatea y envía mensajes al bot
├── scrapers/
│   ├── computrabajo.js
│   ├── laborum.js
│   ├── getonboard.js
│   └── telegram_channel.js
└── .github/workflows/
    └── scraper.yml            # Workflow de GitHub Actions
```

## Dependencias principales

| Paquete | Uso |
|---|---|
| `axios` | Peticiones HTTP |
| `cheerio` | Parsing HTML (Computrabajo, Telegram) |
| `@upstash/redis` | Persistencia en nube (serverless-compatible) |
| `node-telegram-bot-api` | Envío de mensajes Telegram |
| `dotenv` | Carga de variables de entorno |
| `node-cron` | Scheduler interno (solo para `index.js`) |
