require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const { getDB, getUserConfig } = require('./db/database');
const { handleStart } = require('./bot/handlers/start');
const { handleMessage } = require('./bot/handlers/messages');
const { handleCallbackQuery } = require('./bot/handlers/callbacks');

const token = process.env.TELEGRAM_TOKEN;
if (!token) {
    console.error("FATAL: Falta TELEGRAM_TOKEN en .env");
    process.exit(1);
}

// Iniciar bot en modo polling
const bot = new TelegramBot(token, { polling: true });

console.log("🤖 Iniciando Bot de AlertasTrabajos V2 en modo Polling...");

// Inicializar base de datos
getDB().then(() => {
    console.log("✅ Base de datos SQLite inicializada. Listo para recibir usuarios.");
}).catch(console.error);

// Comandos Principales
bot.onText(/^\/start$/, (msg) => handleStart(bot, msg));

bot.onText(/^\/config$/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const config = await getUserConfig(chatId);
    
    if (!config) {
        return bot.sendMessage(chatId, "⚠️ Aún no tienes configuración. Usa /start para inicializar el bot.");
    }
    
    const texto = `⚙️ *Tu Configuración Actual*\n
*Portales*: ${(config.portals || []).join(', ') || 'Ninguno'}
*Cargos*: ${(config.queries || []).join(', ') || 'Todos'}
*Requisitos (Whitelist)*: ${(config.whitelist || []).join(', ') || 'Ninguno'}
*Tolerado (Soft Blacklist)*: ${(config.blacklist_soft || []).join(', ') || 'Ninguno'}
*Prohibido (Hard Blacklist)*: ${(config.blacklist_hard || []).join(', ') || 'Ninguno'}
${config.portals?.includes('computrabajo') ? `*API Key ScraperAPI*: ${config.scraperapi_key ? '✅ Guardada' : '❌ Falta'}` : ''}

Para cambiar estos valores, escribe /start de nuevo.`;

    bot.sendMessage(chatId, texto, { parse_mode: 'Markdown' });
});

// Respuestas al Wizard
bot.on('message', (msg) => handleMessage(bot, msg));

// Botones Inline (Portales)
bot.on('callback_query', (query) => handleCallbackQuery(bot, query));

// --- CRON DE SCRAPING CENTRALIZADO ---
const { runScraperCycle } = require('./scraper/runner');
cron.schedule('*/5 * * * *', async () => {
    console.log("--- ⏰ Iniciando ciclo programado de scraping (Cada 5 min) ---");
    await runScraperCycle(bot);
});
console.log("⏰ Tarea cron de 5 minutos registrada.");

// Manejo de errores
bot.on("polling_error", (err) => console.log(`[Polling Error]`, err));

module.exports = { bot };
