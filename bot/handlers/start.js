const { createUser, getUser, getUserConfig, resetUserConfiguration, startUserConfigDraft, updateUserState } = require('../../db/database');
const { buildPortalKeyboard, buildStartMenuKeyboard, hasConfiguredData, formatUserConfig } = require('../wizard');

async function sendPortalSelection(bot, chatId, selectedPortals = []) {
    const welcomeText = `🚀 *¡Hola! Misión: encontrarte trabajo.*

Soy un bot personalizable. Buscaré ofertas para ti cada 5 minutos y te avisaré apenas encuentre algo que calce con tus filtros.

*Paso 1: ¿De qué plataformas quieres recibir alertas?*
Marca una o más opciones y luego presiona *Continuar*.`;

    return bot.sendMessage(chatId, welcomeText, {
        parse_mode: 'Markdown',
        reply_markup: buildPortalKeyboard(selectedPortals),
    });
}

async function handleStart(bot, msg) {
    const chatId = msg.chat.id.toString();

    await createUser(chatId);
    const user = await getUser(chatId);
    const config = await getUserConfig(chatId);

    if (user && (user.active || hasConfiguredData(config))) {
        return bot.sendMessage(
            chatId,
            `${formatUserConfig(config || {}, { active: Boolean(user.active) })}\n\n¿Qué quieres hacer ahora?`,
            {
                parse_mode: 'Markdown',
                reply_markup: buildStartMenuKeyboard(),
            }
        );
    }

    await resetUserConfiguration(chatId);
    await startUserConfigDraft(chatId);
    await updateUserState(chatId, 'AWAITING_PORTALS');
    return sendPortalSelection(bot, chatId, []);
}

module.exports = { handleStart, sendPortalSelection };
