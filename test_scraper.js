// Script de producción: ejecuta TODOS los scrapers una vez y termina.
// Usado por GitHub Actions (cron) y para pruebas manuales en local.

require('dotenv').config();
const config = require('./config');
const { addJob, isJobSeen, getSeenJobsSet } = require('./db/database');
const { enviarAlerta } = require('./notifier/telegram');
const { scrapeTelegramChannel } = require('./scrapers/telegram_channel');
const { scrapeComputrabajo } = require('./scrapers/computrabajo');

// --- Filtros de keywords ---
// WHITELIST y BLACKLIST: se leen del entorno o de config.js como fallback
const WHITELIST = (process.env.WHITELIST_KEYWORDS || config.WHITELIST_KEYWORDS)
    .split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

const BLACKLIST = (process.env.BLACKLIST_KEYWORDS || config.BLACKLIST_KEYWORDS)
    .split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

function pasaFiltros(job, aplicarWhitelist = false) {
    const texto = `${job.title} ${job.description}`.toLowerCase();

    // 1. Blacklist (siempre aplica)
    const bloqueada = BLACKLIST.find(p => texto.includes(p));
    if (bloqueada) {
        console.log(`🚫 Bloqueada ['${bloqueada}']: ${job.title}`);
        return false;
    }

    // 2. Whitelist (solo para portales de empleo, no para Telegram)
    if (aplicarWhitelist && WHITELIST.length > 0) {
        const coincide = WHITELIST.find(p => texto.includes(p));
        if (!coincide) {
            console.log(`⏭️  Sin tecnologías de interés: ${job.title}`);
            return false;
        }
    }

    return true;
}

async function runOnce() {
    console.log(`\n[${new Date().toLocaleTimeString()}] === INICIANDO RONDA DE BÚSQUEDA ===`);
    const seenJobIds = await getSeenJobsSet();

    // ── 1. Canal de Telegram (sin whitelist: queremos todo lo del canal) ──
    const tgJobs = await scrapeTelegramChannel();

    // ── 2. Computrabajo (con whitelist: filtra por tecnologías de interés) ──
    const ctJobs = await scrapeComputrabajo(seenJobIds);

    // ── 3. Más scrapers se añadirán aquí ──

    let nuevas = 0;
    let descartadas = 0;

    // Procesar grupos con su configuración de whitelist correspondiente
    const grupos = [
        { jobs: tgJobs,  whitelist: false },  // Telegram: sin whitelist
        { jobs: ctJobs,  whitelist: true  },  // CT: con whitelist (más ruido)
    ];

    for (const { jobs, whitelist } of grupos) {
        for (const job of jobs) {
            if (!pasaFiltros(job, whitelist)) {
                descartadas++;
                await addJob(job.id); // Marcar como visto para no reprocesar
                continue;
            }
            if (!(await isJobSeen(job.id))) {
                if (await addJob(job.id)) {
                    nuevas++;
                    await enviarAlerta(job);
                    await new Promise(r => setTimeout(r, 500));
                }
            }
        }
    }

    console.log(`=== RONDA FINALIZADA: ${nuevas} enviadas, ${descartadas} descartadas ===\n`);
    process.exit(0);
}

runOnce();
