const { getUser, getUserDraftConfig, updateDraftFieldOnly, updateUserState } = require('../../db/database');
const { parseCvFromTelegram } = require('../cv_parser');
const { buildSummaryKeyboard, formatUserConfig, getPromptForField, isNoneKeyword, normalizeCsvInput } = require('../wizard');

function promptFieldIdFromState(state) {
    switch (state) {
        case 'AWAITING_SCRAPERAPI_KEY':
        case 'EDITING_SCRAPERAPI_KEY':
            return 'scraperapi_key';
        case 'AWAITING_DAYS_LOOKBACK':
        case 'EDITING_DAYS_LOOKBACK':
            return 'days_lookback';
        case 'AWAITING_EXPERIENCE_YEARS':
        case 'EDITING_EXPERIENCE_YEARS':
            return 'years_experience';
        case 'AWAITING_QUERIES':
        case 'EDITING_QUERIES':
            return 'queries';
        case 'AWAITING_WHITELIST':
        case 'EDITING_WHITELIST':
            return 'whitelist';
        case 'AWAITING_BLACKLIST_SOFT':
        case 'EDITING_BLACKLIST_SOFT':
            return 'blacklist_soft';
        case 'AWAITING_BLACKLIST_HARD':
        case 'EDITING_BLACKLIST_HARD':
            return 'blacklist_hard';
        default:
            return null;
    }
}

function normalizeFieldValue(fieldId, text) {
    if (fieldId === 'scraperapi_key') {
        return String(text || '').trim();
    }

    if (fieldId === 'days_lookback') {
        const n = parseInt(String(text || '').trim(), 10);
        return isNaN(n) ? null : Math.min(Math.max(n, 1), 30);
    }

    if (fieldId === 'years_experience') {
        if (isNoneKeyword(text)) return null;
        const n = parseInt(String(text || '').trim(), 10);
        return isNaN(n) ? null : Math.min(Math.max(n, 0), 20);
    }

    if (isNoneKeyword(text)) {
        return [];
    }

    return normalizeCsvInput(text);
}

async function promptField(bot, chatId, fieldId, editing = false) {
    const prompt = getPromptForField(fieldId);
    if (!prompt) return null;

    return bot.sendMessage(chatId, `${editing ? '✏️ *Edición*\n\n' : ''}${prompt}`, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
    });
}

async function sendSummary(bot, chatId, config, user) {
    await updateUserState(chatId, 'AWAITING_CONFIRMATION');
    return bot.sendMessage(
        chatId,
        `${formatUserConfig(config, { active: false })}\n\n*Este es tu borrador.* Si está todo correcto, confirma para activar las alertas. Si no, puedes editar un campo puntual.`,
        {
            parse_mode: 'Markdown',
            reply_markup: buildSummaryKeyboard(config),
        }
    );
}

async function handleMessage(bot, msg) {
    const chatId = msg.chat.id.toString();
    const text = msg.text?.trim();

    if (!text || text.startsWith('/')) return;

    const user = await getUser(chatId);
    if (!user) return;

    // Estados donde se espera una acción distinta a texto libre
    if (user.state === 'AWAITING_CV_CHOICE') {
        return bot.sendMessage(chatId, '👆 Por favor elige una opción de los botones de arriba para continuar.', { parse_mode: 'Markdown' });
    }
    if (user.state === 'AWAITING_CV_UPLOAD') {
        return bot.sendMessage(chatId, '📎 Por favor envía tu CV como archivo PDF (no como texto).', { parse_mode: 'Markdown' });
    }

    const fieldId = promptFieldIdFromState(user.state);
    if (!fieldId) return;

    const value = normalizeFieldValue(fieldId, text);

    if (fieldId === 'queries' && (!Array.isArray(value) || value.length === 0)) {
        return bot.sendMessage(chatId, '⚠️ Debes indicar al menos un cargo o query.', { parse_mode: 'Markdown' });
    }

    if (fieldId === 'scraperapi_key' && String(value).length < 8) {
        return bot.sendMessage(chatId, '⚠️ La key parece demasiado corta. Revísala y vuelve a enviarla.', { parse_mode: 'Markdown' });
    }

    if (fieldId === 'days_lookback' && value === null) {
        return bot.sendMessage(chatId, '⚠️ Ingresa un número entre 1 y 30.', { parse_mode: 'Markdown' });
    }

    if (fieldId === 'years_experience' && value === null && !isNoneKeyword(text)) {
        return bot.sendMessage(chatId, '⚠️ Ingresa un número de 0 a 20, o escribe \`ninguno\` para desactivar el filtro.', { parse_mode: 'Markdown' });
    }

    await updateDraftFieldOnly(chatId, fieldId, value);
    const updatedConfig = await getUserDraftConfig(chatId);

    // Si estamos editando un campo puntual, volver al resumen
    if (user.state.startsWith('EDITING_')) {
        return bot.sendMessage(chatId, '✅ *Campo actualizado.*', { parse_mode: 'Markdown' })
            .then(() => sendSummary(bot, chatId, updatedConfig, user));
    }

    // Si estamos en el flujo secuencial (AWAITING_...), buscar el siguiente paso vacío
    return continueWizard(bot, chatId);
}

/**
 * Inteligencia de navegación: busca el siguiente campo vacío y guía al usuario.
 */
