const {
    activateUser,
    clearUserData,
    commitUserConfigDraft,
    discardUserConfigDraft,
    getUser,
    getUserConfig,
    getUserDraftConfig,
    resetUserConfiguration,
    savePendingSuggestion,
    getPendingSuggestion,
    clearPendingSuggestion,
    startUserConfigDraft,
    updateDraftFieldOnly,
    updateUserState,
} = require('../../db/database');
const { buildCvChoiceKeyboard, buildEditMenuKeyboard, buildPortalKeyboard, formatUserConfig, getPromptForField } = require('../wizard');
const { promptField, sendSummary } = require('./messages');
const { sendPortalSelection } = require('./start');
const { generateRecommendations } = require('../cv_parser');

async function showSummary(bot, chatId) {
    const [user, draft, config] = await Promise.all([
        getUser(chatId),
        getUserDraftConfig(chatId),
        getUserConfig(chatId),
    ]);

    if (draft) {
        return sendSummary(bot, chatId, draft || {}, user);
    }

    if (config) {
        return bot.sendMessage(chatId, `${formatUserConfig(config || {}, { active: Boolean(user?.active) })}\n\nUsa /edit para abrir un borrador y modificar tu configuración.`, {
            parse_mode: 'Markdown',
        });
    }

    return bot.sendMessage(chatId, '⚠️ Aún no tienes configuración activa. Usa /start para comenzar.', {
        parse_mode: 'Markdown',
    });
}

async function showEditMenu(bot, chatId) {
    let config = await getUserDraftConfig(chatId);
    if (!config) {
        config = await startUserConfigDraft(chatId);
    }

    return bot.sendMessage(chatId, '✏️ *¿Qué quieres editar?*', {
        parse_mode: 'Markdown',
        reply_markup: buildEditMenuKeyboard(config || {}),
    });
}

async function continueAfterPortals(bot, chatId, user, config) {
    const portals = config.portals || [];

    if (portals.length === 0) {
        return bot.sendMessage(chatId, '⚠️ Debes seleccionar al menos un portal.', { parse_mode: 'Markdown' });
    }

    const editing = user.state === 'EDITING_PORTALS';

    if (portals.includes('computrabajo') && !config.scraperapi_key) {
        await updateUserState(chatId, editing ? 'EDITING_SCRAPERAPI_KEY' : 'AWAITING_SCRAPERAPI_KEY');
        return promptField(bot, chatId, 'scraperapi_key', editing);
    }

    if (editing) {
        const updatedUser = await getUser(chatId);
        return sendSummary(bot, chatId, config, updatedUser);
    }

    await updateUserState(chatId, 'AWAITING_QUERIES');
    return promptField(bot, chatId, 'queries');
}

