const { getUser, updateUserState, getUserConfig, updateUserConfig, activateUser } = require('../../db/database');

async function handleMessage(bot, msg) {
    const chatId = msg.chat.id.toString();
    const text = msg.text?.trim();

    // Ignorar comandos
    if (!text || text.startsWith('/')) return;

    const user = await getUser(chatId);
    if (!user) return; // Si no ha dado /start

    switch (user.state) {
        case 'AWAITING_SCRAPERAPI_KEY':
            await updateUserConfig(chatId, 'scraperapi_key', text);
            await updateUserState(chatId, 'AWAITING_QUERIES');
            bot.sendMessage(chatId, `✅ *API Key guardada.*\n\n*Paso 2: ¿Qué cargos buscas?*\nEscribe los puestos separados por comas.\n\n_Ejemplo:_ \`desarrollador, programador, analista qa\``, { parse_mode: 'Markdown' });
            break;

        case 'AWAITING_QUERIES':
            const queries = text.split(',').map(q => q.trim()).filter(Boolean);
            await updateUserConfig(chatId, 'queries', queries);
            await updateUserState(chatId, 'AWAITING_WHITELIST');
            bot.sendMessage(chatId, `✅ *Cargos guardados.*\n\n*Paso 3: Tecnologías Requeridas (Whitelist)*\nLa oferta DEBE contener al menos UNA de estas palabras clave para que te la envíe.\n\n_Ejemplo:_ \`javascript, react, python, sql\`\n_(Si quieres recibir todas las ofertas sin filtro, escribe 'ninguna')_`, { parse_mode: 'Markdown' });
            break;

        case 'AWAITING_WHITELIST':
            let whitelist = [];
            if (text.toLowerCase() !== 'ninguna' && text.toLowerCase() !== 'ninguno') {
                whitelist = text.split(',').map(q => q.trim().toLowerCase()).filter(Boolean);
            }
            await updateUserConfig(chatId, 'whitelist', whitelist);
            await updateUserState(chatId, 'AWAITING_BLACKLIST_SOFT');
            bot.sendMessage(chatId, `✅ *Requisitos guardados.*\n\n*Paso 4: Tecnologías NO manejadas (Blacklist Soft)*\nDescarta la oferta si exige MUCHAS tecnologías que no conoces. Te descartará si encuentra más de 2 palabras de tu lista.\n\n_Ejemplo:_ \`java, php, ruby, cobol, angular\`\n_(O escribe 'ninguna')_`, { parse_mode: 'Markdown' });
            break;

        case 'AWAITING_BLACKLIST_SOFT':
            let bl_soft = [];
            if (text.toLowerCase() !== 'ninguna' && text.toLowerCase() !== 'ninguno') {
                bl_soft = text.split(',').map(q => q.trim().toLowerCase()).filter(Boolean);
            }
            await updateUserConfig(chatId, 'blacklist_soft', bl_soft);
            await updateUserState(chatId, 'AWAITING_BLACKLIST_HARD');
            bot.sendMessage(chatId, `✅ *Descartes suaves guardados.*\n\n*Paso 5: Trabajos Incompatibles (Blacklist Hard)*\nDescartaré INMEDIATAMENTE la oferta si veo tan solo UNA de estas palabras (ideal para roles ajenos).\n\n_Ejemplo:_ \`vendedor, call center, soporte tecnico, junior (si eres senior)\`\n_(O escribe 'ninguna')_`, { parse_mode: 'Markdown' });
            break;

        case 'AWAITING_BLACKLIST_HARD':
            let bl_hard = [];
            if (text.toLowerCase() !== 'ninguna' && text.toLowerCase() !== 'ninguno') {
                bl_hard = text.split(',').map(q => q.trim().toLowerCase()).filter(Boolean);
            }
            await updateUserConfig(chatId, 'blacklist_hard', bl_hard);
            
            // Finalizar Wizard
            await activateUser(chatId, 1);
            await updateUserState(chatId, 'ACTIVE');

            bot.sendMessage(chatId, `🎉 *¡Configuración completa!* El bot está ACTIVO.\n\nEstaré revisando los portales cada 5 minutos y enviándote todo lo que pase tus filtros.\n\nPuedes ver tu configuración en cualquier momento escribiendo /config`, { parse_mode: 'Markdown' });
            break;
            
        case 'ACTIVE':
            // Opcional: ignorar mensajes de texto aleatorios si ya está activo
            break;
    }
}

module.exports = { handleMessage };
