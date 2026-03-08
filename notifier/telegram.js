require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

// Creamos la instancia del bot
const bot = new TelegramBot(token, { polling: false });

async function enviarAlerta(jobData) {
    const { url, source, description } = jobData;
    
    // Replicar el texto completo del mensaje original del canal
    // Telegram tiene un límite de 4096 caracteres por mensaje
    const textoCompleto = description ? description.substring(0, 3900) : '(sin texto)';
    
    let mensaje = `🚨 <b>Nueva oferta — ${source}</b>\n`;
    mensaje += `━━━━━━━━━━━━━━━━━━━━\n`;
    mensaje += `${textoCompleto}\n\n`;
    mensaje += `🔗 <a href="${url}">Ver mensaje original en el canal</a>`;

    try {
        await bot.sendMessage(chatId, mensaje, { parse_mode: 'HTML', disable_web_page_preview: true });
        console.log(`✅ Alerta enviada desde: ${source} → ${url}`);
        return true;
    } catch (error) {
        console.error(`❌ Error enviando alerta (${source}):`, error.message);
        return false;
    }
}

module.exports = {
    enviarAlerta
};
