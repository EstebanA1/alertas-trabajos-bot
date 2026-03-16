const PORTAL_DEFINITIONS = [
    { id: 'telegram', label: 'Canal de Telegram' },
    { id: 'getonboard', label: 'GetOnBoard' },
    { id: 'laborum', label: 'Laborum' },
    { id: 'trabajando', label: 'Trabajando' },
    { id: 'computrabajo', label: 'Computrabajo', requiresKey: true },
];

const EDITABLE_FIELDS = [
    { id: 'portals', label: 'Portales' },
    { id: 'queries', label: 'Cargos / queries' },
    { id: 'days_lookback', label: 'Ventana de tiempo' },
    { id: 'years_experience', label: 'Años de experiencia' },
    { id: 'whitelist', label: 'Whitelist' },
    { id: 'blacklist_soft', label: 'Blacklist soft' },
    { id: 'blacklist_hard', label: 'Blacklist hard' },
    { id: 'scraperapi_key', label: 'ScraperAPI key', requiresPortal: 'computrabajo' },
];

function formatList(items, emptyLabel = 'Ninguno') {
    return Array.isArray(items) && items.length > 0 ? items.join(', ') : emptyLabel;
}

function hasConfiguredData(config) {
    if (!config) return false;

    return Boolean(
        (config.portals && config.portals.length > 0) ||
        (config.queries && config.queries.length > 0) ||
        (config.whitelist && config.whitelist.length > 0) ||
        (config.blacklist_soft && config.blacklist_soft.length > 0) ||
        (config.blacklist_hard && config.blacklist_hard.length > 0) ||
        config.scraperapi_key
    );
}

function buildPortalKeyboard(selectedPortals = []) {
    const keyboard = PORTAL_DEFINITIONS.map((portal) => {
        const selected = selectedPortals.includes(portal.id) ? '✅' : '⬜';
        const suffix = portal.requiresKey ? ' (requiere key)' : '';
        return [{
            text: `${selected} ${portal.label}${suffix}`,
            callback_data: `portal_toggle_${portal.id}`,
        }];
    });

    keyboard.push([{ text: '⏭️ Continuar', callback_data: 'portal_continue' }]);
    keyboard.push([{ text: '↩️ Cancelar / volver', callback_data: 'wizard_cancel' }]);

    return { inline_keyboard: keyboard };
}

function buildStartMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '✏️ Editar configuración', callback_data: 'start_edit' }],
            [{ text: '🔄 Reiniciar desde cero', callback_data: 'start_reset' }],
            [{ text: '📋 Ver resumen actual', callback_data: 'wizard_summary' }],
        ],
    };
}

function buildSummaryKeyboard(config) {
    const rows = [
        [{ text: '✅ Confirmar y activar', callback_data: 'wizard_confirm' }],
        [{ text: '✏️ Editar configuración', callback_data: 'wizard_edit_menu' }],
        [{ text: '🔄 Reiniciar', callback_data: 'start_reset' }],
    ];

    if (config?.portals?.includes('computrabajo') && !config.scraperapi_key) {
        rows.unshift([{ text: '🔑 Agregar ScraperAPI key', callback_data: 'edit_field_scraperapi_key' }]);
    }

    return { inline_keyboard: rows };
}

function buildEditMenuKeyboard(config) {
    const rows = EDITABLE_FIELDS
        .filter((field) => !field.requiresPortal || config?.portals?.includes(field.requiresPortal))
        .map((field) => [{
            text: `✏️ ${field.label}`,
            callback_data: `edit_field_${field.id}`,
        }]);

    rows.push([{ text: '📋 Volver al resumen', callback_data: 'wizard_summary' }]);
    rows.push([{ text: '🔄 Reiniciar', callback_data: 'start_reset' }]);

    return { inline_keyboard: rows };
}

