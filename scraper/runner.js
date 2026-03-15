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
        ? new RegExp(`\\b${escaped}\\b`)
        : new RegExp(escaped);
    return regex.test(texto);
}

const EXP_REGEX = /(?:experiencia(?:\s+\w+){0,5}\s+(?:de\s+)?([3-9]|\d{2,})\s*\+?\s*años|(?:mínimo|al\s+menos|sobre)\s+([3-9]|\d{2,})\s*\+?\s*años|([3-9]|\d{2,})\+\s*años|([3-9]|\d{2,})\s*años\s+de\s+experiencia|([3-9]|\d{2,})\s*años\s+en\s+(?:cargos?|roles?|el\s+cargo))/;

function tieneExpExcesiva(texto) {
    return EXP_REGEX.test(texto);
}

function pasaFiltros(job, config, isTelegram = false) {
    const texto = `${job.title} ${job.description}`.toLowerCase();

    // 1. Experiencia Excesiva (descarte absoluto)
    if (tieneExpExcesiva(texto)) return false;

    // 2. Blacklist Hard (descarte inmediato con 1 hit)
    const hardHit = (config.blacklist_hard || []).find(p => matchPalabra(texto, p));
    if (hardHit) return false;

    // 3. Blacklist Soft (tolerancia hasta 2 hits)
    const softHits = (config.blacklist_soft || []).filter(p => matchPalabra(texto, p));
    if (softHits.length > SOFT_TOLERANCE) return false;

    // 4. Whitelist (solo si no es Telegram y hay lista configurada)
    if (!isTelegram && config.whitelist && config.whitelist.length > 0) {
        const coincide = config.whitelist.find(p => matchPalabra(texto, p));
        if (!coincide) return false; // Debe coincidir al menos 1
    }

    return true;
}

// Queries genéricas para los portales libres si no se extraen por usuario
const DEFAULT_QUERIES = ['desarrollador', 'programador', 'ingeniero informatico', 'fullstack', 'backend', 'frontend'];

let isScraping = false;

async function runScraperCycle(bot) {
    if (isScraping) {
        console.log("⚠️ Ciclo anterior aún en curso. Saltando este ciclo cron.");
        return;
    }
    isScraping = true;
    
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

        const timestamp = () => `[${new Date().toLocaleTimeString()}]`;

        // 1. Búsqueda Centralizada (Portales Libres)
        console.log(`${timestamp()} === DESCARGANDO OFERTAS CENTRALES ===`);
        
        let tgJobs = [];
        try { tgJobs = await scrapeTelegramChannel(); } catch(e) { console.error("Error scrapeando Telegram:", e.message); }
        
        // Asumiendo que internamente ya tienen Set para intra-run duplicates. Podemos inyectarlo o ignorarlo.
        // Aquí pasamos las default queries para barrer todo el mercado genérico sin sobrecargar las APIs
        let laborumJobs = [], gobJobs = [], trabajandoJobs = [];
        try { laborumJobs = await scrapeLaborum(DEFAULT_QUERIES, new Set()); } catch(e) { console.error(e.message); }
        try { gobJobs = await scrapeGetOnBoard(DEFAULT_QUERIES, new Set()); } catch(e) { console.error(e.message); }
        try { trabajandoJobs = await scrapeTrabajandog(DEFAULT_QUERIES, new Set()); } catch(e) { console.error(e.message); }

        // 2. Evaluamos y notificamos Usuario por Usuario
        for (const chatId of Object.keys(usersConfig)) {
            const conf = usersConfig[chatId];
            const portals = conf.portals || [];
            let userJobs = [];

            // A. Agregar los del pool central si el usuario quiere ese portal
            // El canal de Telegram viene siempre incluido para todos por la directriz original
            userJobs.push(...tgJobs);

            if (portals.includes('laborum')) userJobs.push(...laborumJobs);
            if (portals.includes('getonboard')) userJobs.push(...gobJobs);
            if (portals.includes('trabajando')) userJobs.push(...trabajandoJobs);

            // B. Scraper Particular: Computrabajo
            // Como requiere API KEY, se hace "onRequest" de las queries específicas de este usuario
            if (portals.includes('computrabajo') && conf.scraperapi_key && conf.queries && conf.queries.length > 0) {
                try {
                    console.log(`[BYOK] Scrapeando Computrabajo para el usuario ${chatId}...`);
                    const ctJobs = await scrapeComputrabajo(conf.queries, conf.scraperapi_key, new Set());
                    userJobs.push(...ctJobs);
                } catch(e) {
                    console.error(`Error CT Usuario ${chatId}: ${e.message}`);
                }
            }

            // C. Filtrado Personalizado y Envío
            let enviadas = 0, descartadas = 0;
            
            for (const job of userJobs) {
                const isTg = job.source === 'DCCEmpleoSinFiltro'; // u otro nombre asignado en tu scraper

                if (!pasaFiltros(job, conf, isTg)) {
                    descartadas++;
                    // Marcamos vista para no reprocesarla tontamente al siguiente ciclo
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
                }
            }

            if (enviadas > 0) {
                console.log(`--> Usuario ${chatId}: ${enviadas} enviadas, ${descartadas} filtradas.`);
            }
        }

        // 3. Mantenimiento DB
        await cleanOldSeenJobs();
        console.log(`${timestamp()} === CICLO FINALIZADO ===`);
        
    } finally {
        isScraping = false;
    }
}

module.exports = { runScraperCycle };
