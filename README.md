# AlertasTrabajos Bot 🤖 (V2)

Un bot de Telegram **multiusuario e interactivo** para rastrear portales de empleo y enviarte notificaciones en tiempo real cuando se publican ofertas que encajan con tu perfil.

Diseñado para ejecutarse 24/7 en un servidor Linux o contenedor LXC (ej. Proxmox), usando Long-Polling y SQLite para manejar múltiples usuarios con configuraciones independientes.

---

## ✨ Características Principales

- **🧍 Multiusuario:** Cada usuario tiene sus propios filtros y configuración aislada.
- **📄 Setup por CV (nuevo):** Sube tu CV en PDF y el bot extrae automáticamente cargos, habilidades y años de experiencia via Gemini IA. También sugiere mejoras a tu configuración.
- **💬 Setup Manual Conversacional:** Wizard paso a paso sin tocar código.
- **🎯 Filtrado de Alta Precisión:**
  - **Portal Selection:** Elige qué portales quieres monitorear.
  - **Consultas Custom:** Cargos específicos a buscar.
  - **Whitelist:** Palabras clave que la oferta debe contener.
  - **Blacklist Soft / Hard:** Ignora ofertas con palabras no deseadas (con tolerancia configurable).
  - **Filtro de Experiencia:** Descarta trabajos que superen tu seniority.
- **💡 Recomendaciones IA (nuevo):** Luego del análisis del CV, Gemini sugiere sinónimos de cargos y keywords adicionales para ampliar el alcance de búsqueda.
- **🗑️ Limpiar datos (nuevo):** Borra configuración e historial de ofertas vistas para probar desde cero rápidamente.
- **🔑 Bring Your Own Key (BYOK):** Para Computrabajo se usa una ScraperAPI Key personal.
- **📉 Deduplicación por usuario:** Nunca recibirás la misma oferta dos veces.

---

## 🏗️ Arquitectura y Tecnologías

- **Entrypoint:** `index.js` — Long-Polling Telegram + cron interno cada 5 minutos.
- **Base de Datos:** SQLite3 (liviana, persistente, ideal para Docker/LXC).
- **IA:** Google Gemini API (`gemini-1.5-flash`) — análisis de CV y sugerencias de mejora.
- **Controladores (`bot/handlers`):** Máquina de estados (Start, Messages, Callbacks, DocumentHandler).
- **Orquestador (`scraper/runner.js`):** Descarga el pool global de empleos y los evalúa por usuario.
- **Parser de CV (`bot/cv_parser.js`):** Descarga el PDF de Telegram, extrae texto con `pdf-parse` y llama a Gemini.

### Portales Soportados

| Portal | Método | Requiere key |
|---|---|---|
| Laborum Chile | API interna | No |
| GetOnBoard | API pública | No |
| Trabajando.cl | API interna | No |
| DCCEmpleoSinFiltro | Scraping canal Telegram | No |
| Computrabajo Chile | ScraperAPI proxy | Sí (por usuario) |

---

## 🚀 Guía de Despliegue (Proxmox LXC / VPS)

1. **Clonar repositorio:**
   ```bash
   git clone https://github.com/EstebanA1/alertas-trabajos-bot.git
   cd alertas-trabajos-bot
   ```

2. **Instalar dependencias** (requiere Node >= 18):
   ```bash
   npm install
   ```

3. **Configurar variables de entorno:**
   ```bash
   cp .env.example .env
   nano .env
   ```
   Variables requeridas:
   ```env
   TELEGRAM_TOKEN=123456789:ABCDE...
   ```
   Variables opcionales:
   ```env
   # Para análisis de CV con IA (obtener en https://aistudio.google.com/apikey)
   GEMINI_API_KEY=tu_api_key

   # ID de Telegram del admin para habilitar comando /admin
   ADMIN_CHAT_ID=tu_chat_id

   # Timezone del cron (default: America/Santiago)
   BOT_TIMEZONE=America/Santiago
   ```

4. **Ejecutar con PM2:**
   ```bash
   sudo npm install -g pm2
   pm2 start index.js --name "alertas-bot"
   pm2 save
   pm2 startup
   ```

5. **Rotación de Logs (Recomendado):**
   Para evitar que los archivos log crezcan infinitamente, instala:
   ```bash
   pm2 install pm2-logrotate
   ```

El archivo `db/database.sqlite` se crea automáticamente al iniciar.

> 💡 **Tip para Producción Avanzada:**
> Por defecto el bot funciona con *Long-polling*. Si dispones de un servidor web con dominio (ej. nginx) y certificado SSL, considera transicionar tu propio código a modo **Webhook** para hacerlo más eficiente en recursos.

---

## 🕹️ Comandos del Bot

| Comando | Descripción |
|---|---|
| `/start` | Inicia el wizard de configuración (CV o manual) |
| `/status` | Muestra tu configuración actual |
| `/edit` | Edita un campo de tu configuración |
| `/pause` | Pausa las notificaciones temporalmente |
| `/resume` | Reanuda las notificaciones |
| `/help` | Muestra ayuda y descripción de comandos |

---

## 🔄 Flujo de Onboarding

```
/start
  ├── [📄 Subir mi CV]
  │     → Bot descarga PDF → extrae texto → Gemini analiza
  │     → Muestra: cargos / palabras clave / años exp
  │         ├── [💡 Ver recomendaciones] → Gemini sugiere mejoras → aplicar o mantener
  │         └── [▶️ Continuar sin optimizar]
  │     → Selección de portales → Resumen → Confirmar
  │
  └── [✍️ Configurar manualmente]
        → Portales → Cargos → Antigüedad → Experiencia
        → Whitelist → Blacklist soft → Blacklist hard
        → Resumen → Confirmar
```

---

## ⚙️ Modo Heredado (Legacy V1)

Si buscas la versión original (Stateless, GitHub Actions + Upstash Redis, sin VPS), consulta la rama `v1-github-actions`.
