const { createUser, getUser, getUserConfig, resetUserConfiguration, startUserConfigDraft, updateUserState } = require('../../db/database');
const { buildPortalKeyboard, buildStartMenuKeyboard, buildCvChoiceKeyboard, hasConfiguredData, formatUserConfig } = require('../wizard');

async function sendPortalSelection(bot, chatId, selectedPortals = []) {
    const welcomeText = `*Paso 1: ¿De qué plataformas quieres recibir alertas?*\nMarca una o más opciones y luego presiona *Continuar*.`;

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
    await updateUserState(chatId, 'AWAITING_CV_CHOICE');

    return bot.sendMessage(
        chatId,
        `🚀 *¡Hola! Vamos a configurar tus alertas de empleo.*

Te haré unas preguntas para saber qué trabajo buscas. Puedes hacerlo de dos formas:

📄 *Subiendo tu CV* — Lo analizo automáticamente y pre-completo la mayor parte.
✍️ *Manualmente* — Te hago las preguntas una a una.

_¿Cómo prefieres configurarlo?_`,
        {
            parse_mode: 'Markdown',
            reply_markup: buildCvChoiceKeyboard(),
        }
    );
}

module.exports = { handleStart, sendPortalSelection };