function formatUserConfig(config, { active = false } = {}) {
    const expLabel = config.years_experience != null
        ? `${config.years_experience} año(s)`
        : 'Sin filtro';
    return `⚙️ *Tu configuración actual*\n\n` +
        `*Estado*: ${active ? '✅ Activo' : '🟡 En configuración'}\n` +
        `*Portales*: ${formatList(config.portals)}\n` +
        `*Cargos / queries*: ${formatList(config.queries, 'Sin definir')}\n` +
        `*Ventana de tiempo*: ${config.days_lookback ?? 1} día(s)\n` +
        `*Experiencia máx. requerida*: ${expLabel}\n` +
        `*Whitelist*: ${formatList(config.whitelist)}\n` +
        `*Blacklist soft*: ${formatList(config.blacklist_soft)}\n` +
        `*Blacklist hard*: ${formatList(config.blacklist_hard)}\n` +
        `*ScraperAPI key*: ${config.portals?.includes('computrabajo') ? (config.scraperapi_key ? '✅ Guardada' : '❌ Falta') : 'No requerida'}`;
}

function normalizeCsvInput(text) {
    return [...new Set(
        String(text || '')
            .split(',')
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean)
    )];
}

function isNoneKeyword(text) {
    const normalized = String(text || '').trim().toLowerCase();
    return normalized === 'ninguna' || normalized === 'ninguno';
}

function getPromptForField(fieldId) {
    switch (fieldId) {
        case 'queries':
            return `*Paso 2: ¿Qué cargos buscas?*\nEscribe los puestos separados por comas.\n\n_Ejemplo:_ \`desarrollador, programador, analista qa\``;
        case 'days_lookback':
            return `*Paso 3: Ventana de tiempo*\n¿Cuántos días atrás quieres revisar las ofertas? (1-30)\n\nEn el primer ciclo se enviarán las ofertas de ese período. Luego solo recibirrás novedades.\n\n_Ejemplo:_ \`2\` para solo las últimas 48 horas.`;
        case 'years_experience':
            return `*Paso 4: ¿Cuántos años de experiencia tienes?*\nSi me indicas tu experiencia, filtraré ofertas que pidan más años de los que tienes.\n\n_Ejemplo:_ \`1\` para filtrar ofertas que pidan más de 1 año.\n_Escribe_ \`ninguno\` _si no quieres este filtro._`;
        case 'whitelist':
            return `*Paso 5: Tecnologías Requeridas (Whitelist)*\nLa oferta debe contener al menos una de estas palabras clave para enviarte.\n\n_Ejemplo:_ \`javascript, react, python, sql\`\n_(Si quieres recibir sin este filtro, escribe 'ninguna')_`;
        case 'blacklist_soft':
            return `*Paso 6: Tecnologías no manejadas (Blacklist soft)*\nDescartaré la oferta si exige demasiadas tecnologías de esta lista.\n\n_Ejemplo:_ \`java, php, ruby, cobol\`\n_(O escribe 'ninguna')_`;
        case 'blacklist_hard':
            return `*Paso 7: Trabajos incompatibles (Blacklist hard)*\nDescartaré inmediatamente una oferta si contiene cualquiera de estas palabras.\n\n_Ejemplo:_ \`vendedor, call center, soporte tecnico\`\n_(O escribe 'ninguna')_`;
        case 'scraperapi_key':
            return `🔑 *Computrabajo requiere ScraperAPI*\n\nPara evitar bloqueos, debes crear una key en [ScraperAPI](https://www.scraperapi.com/) y enviármela aquí.\n\nCuando la reciba, la asociaré a tu chat para usar Computrabajo solo en tus búsquedas.`;
        default:
            return '';
    }
}

module.exports = {
    PORTAL_DEFINITIONS,
    buildPortalKeyboard,
    buildStartMenuKeyboard,
    buildSummaryKeyboard,
    buildEditMenuKeyboard,
    formatUserConfig,
    hasConfiguredData,
    normalizeCsvInput,
    isNoneKeyword,
    getPromptForField,
};