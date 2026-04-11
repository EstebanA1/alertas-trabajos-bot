require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const { activateUser, getDB, getUser, getUserConfig, getUserDraftConfig, startUserConfigDraft, updateUserState } = require('./db/database');
const { handleStart } = require('./bot/handlers/start');
const { handleMessage, handleDocumentMessage } = require('./bot/handlers/messages');
const { handleCallbackQuery } = require('./bot/handlers/callbacks');
const { buildEditMenuKeyboard, formatUserConfig } = require('./bot/wizard');

const token = process.env.TELEGRAM_TOKEN;
if (!token) {
    console.error("FATAL: Falta TELEGRAM_TOKEN en .env");
    process.exit(1);
}

// Iniciar bot en modo polling
const bot = new TelegramBot(token, { polling: true });

const isLocal = Boolean(process.env.DB_PATH);
const tokenPreview = token.split(':')[0];
console.log(`\n================================================`);
console.log(`🤖  AlertasTrabajos Bot V2`);
console.log(`🔑  Token ID: ${tokenPreview}  [${isLocal ? '🧪 LOCAL / PRUEBAS' : '🚀 PRODUCCIÓN'}]`);
console.log(`🗄️   DB: ${process.env.DB_PATH || 'db/database.sqlite (default)'}`);
console.log(`================================================\n`);

// Inicializar base de datos
getDB().then(() => {
    console.log("✅ Base de datos SQLite inicializada. Listo para recibir usuarios.");
}).catch(console.error);

// Comandos Principales
bot.onText(/^\/start$/, (msg) => handleStart(bot, msg));

bot.onText(/^\/edit$/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const config = await getUserConfig(chatId);

    if (!config) {
        return bot.sendMessage(chatId, '⚠️ Aún no tienes configuración. Usa /start para comenzar.', { parse_mode: 'Markdown' });
    }

    await activateUser(chatId, 0);
    const draft = await startUserConfigDraft(chatId);
    await updateUserState(chatId, 'AWAITING_CONFIRMATION');

    return bot.sendMessage(chatId, '✏️ *Modo edición activado.*\n\nTus alertas quedan pausadas hasta que confirmes los cambios.', {
        parse_mode: 'Markdown',
    }).then(() => bot.sendMessage(chatId, '✏️ *¿Qué quieres editar?*', {
        parse_mode: 'Markdown',
        reply_markup: buildEditMenuKeyboard(draft || config),
    }));
});

bot.onText(/^\/pause$/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const user = await getUser(chatId);

    if (!user) {
        return bot.sendMessage(chatId, '⚠️ Aún no tienes configuración. Usa /start para comenzar.', { parse_mode: 'Markdown' });
    }

    await activateUser(chatId, 0);
    await updateUserState(chatId, 'ACTIVE');
    return bot.sendMessage(chatId, '⏸️ *Alertas pausadas.*\n\nTu configuración sigue guardada. Usa /resume para reactivar las notificaciones.', {
        parse_mode: 'Markdown',
    });
});

bot.onText(/^\/resume$/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const [user, config] = await Promise.all([getUser(chatId), getUserConfig(chatId)]);

    if (!user || !config) {
        return bot.sendMessage(chatId, '⚠️ Aún no tienes configuración. Usa /start para comenzar.', { parse_mode: 'Markdown' });
    }

    if (!config.queries?.length) {
        return bot.sendMessage(chatId, '⚠️ No pude reactivar tus alertas porque faltan queries. Usa /edit para completar la configuración.', {
            parse_mode: 'Markdown',
        });
    }

    await activateUser(chatId, 1);
    await updateUserState(chatId, 'ACTIVE');
    return bot.sendMessage(chatId, '▶️ *Alertas reactivadas.*\n\nVolverás a recibir notificaciones en el próximo ciclo del bot.', {
        parse_mode: 'Markdown',
    });
});

