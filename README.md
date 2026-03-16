# Alertas Trabajos Bot 🤖

Bot de Telegram multiusuario para detectar anuncios laborales en portales y canales, filtrar por perfil técnico y avisar rápido para postular antes.

## Estado actual

- Modo principal: multiusuario con wizard en Telegram (`/start`) y configuración por usuario.
- Persistencia: SQLite local (`db/database.sqlite`) para estado de usuarios y deduplicación por usuario.
- Scheduler: cron interno cada 5 minutos (sin GitHub Actions), pensado para correr 24/7 en Debian LXC.
- Compatibilidad: se mantienen scripts legacy (`test_scraper.js`) para pruebas rápidas de scraping single-user.

## Arquitectura

```
index.js (bot polling + cron cada 5 min)
    ├── bot/handlers/            # Wizard de configuración por chat
    ├── scraper/runner.js        # Orquestación central de scrapers
    ├── scrapers/                # Extracción por portal/canal
    ├── notifier/telegram.js     # Formateo y envío por usuario
    └── db/database.js           # API de datos (SQLite)
                 └── db/schema.js      # Esquema y utilidades SQL
```

## Flujo multiusuario

1. Usuario inicia con `/start` y define portales/filtros.
2. Bot guarda estado y configuración por `chat_id` en SQLite.
3. Cada 5 min, `runner` obtiene usuarios activos.
4. Descarga pools compartidos (Telegram, Laborum, GetOnBoard, Trabajando) y Computrabajo por usuario si tiene `scraperapi_key`.
5. Aplica filtros personalizados (whitelist, blacklist hard/soft, experiencia).
6. Evita duplicados por usuario con `seen_jobs` y envía alertas.

### Comandos del bot

- `/start`: inicia el wizard o, si ya existe configuración, muestra menú para editar o reiniciar.
- `/config`: muestra el resumen actual de la configuración.
- `/edit`: pausa alertas y abre edición granular de la configuración.
- `/pause`: pausa temporalmente las alertas sin borrar la configuración.
- `/resume`: reactiva las alertas guardadas.

### Wizard actual

- Selección de portales con botones inline.
- `Computrabajo` queda bloqueado hasta que el usuario entregue su `ScraperAPI key`.
- Captura de queries, whitelist, blacklist soft y blacklist hard.
- Resumen final con confirmación antes de dejar al usuario activo.
- Si el usuario entra en modo edición, las alertas quedan pausadas hasta confirmar cambios.

## Portales soportados

| Portal | Método | Requisito |
|---|---|---|
| Computrabajo Chile | HTML scraping + proxy | ScraperAPI por usuario |
| Laborum Chile | API interna REST | Ninguno |
| GetOnBoard | API pública | Ninguno |
| Trabajando.cl | API interna + detalle | Ninguno |
| DCCEmpleoSinFiltro | Web Telegram (`t.me/s/`) | Ninguno |

## Variables de entorno

Copia `.env.example` a `.env`.

| Variable | Uso |
|---|---|
| `TELEGRAM_TOKEN` | Obligatoria. Token del bot |
| `BOT_TIMEZONE` | Opcional. Ej: `America/Santiago` |
| `SCRAPERAPI_KEY` | Opcional. Fallback global legacy |
| `CT_QUERY` | Opcional. Queries por defecto legacy |
| `TELEGRAM_CHAT_ID` | Solo modo legacy (`test_scraper.js`) |

Notas:
- En modo multiusuario, cada usuario puede guardar su propia `scraperapi_key` en el wizard.
- En modo legacy, `TELEGRAM_CHAT_ID` sigue siendo requerido para envío a un chat fijo.

## Ejecutar local

```bash
npm install

# Modo principal (multiusuario)
npm start

# Modo legacy (single-user, útil para diagnóstico rápido)
npm run start:legacy
```

## Despliegue en Debian LXC (Proxmox)

Se recomienda PM2 para mantener el proceso vivo y reiniciar en reboot.

```bash
# dentro del LXC
npm install
npm install -g pm2

mkdir -p logs
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup systemd
```

Comandos útiles:

```bash
pm2 status
pm2 logs alertastrabajos-bot
pm2 restart alertastrabajos-bot
pm2 stop alertastrabajos-bot
```

## Robustez aplicada

- `node-cron` con `noOverlap: true` y zona horaria configurable.
- Control de ejecución concurrente en `runner` para evitar ciclos duplicados.
- `SQLite WAL + busy_timeout` para menor contención en escrituras.
- Manejo de señales `SIGINT/SIGTERM` para cierre limpio de polling.
- API de scrapers con firma compatible para modo legacy y multiusuario.

## Estructura relevante

```
index.js
scraper/runner.js
db/database.js
db/schema.js
notifier/telegram.js
scrapers/*.js
ecosystem.config.js
.env.example
```