async function continueWizard(bot, chatId) {
    const [user, config] = await Promise.all([getUser(chatId), getUserDraftConfig(chatId)]);
    
    if (!config) return;

    // 1. Prioridad: ScraperAPI si eligió Computrabajo y no tiene key
    if (config.portals?.includes('computrabajo') && (!config.scraperapi_key || config.scraperapi_key.length < 5)) {
        await updateUserState(chatId, 'AWAITING_SCRAPERAPI_KEY');
        return promptField(bot, chatId, 'scraperapi_key');
    }

    // 2. Cargos (Queries)
    if (!config.queries?.length) {
        await updateUserState(chatId, 'AWAITING_QUERIES');
        return promptField(bot, chatId, 'queries');
    }

    // 3. Ventana de tiempo (Días)
    // Si el usuario viene de un CV, el draft tendrá el default (1). 
    // Para que sea fluido, solo preguntamos si el estado ACTUAL es AWAITING_DAYS_LOOKBACK 
    // o si explícitamente queremos que pase por aquí.
    // Pero si ya tiene queries (por CV) y estamos saltando, lo ideal es ir al resumen o siguiente vacío.
    if (user.state === 'AWAITING_QUERIES' || (user.state === 'AWAITING_SCRAPERAPI_KEY' && !config.queries?.length)) {
         // Si acabamos de llenar queries, vamos a días
         await updateUserState(chatId, 'AWAITING_DAYS_LOOKBACK');
         return promptField(bot, chatId, 'days_lookback');
    }

    // 4. Experiencia
    if (config.years_experience === null || config.years_experience === undefined) {
        await updateUserState(chatId, 'AWAITING_EXPERIENCE_YEARS');
        return promptField(bot, chatId, 'years_experience');
    }

    // 5. Whitelist
    if (!config.whitelist?.length) {
        await updateUserState(chatId, 'AWAITING_WHITELIST');
        return promptField(bot, chatId, 'whitelist');
    }

    // 6. Blacklists (Soft y Hard)
    if (!config.blacklist_soft?.length) {
        await updateUserState(chatId, 'AWAITING_BLACKLIST_SOFT');
        return promptField(bot, chatId, 'blacklist_soft');
    }
    if (!config.blacklist_hard?.length) {
        await updateUserState(chatId, 'AWAITING_BLACKLIST_HARD');
        return promptField(bot, chatId, 'blacklist_hard');
    }

    // Si llegamos aquí, todo lo importante tiene DAto o ha sido saltado (flujo CV)
    return sendSummary(bot, chatId, config, user);
}

async function handleDocumentMessage(bot, msg) {
    const chatId = msg.chat.id.toString();
    const user = await getUser(chatId);

    // Solo actuar cuando el usuario está esperando subir su CV
    if (!user || user.state !== 'AWAITING_CV_UPLOAD') return;

    const doc = msg.document;

    // Validar que sea PDF
    if (doc.mime_type !== 'application/pdf') {
        return bot.sendMessage(
            chatId,
            '⚠️ El archivo debe ser un PDF. Por favor envía tu CV en formato `.pdf`.',
            { parse_mode: 'Markdown' }
        );
    }

    await bot.sendMessage(chatId, '⏳ Analizando tu CV, un momento...', { parse_mode: 'Markdown' });

    let cvData = null;
    try {
        cvData = await parseCvFromTelegram(bot, doc.file_id, doc.file_size);
    } catch (err) {
        console.error(`[CV Parser] Error para ${chatId}: ${err.message}`);
        return bot.sendMessage(
            chatId,
            `⚠️ *No pude procesar tu CV.*\n\n_${err.message}_\n\nPuedes continuar configurando los datos manualmente.`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✍️ Continuar manualmente', callback_data: 'cv_choice_manual' }
                    ]]
                }
            }
        );
    }

    // Guardar los campos extraídos en el draft
    if (cvData.queries?.length)          await updateDraftFieldOnly(chatId, 'queries', cvData.queries);
    if (cvData.whitelist?.length)        await updateDraftFieldOnly(chatId, 'whitelist', cvData.whitelist);
    if (cvData.years_experience != null) await updateDraftFieldOnly(chatId, 'years_experience', cvData.years_experience);

    // Actualizar estado a AWAITING_PORTALS para que el flujo siga naturalmente
    await updateUserState(chatId, 'AWAITING_PORTALS');

    // Mostrar resumen de lo detectado
    const queriesStr   = cvData.queries?.length   ? cvData.queries.join(', ')   : 'No detectados';
    const whitelistStr = cvData.whitelist?.length  ? cvData.whitelist.join(', ') : 'No detectadas';
    const expStr       = cvData.years_experience != null ? `${cvData.years_experience} año(s)` : 'No detectados';

    await bot.sendMessage(
        chatId,
        `✅ *¡CV analizado!* Esto es lo que detecté:\n\n` +
        `*Cargos buscados:* ${queriesStr}\n` +
        `*Palabras clave:* ${whitelistStr}\n` +
        `*Años de experiencia:* ${expStr}\n\n` +
        `_Podrás revisar y editar todo esto al final antes de confirmar._`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💡 Ver recomendaciones de mejora', callback_data: 'cv_suggest_improvements' }],
                    [{ text: '▶️ Continuar sin optimizar', callback_data: 'cv_skip_suggestions' }],
                ]
            }
        }
    );
    // El avance a portales ocurre desde el callback (cv_skip_suggestions o después de aplicar/rechazar sugerencias)
}

module.exports = { handleMessage, handleDocumentMessage, promptField, sendSummary, continueWizard };