async function handleCallbackQuery(bot, callbackQuery) {
    const message = callbackQuery.message;
    const chatId = message.chat.id.toString();
    const data = callbackQuery.data;

    if (data === 'start_clean') {
        await bot.answerCallbackQuery(callbackQuery.id);
        return bot.sendMessage(
            chatId,
            '🗑️ *¿Seguro que quieres limpiar todos tus datos?*\n\n_Esto borrará tu configuración actual y tu historial de ofertas vistas. Tendrás que configurar el bot de nuevo desde cero._',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⚠️ Sí, limpiar todo', callback_data: 'start_clean_confirm' }],
                        [{ text: '❌ Cancelar', callback_data: 'wizard_summary' }],
                    ]
                }
            }
        );
    }

    if (data === 'start_clean_confirm') {
        await clearUserData(chatId);
        await startUserConfigDraft(chatId);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Datos eliminados.' });
        return bot.sendMessage(
            chatId,
            '✅ *Todos tus datos fueron eliminados.*\n\nEl historial de ofertas vistas y tu configuración quedaron en blanco. Puedes volver a configurar desde cero cuando quieras.',
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🚀 Configurar desde cero', callback_data: 'start_reset' }]] }
            }
        );
    }

    if (data === 'start_reset') {
        await resetUserConfiguration(chatId);
        await startUserConfigDraft(chatId);
        await updateUserState(chatId, 'AWAITING_CV_CHOICE');
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Configuración reiniciada.' });
        return bot.sendMessage(
            chatId,
            `🚀 *Reiniciando configuración.*\n\n¿Cómo prefieres volver a configurar tus alertas?`,
            { parse_mode: 'Markdown', reply_markup: buildCvChoiceKeyboard() }
        );
    }

    if (data === 'cv_choice_manual') {
        await updateUserState(chatId, 'AWAITING_PORTALS');
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Configuración manual.' });
        return sendPortalSelection(bot, chatId, []);
    }

    if (data === 'cv_choice_upload') {
        await updateUserState(chatId, 'AWAITING_CV_UPLOAD');
        await bot.answerCallbackQuery(callbackQuery.id);
        const prompt = getPromptForField('cv_upload');
        return bot.sendMessage(chatId, prompt, { parse_mode: 'Markdown' });
    }

    // — Flujo de sugerencias IA post-CV —

    if (data === 'cv_skip_suggestions') {
        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: callbackQuery.message.message_id }).catch(() => {});
        await updateUserState(chatId, 'AWAITING_PORTALS');
        return sendPortalSelection(bot, chatId, []);
    }

    if (data === 'cv_suggest_improvements') {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Generando sugerencias...' });
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: callbackQuery.message.message_id }).catch(() => {});
        await bot.sendMessage(chatId, '⏳ Analizando tu perfil para sugerir mejoras...', { parse_mode: 'Markdown' });

        const draft = await getUserDraftConfig(chatId);
        let suggestions = null;
        try {
            suggestions = await generateRecommendations(draft);
            await savePendingSuggestion(chatId, suggestions);
        } catch (err) {
            console.error(`[Recomendaciones] Error para ${chatId}:`, err.message);
            return bot.sendMessage(
                chatId,
                '⚠️ No pude generar sugerencias en este momento. Puedes continuar con tu configuración actual.',
                { reply_markup: { inline_keyboard: [[{ text: '▶️ Continuar', callback_data: 'cv_skip_suggestions' }]] } }
            );
        }

        const origQ = (draft.queries  || []).join(', ') || 'ninguno';
        const origW = (draft.whitelist || []).join(', ') || 'ninguna';
        const sugQ  = suggestions.queries.join(', ')   || 'ninguno';
        const sugW  = suggestions.whitelist.join(', ') || 'ninguna';

        return bot.sendMessage(
            chatId,
            `💡 *Sugerencias de mejora:*\n\n` +
            `*Cargos buscados*\n` +
            `  Actual: \`${origQ}\`\n` +
            `  Sugerido: \`${sugQ}\`\n\n` +
            `*Palabras clave*\n` +
            `  Actual: \`${origW}\`\n` +
            `  Sugerido: \`${sugW}\`\n\n` +
            `_¿Quieres aplicar las sugerencias o mantener tu versión?_`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Aplicar sugerencias', callback_data: 'cv_apply_suggestions' }],
                        [{ text: '↩️ Mantener mi versión', callback_data: 'cv_reject_suggestions' }],
                    ]
                }
            }
        );
    }

    if (data === 'cv_apply_suggestions') {
        const suggestions = await getPendingSuggestion(chatId);
        if (suggestions) {
            if (suggestions.queries?.length)   await updateDraftFieldOnly(chatId, 'queries', suggestions.queries);
            if (suggestions.whitelist?.length) await updateDraftFieldOnly(chatId, 'whitelist', suggestions.whitelist);
            await clearPendingSuggestion(chatId);
        }
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Sugerencias aplicadas.' });
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: callbackQuery.message.message_id }).catch(() => {});
        await updateUserState(chatId, 'AWAITING_PORTALS');
        return sendPortalSelection(bot, chatId, []);
    }

    if (data === 'cv_reject_suggestions') {
        await clearPendingSuggestion(chatId);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Se mantiene tu versión original.' });
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: callbackQuery.message.message_id }).catch(() => {});
        await updateUserState(chatId, 'AWAITING_PORTALS');
        return sendPortalSelection(bot, chatId, []);
    }

    if (data === 'start_edit') {
        await activateUser(chatId, 0);
        await startUserConfigDraft(chatId);
        await updateUserState(chatId, 'AWAITING_CONFIRMATION');
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Abriendo edición...' });
        return bot.sendMessage(chatId, '✏️ Entraste en modo edición. Mientras no confirmes, tus alertas quedarán pausadas.', {
            parse_mode: 'Markdown',
        }).then(() => showEditMenu(bot, chatId));
    }

    if (data === 'wizard_edit_menu') {
        await bot.answerCallbackQuery(callbackQuery.id);
        return showEditMenu(bot, chatId);
    }

    if (data === 'wizard_summary') {
        await bot.answerCallbackQuery(callbackQuery.id);
        return showSummary(bot, chatId);
    }

    if (data === 'wizard_confirm') {
        try {
            await commitUserConfigDraft(chatId, { active: true });
            const config = await getUserConfig(chatId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Configuración activada.' });
            return bot.sendMessage(chatId, `🎉 *¡Configuración guardada!*\n\nTu bot ya quedó activo. A partir de ahora te enviaré alertas según este perfil:\n\n${formatUserConfig(config, { active: true })}\n\nPuedes revisar o cambiar cualquier cosa con /status o /edit.`, {
                parse_mode: 'Markdown',
            });
        } catch (err) {
            return bot.answerCallbackQuery(callbackQuery.id, {
                text: `No se pudo confirmar: ${err.message}`,
                show_alert: true,
            });
        }
    }

    if (data === 'wizard_cancel') {
        await discardUserConfigDraft(chatId);
        await updateUserState(chatId, 'IDLE');
        await bot.answerCallbackQuery(callbackQuery.id);
        return bot.sendMessage(chatId, 'Borrador descartado. Tu configuración activa no cambió. Usa /start para comenzar de nuevo o /status para revisar tu configuración.', {
            parse_mode: 'Markdown',
        });
    }

    if (data.startsWith('edit_field_')) {
        const field = data.replace('edit_field_', '');

        if (field === 'portals') {
            let config = await getUserDraftConfig(chatId);
            if (!config) {
                config = await startUserConfigDraft(chatId);
            }
            await updateUserState(chatId, 'EDITING_PORTALS');
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Edita tus portales.' });
            return bot.sendMessage(chatId, 'Selecciona los portales que quieres dejar activos y luego presiona Continuar.', {
                parse_mode: 'Markdown',
                reply_markup: buildPortalKeyboard(config?.portals || []),
            });
        }

        const stateMap = {
            scraperapi_key: 'EDITING_SCRAPERAPI_KEY',
            queries: 'EDITING_QUERIES',
            days_lookback: 'EDITING_DAYS_LOOKBACK',
            years_experience: 'EDITING_EXPERIENCE_YEARS',
            whitelist: 'EDITING_WHITELIST',
            blacklist_soft: 'EDITING_BLACKLIST_SOFT',
            blacklist_hard: 'EDITING_BLACKLIST_HARD',
        };

        const nextState = stateMap[field];
        if (!nextState) {
            return bot.answerCallbackQuery(callbackQuery.id);
        }

        await updateUserState(chatId, nextState);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Campo listo para edición.' });
        return promptField(bot, chatId, field, true);
    }

    if (data.startsWith('portal_toggle_')) {
        const portal = data.replace('portal_toggle_', '');
        const user = await getUser(chatId);
        let config = await getUserDraftConfig(chatId);
        if (!config) {
            config = await startUserConfigDraft(chatId);
        }
        if (!config) return bot.answerCallbackQuery(callbackQuery.id);

        let portals = config.portals || [];
        if (portals.includes(portal)) {
            portals = portals.filter(p => p !== portal); // Remover
        } else {
            portals.push(portal); // Agregar
        }

        await updateDraftFieldOnly(chatId, 'portals', portals);

        await bot.editMessageReplyMarkup(buildPortalKeyboard(portals), {
            chat_id: chatId,
            message_id: message.message_id
        });

        await updateUserState(chatId, user?.state === 'EDITING_PORTALS' ? 'EDITING_PORTALS' : 'AWAITING_PORTALS');
        return bot.answerCallbackQuery(callbackQuery.id);
    }

    if (data === 'portal_continue') {
        const user = await getUser(chatId);
        const config = await getUserDraftConfig(chatId);
        if (!config?.portals?.length) {
            return bot.answerCallbackQuery(callbackQuery.id, { text: "⚠️ Debes seleccionar al menos 1 portal.", show_alert: true });
        }

        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: chatId,
            message_id: message.message_id
        });

        await bot.answerCallbackQuery(callbackQuery.id);
        return continueAfterPortals(bot, chatId, user, config);
    }
}

module.exports = { handleCallbackQuery };
