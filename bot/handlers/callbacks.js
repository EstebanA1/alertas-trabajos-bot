const { getUserConfig, updateUserConfig, updateUserState } = require('../../db/database');

async function handleCallbackQuery(bot, callbackQuery) {
    const message = callbackQuery.message;
    const chatId = message.chat.id.toString();
    const data = callbackQuery.data;

    if (data.startsWith('portal_toggle_')) {
        const portal = data.replace('portal_toggle_', '');
        const config = await getUserConfig(chatId);
        if (!config) return bot.answerCallbackQuery(callbackQuery.id);

        let portals = config.portals || [];
        if (portals.includes(portal)) {
            portals = portals.filter(p => p !== portal); // Remover
        } else {
            portals.push(portal); // Agregar
        }

        await updateUserConfig(chatId, 'portals', portals);

        // Reconstruir el teclado mostrando checkmarks
        const isSel = (p) => portals.includes(p) ? '✅' : '❌';
        const newKeyboard = {
            inline_keyboard: [
                [{ text: `${isSel('getonboard')} GetOnBoard`, callback_data: "portal_toggle_getonboard" }],
                [{ text: `${isSel('laborum')} Laborum`, callback_data: "portal_toggle_laborum" }],
                [{ text: `${isSel('trabajando')} Trabajando`, callback_data: "portal_toggle_trabajando" }],
                [{ text: `${isSel('computrabajo')} Computrabajo (Requiere API Key)`, callback_data: "portal_toggle_computrabajo" }],
                [{ text: "⏭️ Continuar", callback_data: "portal_continue" }]
            ]
        };

        bot.editMessageReplyMarkup(newKeyboard, {
            chat_id: chatId,
            message_id: message.message_id
        });

        bot.answerCallbackQuery(callbackQuery.id);
    } 
    else if (data === 'portal_continue') {
        const config = await getUserConfig(chatId);
        const portals = config.portals || [];

        if (portals.length === 0) {
            return bot.answerCallbackQuery(callbackQuery.id, { text: "⚠️ Debes seleccionar al menos 1 portal.", show_alert: true });
        }

        // Ya no cambian los botones, limpiamos el teclado
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: chatId,
            message_id: message.message_id
        });

        if (portals.includes('computrabajo')) {
            await updateUserState(chatId, 'AWAITING_SCRAPERAPI_KEY');
            bot.sendMessage(chatId, `🔑 *Computrabajo requiere ScraperAPI.*

Para evitar bloqueos, Computrabajo necesita una proxy residencial. Ve a [ScraperAPI](https://www.scraperapi.com/), regístrate gratis, y envíame tu \`API KEY\`.

Si ya no quieres usarlo, escribe /start para empezar de nuevo.`, { parse_mode: 'Markdown', disable_web_page_preview: true });
        } else {
            await updateUserState(chatId, 'AWAITING_QUERIES');
            bot.sendMessage(chatId, `✅ *Portales guardados.*\n\n*Paso 2: ¿Qué cargos buscas?*\nEscribe los puestos separados por comas.\n\n_Ejemplo:_ \`desarrollador, programador, analista qa\``, { parse_mode: 'Markdown' });
        }
        bot.answerCallbackQuery(callbackQuery.id);
    }
}

module.exports = { handleCallbackQuery };
