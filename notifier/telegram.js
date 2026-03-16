require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

let defaultBot = null;

function getDefaultBot() {
    if (!token) return null;
    if (!defaultBot) {
        defaultBot = new TelegramBot(token, { polling: false });
    }
    return defaultBot;
}

function buildMensaje(jobData) {
    const { title, company, url, source, description } = jobData;
    const esCanalTelegram = source.toLowerCase().includes('telegram');

    let mensaje = `🚨 <b>Nueva oferta — ${source}</b>\n`;
    mensaje += `━━━━━━━━━━━━━━━━━━━━\n`;

    if (esCanalTelegram) {
        const texto = description ? description.substring(0, 3900) : '(sin texto)';
        mensaje += `${texto}\n\n`;
        mensaje += `🔗 <a href="${url}">Ver en el canal</a>`;
    } else {
        if (title)   mensaje += `💼 <b>${title}</b>\n`;
        if (company) mensaje += `🏢 ${company}\n`;
        if (description && description.trim()) {
            mensaje += `\n${description.substring(0, 3500)}\n\n`;
        } else {
            mensaje += `\n`;
        }
        mensaje += `🔗 <a href="${url}">Ver oferta completa</a>`;
    }

    return mensaje;
}

async function enviarAlertaParaUsuario(bot, chatIdDestino, jobData) {
    if (!bot || !chatIdDestino) return false;

    const mensaje = buildMensaje(jobData);

    try {
        await bot.sendMessage(chatIdDestino, mensaje, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        });
        console.log(`✅ Alerta enviada a ${chatIdDestino}: ${jobData.source} → ${jobData.url}`);
        return true;
    } catch (error) {
        console.error(`❌ Error enviando alerta a ${chatIdDestino} (${jobData.source}):`, error.message);
        return false;
    }
}

async function enviarAlerta(jobData) {
    const bot = getDefaultBot();
    if (!bot || !chatId) {
        console.error('❌ TELEGRAM_TOKEN o TELEGRAM_CHAT_ID faltante para modo legacy.');
        return false;
    }
    return enviarAlertaParaUsuario(bot, chatId, jobData);
}

module.exports = { enviarAlerta, enviarAlertaParaUsuario };
