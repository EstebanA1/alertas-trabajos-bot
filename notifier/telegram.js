require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

const bot = new TelegramBot(token, { polling: false });

async function enviarAlerta(jobData) {
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

    try {
        await bot.sendMessage(chatId, mensaje, { parse_mode: 'HTML', disable_web_page_preview: true });
        console.log(`✅ Alerta enviada desde: ${source} → ${url}`);
        return true;
    } catch (error) {
        console.error(`❌ Error enviando alerta (${source}):`, error.message);
        return false;
    }
}

module.exports = { enviarAlerta };