bot.onText(/^\/help$/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const helpText =
        `🤖 *¿Qué puedo hacer por ti?*

Soy un bot que revisa portales de empleo cada 5 minutos y te avisa cuando aparece una oferta que calza con tu perfil. Sin que tengas que estar mirando la pantalla.

📋 *Comandos disponibles:*

▶️ /start — Inicia (o reinicia) la configuración de tus alertas. Úsalo la primera vez para decirme qué trabajo buscas.

⚙️ /status — Muestra cómo tienes configuradas tus alertas en este momento.

✏️ /edit — Abre el menú de edición para cambiar cualquier dato de tu configuración (qué buscar, en qué portales, etc.)

⏸️ /pause — Pausa las notificaciones. Tu configuración se guarda, solo dejas de recibir alertas temporalmente.

▶️ /resume — Reactiva las notificaciones después de haberlas pausado.

ℹ️ /help — Muestra este mensaje de ayuda.

💬 *¿Cómo funciona el setup?*
Cuando usas /start, el bot te hace una serie de preguntas sobre qué tipo de trabajo buscas, en qué portales y qué palabras clave quieres incluir o excluir. Todo paso a paso, sin necesidad de saber de tecnología.`;

    return bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

bot.onText(/^\/status$/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const [user, config, draft] = await Promise.all([getUser(chatId), getUserConfig(chatId), getUserDraftConfig(chatId)]);
    
    if (!config) {
        return bot.sendMessage(chatId, "⚠️ Aún no tienes configuración. Usa /start para inicializar el bot.");
    }

    const draftNotice = draft ? '\n\n📝 Tienes un borrador pendiente de confirmar (usa /edit para revisarlo).' : '';

    return bot.sendMessage(chatId, `${formatUserConfig(config, { active: Boolean(user?.active) })}${draftNotice}\n\nPara cambiar estos valores, usa /edit o /start. También puedes usar /pause y /resume.`, {
        parse_mode: 'Markdown',
    });
});

bot.onText(/^\/admin$/, async (msg) => {
    const adminId = process.env.ADMIN_CHAT_ID;
    const chatId = msg.chat.id.toString();
    if (!adminId || chatId !== adminId) return;

    const { getRunStats } = require('./scraper/runner');
    const stats = getRunStats();

    const text = `🛠️ *Panel de Administración*

*Estado:* ${stats.lastRunStatus === 'running' ? '🚀 Escaneando...' : '💤 En espera'}
*Último ciclo:* ${stats.lastRun ? stats.lastRun.toLocaleString('es-CL', { timeZone: 'America/Santiago' }) : 'No ha corrido'}
*Duración:* ${(stats.durationMs / 1000).toFixed(1)}s
*Usuarios Activos:* ${stats.activeUsers || 0}
*Ofertas obtenidas:* ${stats.jobsFound || 0}
*Errores recientes:* ${stats.errors?.length ? stats.errors.join('\\n') : 'Ninguno'}`;

    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

bot.onText(/^\/clean$/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const text = `⚠️ *Peligro*\n\nEstás a punto de borrar TODA tu configuración, tu borrador y tu historial de ofertas vistas. Empezarás desde cero absoluto y podrías volver a recibir ofertas que ya habías visto.\n\n¿Estás realmente seguro?`;
    return bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '☠️ Sí, borrar todo', callback_data: 'start_clean_confirm' }],
                [{ text: '❌ Cancelar', callback_data: 'wizard_summary' }]
            ]
        }
    });
});

// Respuestas al Wizard
bot.on('message', (msg) => handleMessage(bot, msg));

// Documentos (CV en PDF para setup rápido)
bot.on('document', (msg) => handleDocumentMessage(bot, msg));

// Botones Inline (Portales)
bot.on('callback_query', (query) => handleCallbackQuery(bot, query));

// --- CRON DE SCRAPING CENTRALIZADO ---
const { runScraperCycle } = require('./scraper/runner');
const tz = process.env.BOT_TIMEZONE || 'America/Santiago';
cron.schedule('*/5 * * * *', async () => {
    console.log("--- ⏰ Iniciando ciclo programado de scraping (Cada 5 min) ---");
    try {
        await runScraperCycle(bot);
    } catch (err) {
        console.error('❌ Error no controlado en ciclo de scraping:', err.message);
    }
}, {
    timezone: tz,
    noOverlap: true,
});
console.log(`⏰ Tarea cron de 5 minutos registrada (TZ=${tz}, noOverlap=true).`);

// Manejo de errores
bot.on('polling_error', (err) => {
    console.error(`[Polling Error ${err.code || 'UNKNOWN'}]`, err.message || err);
});

async function shutdown(signal) {
    console.log(`🛑 Señal ${signal} recibida. Cerrando bot...`);
    try {
        await bot.stopPolling({ cancel: true, reason: signal });
    } catch (err) {
        console.error('Error al detener polling:', err.message);
    } finally {
        process.exit(0);
    }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { bot };
