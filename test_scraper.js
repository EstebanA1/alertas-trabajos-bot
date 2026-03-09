// Script de producción: ejecuta TODOS los scrapers una vez y termina.
// Usado por GitHub Actions (cron) y para pruebas manuales en local.

require('dotenv').config();
const { addJob, isJobSeen, getSeenJobsSet } = require('./db/database');
const { enviarAlerta } = require('./notifier/telegram');
const { scrapeTelegramChannel } = require('./scrapers/telegram_channel');
const { scrapeComputrabajo } = require('./scrapers/computrabajo');

// Cargar blacklist de palabras bloqueadas (no sensible, puede ir en el workflow directamente)
const BLACKLIST = (process.env.BLACKLIST_KEYWORDS || '')
    .split(',')
    .map(w => w.trim().toLowerCase())
    .filter(Boolean);

function esOfertaBloqueada(job) {
    if (BLACKLIST.length === 0) return false;
    const texto = `${job.title} ${job.description}`.toLowerCase();
    const match = BLACKLIST.find(p => texto.includes(p));
    if (match) {
        console.log(`🚫 Bloqueada por '${match}': ${job.title}`);
        return true;
    }
    return false;
}

async function runOnce() {
    console.log(`\n[${new Date().toLocaleTimeString()}] === INICIANDO RONDA DE BÚSQUEDA ===`);
    let allJobs = [];

    // Pre-cargar IDs vistos para optimizar llamadas a ScraperAPI en CT
    const seenJobIds = await getSeenJobsSet();

    // 1. Canal de Telegram
    const tgJobs = await scrapeTelegramChannel();
    allJobs = allJobs.concat(tgJobs);

    // 2. Computrabajo
    const ctJobs = await scrapeComputrabajo(seenJobIds);
    allJobs = allJobs.concat(ctJobs);

    // 3. Más scrapers se añadirán aquí...

    // 4. Aplicar blacklist, deduplicar y notificar
    let nuevas = 0;
    let bloqueadas = 0;

    for (const job of allJobs) {
        if (esOfertaBloqueada(job)) {
            bloqueadas++;
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

    console.log(`=== RONDA FINALIZADA: ${nuevas} nuevas enviadas, ${bloqueadas} bloqueadas ===\n`);
    process.exit(0); // Necesario para que GitHub Actions no quede colgado
}

runOnce();
