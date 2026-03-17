const PORTAL_DEFINITIONS = [
    { id: 'telegram', label: 'DCCEmpleoSinFiltro · Canal Telegram  ⚠️ Principalmente ofertas TI' },
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
        `*Portales activos*: ${formatList(config.portals)}\n` +
        `*Cargos buscados*: ${formatList(config.queries, 'Sin definir')}\n` +
        `*Antigüedad máx. de ofertas*: ${config.days_lookback ?? 1} día(s)\n` +
        `*Experiencia máx. requerida*: ${expLabel}\n` +
        `*Palabras obligatorias* (la oferta debe incluir al menos una): ${formatList(config.whitelist)}\n` +
        `*Palabras a evitar* (se tolera hasta 2): ${formatList(config.blacklist_soft)}\n` +
        `*Palabras bloqueantes* (descarte inmediato): ${formatList(config.blacklist_hard)}\n` +
        `*Clave Computrabajo*: ${config.portals?.includes('computrabajo') ? (config.scraperapi_key ? '✅ Guardada' : '❌ Falta') : 'No requerida'}`;
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
            return `*Paso 2: ¿Qué cargos o tipos de trabajo buscas?*\n💡 _Escribe los nombres de los puestos que te interesan, separados por comas. El bot solo te avisará de ofertas que coincidan con alguno de estos términos._\n\n_Ejemplo:_ \`contador, analista financiero, auditor\`\n_Ejemplo:_ \`diseñador grafico, ux, community manager\``;
        case 'days_lookback':
            return `*Paso 3: ¿Qué tan recientes deben ser las ofertas?*\n💡 _Indica cuántos días atrás quieres que el bot revise. En tu primer uso recibirás todo lo de ese período; después solo recibirás novedades._\n\nIngresa un número entre 1 y 30.\n\n_Ejemplo:_ \`3\` para recibir solo ofertas de los últimos 3 días.`;
        case 'years_experience':
            return `*Paso 4: ¿Cuántos años de experiencia tienes en tu área?*\n💡 _Si lo indicas, el bot filtrará automáticamente ofertas que pidan más años de experiencia de los que tienes, para que no recibas cargos fuera de tu alcance._\n\n_Ejemplo:_ \`2\` si tienes 2 años de experiencia.\n_Escribe_ \`ninguno\` _si no quieres este filtro._`;
        case 'whitelist':
            return `*Paso 5: Palabras que la oferta DEBE mencionar*\n💡 _Si configuras esto, el bot solo te enviará ofertas que contengan al menos una de estas palabras. Sirve para asegurarte de recibir solo lo que es relevante para tu perfil._\n\nEscribe las palabras separadas por comas.\n\n_Ejemplo:_ \`recursos humanos, reclutamiento, selección\`\n_Ejemplo:_ \`excel, contabilidad, tributario\`\n_(Si no quieres este filtro y prefieres recibir todo, escribe_ \`ninguna\`_)_`;
        case 'blacklist_soft':
            return `*Paso 6: Palabras que prefieres evitar*\n💡 _Si una oferta menciona demasiadas de estas palabras o conceptos, el bot la descartará. Útil para filtrar cargos que no van con tu perfil aunque tengan palabras similares._\n\nEscribe las palabras separadas por comas.\n\n_Ejemplo:_ \`ventas, comisión, cuotas\`\n_Ejemplo:_ \`trabajo físico, turno de noche\`\n_(Si no quieres este filtro, escribe_ \`ninguna\`_)_`;
        case 'blacklist_hard':
            return `*Paso 7: Palabras que NUNCA quieres ver*\n💡 _Si una oferta incluye aunque sea una de estas palabras, el bot la bloqueará inmediatamente. Úsalo para descartar tipos de trabajo que definitivamente no te interesan._\n\nEscribe las palabras separadas por comas.\n\n_Ejemplo:_ \`call center, vendedor puerta a puerta, multinivel\`\n_Ejemplo:_ \`prácticas, sin remuneración\`\n_(Si no quieres este filtro, escribe_ \`ninguna\`_)_`;
        case 'scraperapi_key':
            return `🔑 *Computrabajo requiere una clave de acceso (ScraperAPI)*

Para poder buscar en Computrabajo, el bot necesita una clave personal gratuita. Sigue estos pasos:

*1.* Abre este enlace en tu navegador:
👉 https://www.scraperapi.com/

*2.* Haz clic en *"Start for free"* y crea una cuenta (puedes usar tu correo de Google).

*3.* Una vez dentro, verás tu *API Key* en la pantalla principal. Cópiala.

*4.* Vuelve aquí y pega la clave directamente en este chat (sin texto adicional).

El plan gratuito es suficiente para uso personal. ✅`;
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