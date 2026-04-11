const { getActiveUsers, getUserConfig, isJobSeenByUser, addSeenJobForUser, cleanOldSeenJobs } = require('../db/database');
const { enviarAlertaParaUsuario } = require('../notifier/telegram');
const { scrapeTelegramChannel } = require('../scrapers/telegram_channel');
const { scrapeComputrabajo } = require('../scrapers/computrabajo');
const { scrapeLaborum } = require('../scrapers/laborum');
const { scrapeGetOnBoard } = require('../scrapers/getonboard');
const { scrapeTrabajandog } = require('../scrapers/trabajando');

const SOFT_TOLERANCE = 2;

function matchPalabra(texto, palabra) {
    const escaped = palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = /\w$/.test(palabra)
        ? new RegExp(`(?<![a-záéíóúüñA-ZÁÉÍÓÚÜÑ0-9])${escaped}(?![a-záéíóúüñA-ZÁÉÍÓÚÜÑ0-9])`, 'i')
        : new RegExp(escaped, 'i');
    return regex.test(texto);
}

const EXP_REGEX_CACHE = new Map();

function buildExpRegex(threshold) {
    if (EXP_REGEX_CACHE.has(threshold)) return EXP_REGEX_CACHE.get(threshold);
    // Coincide con n+ años donde n >= threshold
    const digitPattern = threshold < 10
        ? `([${threshold}-9]|\\d{2,})`
        : `(\\d{2,})`;
    const r = new RegExp(
        `(?:experiencia(?:\\s+\\w+){0,5}\\s+(?:de\\s+)?${digitPattern}\\s*\\+?\\s*años` +
        `|(?:mínimo|al\\s+menos|sobre)\\s+${digitPattern}\\s*\\+?\\s*años` +
        `|${digitPattern}\\+\\s*años` +
        `|${digitPattern}\\s*años\\s+de\\s+experiencia` +
        `|${digitPattern}\\s*años\\s+en\\s+(?:cargos?|roles?|el\\s+cargo))`,
        'i'
    );
    EXP_REGEX_CACHE.set(threshold, r);
    return r;
}

function tieneExpExcesiva(texto, threshold) {
    if (threshold == null) return false;
    return buildExpRegex(threshold).test(texto);
}

function pasaFiltros(job, config, isTelegram = false) {
    const texto = `${job.title ?? ''} ${job.description ?? ''}`.toLowerCase();

    // 1. Experiencia numérica directa (Trabajando.cl) — más fiable que el regex
    if (job.requiredYears != null && config.years_experience != null) {
        if (job.requiredYears > config.years_experience) return false;
    }

    // 2. Experiencia excesiva (regex en texto) — threshold = user.years_experience + 1
    const expThreshold = config.years_experience != null ? config.years_experience + 1 : null;
    if (tieneExpExcesiva(texto, expThreshold)) return false;

    // 3. Blacklist Hard (descarte inmediato con 1 hit)
    const hardHit = (config.blacklist_hard || []).find(p => matchPalabra(texto, p));
    if (hardHit) return false;

    // 4. Blacklist Soft (tolerancia hasta 2 hits)
    const softHits = (config.blacklist_soft || []).filter(p => matchPalabra(texto, p));
    if (softHits.length > SOFT_TOLERANCE) return false;

    // 5. Whitelist (solo si no es Telegram y hay lista configurada)
    if (!isTelegram && config.whitelist && config.whitelist.length > 0) {
        const coincide = config.whitelist.find(p => matchPalabra(texto, p));
        if (!coincide) return false;
    }

    return true;
}

// Queries genéricas para los portales libres si no se extraen por usuario
const DEFAULT_QUERIES = ['desarrollador', 'programador', 'ingeniero informatico', 'fullstack', 'backend', 'frontend'];

function buildSharedQueries(usersConfig) {
    const dynamic = Object.values(usersConfig)
        .flatMap((conf) => Array.isArray(conf?.queries) ? conf.queries : [])
        .map((q) => String(q).trim().toLowerCase())
        .filter(Boolean);

    const base = dynamic.length > 0 ? dynamic : DEFAULT_QUERIES;
    return [...new Set(base)];
}

function matchesQueries(job, queries = []) {
    if (!Array.isArray(queries) || queries.length === 0) return false;
    const texto = `${job.title ?? ''} ${job.description ?? ''}`.toLowerCase();
    return queries.some((query) => {
        const normalized = String(query || '').trim().toLowerCase();
        if (!normalized) return false;
        return texto.includes(normalized);
    });
}

let isScraping = false;
let runStats = { lastRun: null, durationMs: 0, lastRunStatus: 'idle', activeUsers: 0 };
const userLastCTScrape = new Map();

