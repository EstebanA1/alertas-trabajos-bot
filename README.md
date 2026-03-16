# AlertasTrabajos Bot 🤖 (V2)

Un bot de Telegram avanzado, **multiusuario e interactivo**, diseñado para rastrear portales de empleo y enviarte notificaciones push en tiempo real cuando se publican ofertas que encajan exactamente con tu perfil técnico.

Esta versión V2 está diseñada para ejecutarse de forma persistente (24/7) en un servidor Linux o contenedor LXC (ej. Proxmox), utilizando Long-Polling y una base de datos SQLite local para manejar múltiples usuarios simultáneos, cada uno con sus propias configuraciones aisladas.

---

## ✨ Características Principales

- **🧍 Multiusuario:** Soporta cientos de usuarios en la misma instancia del bot. Cada usuario (basado en su `chat_id` de Telegram) posee filtros y reglas independientes.
- **💬 Setup Conversacional:** No requiere tocar código ni archivos `.env` para configurarlo. Al enviarle `/start` al bot, un asistente (*wizard*) interactivo te pregunta mediante menús y mensajes qué quieres buscar.
- **🎯 Filtrado de Alta Precisión:**
  - **Portal Selection:** Elige encender o apagar portales individualmente (ej. GetOnBoard, Laborum).
  - **Consultas Custom:** Busca cargos específicos (`Desarrollador, QA, Data Engineer, etc.`).
  - **Whitelist:** Tecnologías o palabras clave que la oferta *debe* contener.
  - **Blacklist (Soft / Hard):** Ignora automáticamente ofertas que contengan tecnologías que no manejas o roles que no te interesan.
  - **Filtro de Experiencia Automático:** Descarta trabajos que superen tu nivel de seniority (detecta frases como "más de 3 años de experiencia").
- **🔑 Bring Your Own Key (BYOK):** Para portales que requieren rotación agresiva de IPs (como Computrabajo), el bot puede solicitar una API Key particular de proxy (ScraperAPI) a nivel de usuario, protegiendo al servidor de exceder cuotas gratuitas.
- **📉 Caché Local y Deduplicación:** Nunca te enviará la misma oferta dos veces gracias al registro en base de datos. Además optimiza las peticiones al mercado descargando el listado central y evaluándolo localmente contra cada usuario (Caché por 5 minutos).

---

## 🏗️ Arquitectura y Tecnologías

El proyecto ha transicionado desde *GitHub Actions Stateless* a una arquitectura de Node.js Continua:

- **Entrypoint:** `index.js` (Mantiene conexión WebSockets de Telegram + Ejecuta un ciclo interno con `node-cron` cada 5 minutos).
- **Base de Datos:** `SQLite3` (Almacenamiento persistente local y liviano, ideal para entornos Docker/LXC).
- **Controladores (`bot/handlers`):** Gestores de la máquina de estados de Telegram (Start, Messages, Callbacks).
- **Orquestador (`scraper/runner.js`):** Descarga el set global de empleos y efectúa el ruteo personalizado hacia el chat de cada usuario.

### Portales Soportados Naturalmente
1. **Laborum Chile** (Vía API Interna).
2. **GetOnBoard** (Vía API Pública).
3. **Trabajando.cl** (Vía red inter-sitios).
4. **DCCEmpleoSinFiltro** (Web Scraping ligero a canal público de Telegram).
5. **Computrabajo Chile** *(Requiere ScraperAPI Key configurada por el usuario en el bot).*

---

## 🚀 Guía de Despliegue (Proxmox LXC / VPS)

Para alojar el bot y ponerlo en funcionamiento 24/7:

1. **Clonar Repositorio:**
   ```bash
   git clone https://github.com/EstebanA1/alertas-trabajos-bot.git
   cd alertas-trabajos-bot
   ```

2. **Instalar Dependencias de Node:**
   Requiere versión de Node `>= 18`.
   ```bash
   npm install
   ```

3. **Configurar Variable de Entorno:**
   Crea y edita el archivo secreto en la raíz:
   ```bash
   nano .env
   ```
   *Solo necesitas definir el Token que BotFather te dio en Telegram:*
   ```env
   TELEGRAM_TOKEN=123456789:ABCDE...tus_secretos...
   ```

4. **Ejecución y Persistencia usando PM2:**
   Para asegurar que el Bot reviva ante reinicios de máquina y corra en background, se recomienda globalmente `pm2`.
   ```bash
   sudo npm install -g pm2
   pm2 start index.js --name "alertas-bot"
   pm2 save
   pm2 startup
   ```

*(Una vez iniciado, el archivo `database.sqlite` se creará mágicamente en la carpeta `db/`).*

---

## 🕹️ Uso Diario

Abre Telegram, busca a tu bot e interacciona:
- `/start` — Inicia el Wizard de configuración paso a paso.
- `/config` — Visualiza tus portales, reglas y palabras clave actuales.

---

## ⚙️ Modo Heredado (Legacy V1)

*Si llegaste a este repositorio buscando la versión original (Stateless V1) que funcionaba mediante flujos automáticos gratuitos directamente hospedada en **GitHub Actions** y **Upstash Redis** (sin necesitar un VPS propio), por favor refiérete a la rama `v1-github-actions`.*
