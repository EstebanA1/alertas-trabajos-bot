const { createUser, updateUserState } = require('../../db/database');

async function handleStart(bot, msg) {
    const chatId = msg.chat.id.toString();
    
    // Crear el usuario o resetearlo si ya existía
    await createUser(chatId);
    await updateUserState(chatId, 'AWAITING_PORTALS');
    
    const welcomeText = `🚀 *¡Hola! Misión: Encontrarte trabajo.*
    
Soy un bot personalizable. Buscaré ofertas para ti cada 5 minutos y te avisaré de inmediato.

*Paso 1: ¿De qué portales quieres recibir ofertas?*
Selecciona los portales usando los botones abajo y luego presiona "Continuar".`;

    const opts = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "✅ GetOnBoard", callback_data: "portal_toggle_getonboard" }],
                [{ text: "✅ Laborum", callback_data: "portal_toggle_laborum" }],
                [{ text: "✅ Trabajando", callback_data: "portal_toggle_trabajando" }],
                [{ text: "❌ Computrabajo", callback_data: "portal_toggle_computrabajo" }],
                [{ text: "⏭️ Continuar", callback_data: "portal_continue" }]
            ]
        }
    };

    bot.sendMessage(chatId, welcomeText, opts);
}

module.exports = { handleStart };