async function runScraperCycle(bot) {
    if (isScraping) {
        console.log("⚠️ Ciclo anterior aún en curso. Saltando este ciclo cron.");
        return;
    }
    isScraping = true;
    const startTime = Date.now();
    let jobsFoundCount = 0;
    runStats.lastRunStatus = 'running';
    
    try {
        const activeUsersDB = await getActiveUsers();
        if (!activeUsersDB || activeUsersDB.length === 0) {
            console.log("💤 No hay usuarios activos. Omitiendo scraping.");
            return;
        }

        const usersConfig = {};
        for (const u of activeUsersDB) {
            usersConfig[u.chat_id] = await getUserConfig(u.chat_id);
        }
        runStats.activeUsers = activeUsersDB.length;

        const sharedQueries = buildSharedQueries(usersConfig);

        // Calcular ventana máxima entre todos los usuarios (para scrapers centralizados)
        const maxAgeDays = Math.max(...Object.values(usersConfig).map(c => c.days_lookback || 1));

        const timestamp = () => `[${new Date().toLocaleTimeString()}]`;

        // 1. Búsqueda Centralizada (Portales Libres)
        console.log(`${timestamp()} === DESCARGANDO OFERTAS CENTRALES ===`);
        
        let tgJobs = [];
        try { tgJobs = await scrapeTelegramChannel(maxAgeDays); } catch(e) { console.error("Error scrapeando Telegram:", e.message); }
        
        let laborumJobs = [], gobJobs = [], trabajandoJobs = [];
        try { laborumJobs = await scrapeLaborum(sharedQueries, new Set(), maxAgeDays); } catch(e) { console.error(e.message); }
        try { gobJobs = await scrapeGetOnBoard(sharedQueries, new Set(), maxAgeDays); } catch(e) { console.error(e.message); }
        try { trabajandoJobs = await scrapeTrabajandog(sharedQueries, new Set(), maxAgeDays); } catch(e) { console.error(e.message); }

        jobsFoundCount = tgJobs.length + laborumJobs.length + gobJobs.length + trabajandoJobs.length;

        // 2. Evaluamos y notificamos Usuario por Usuario
        for (const chatId of Object.keys(usersConfig)) {
            const conf = usersConfig[chatId] || {};
            const portals = conf.portals || [];
            let userJobs = [];

            // A. Agregar los del pool central si el usuario quiere ese portal
            if (portals.includes('telegram')) userJobs.push(...tgJobs);

            if (portals.includes('laborum')) userJobs.push(...laborumJobs);
            if (portals.includes('getonboard')) userJobs.push(...gobJobs);
            if (portals.includes('trabajando')) userJobs.push(...trabajandoJobs);

            // B. Scraper Particular: Computrabajo
            // Como requiere API KEY, se hace "onRequest". Limitado a 1 vez por hora (3600000 ms) por usuario para ahorrar ScraperAPI credits.
            if (portals.includes('computrabajo') && conf.scraperapi_key && conf.queries && conf.queries.length > 0) {
                const lastCT = userLastCTScrape.get(chatId) || 0;
                if (Date.now() - lastCT >= 3600000) {
                    try {
                        console.log(`[BYOK] Scrapeando Computrabajo para el usuario ${chatId}...`);
                        const ctJobs = await scrapeComputrabajo(conf.queries, conf.scraperapi_key, new Set(), conf.days_lookback || 1);
                        userJobs.push(...ctJobs);
                        userLastCTScrape.set(chatId, Date.now());
                    } catch(e) {
                        console.error(`Error CT Usuario ${chatId}: ${e.message}`);
                    }
                } else {
                    const minsLeft = Math.ceil((3600000 - (Date.now() - lastCT)) / 60000);
                    console.log(`[BYOK] Saltando Computrabajo para ${chatId} (En cooldown por ${minsLeft} min)`);
                }
            }

            // C. Filtrado Personalizado y Envío
            let enviadas = 0, descartadasFiltro = 0, descartadasQuery = 0, descartadasFecha = 0, repetidas = 0;
            const userQueries = Array.isArray(conf.queries) ? conf.queries : [];
            
            for (const job of userJobs) {
                const isTg = String(job.source || '').toLowerCase().includes('telegram');

                if (!isTg && !matchesQueries(job, userQueries)) {
                    descartadasQuery++;
                    continue;
                }

                // Filtro de ventana de tiempo per-user
                const userWindow = (conf.days_lookback || 1) * 24 * 60 * 60 * 1000;
                if (job.publishedAt && job.publishedAt < Date.now() - userWindow) {
                    descartadasFecha++;
                    continue;
                }

                if (!pasaFiltros(job, conf, isTg)) {
                    descartadasFiltro++;
                    await addSeenJobForUser(chatId, job.id);
                    continue;
                }

                const alreadySeen = await isJobSeenByUser(chatId, job.id);
                if (!alreadySeen) {
                    const inserted = await addSeenJobForUser(chatId, job.id);
                    if (inserted) {
                        await enviarAlertaParaUsuario(bot, chatId, job);
                        enviadas++;
                        await new Promise(r => setTimeout(r, 600)); // anti-spam
                    }
                } else {
                    repetidas++;
                }
            }

            console.log(`--> Usuario ${chatId}: ${enviadas} enviadas | Descartadas: ${descartadasQuery} (query), ${descartadasFiltro} (filtros), ${descartadasFecha} (fecha), ${repetidas} (ya vistas)`);
        }

        // 3. Mantenimiento DB
        await cleanOldSeenJobs();
        console.log(`${timestamp()} === CICLO FINALIZADO ===`);
        
    } finally {
        isScraping = false;
        runStats.lastRun = new Date();
        runStats.durationMs = Date.now() - startTime;
        runStats.jobsFound = jobsFoundCount;
    }
}

function getRunStats() {
    return runStats;
}

module.exports = { runScraperCycle, getRunStats };
