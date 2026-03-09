const cron = require('node-cron');
const { addJob, isJobSeen } = require('./db/database');
const { enviarAlerta } = require('./notifier/telegram');
const { scrapeTelegramChannel } = require('./scrapers/telegram_channel');
const { scrapeComputrabajo } = require('./scrapers/computrabajo');

console.log("🤖 AlertasTrabajos Bot Iniciado. Esperando crons...");

// Carga las palabras bloqueadas desde el .env y comprueba si una oferta las contiene
const BLACKLIST = (process.env.BLACKLIST_KEYWORDS || '')
    .split(',')
    .map(w => w.trim().toLowerCase())
    .filter(Boolean);

function esOfertaBloqueada(job) {
    if (BLACKLIST.length === 0) return false;
    const texto = `${job.title} ${job.description}`.toLowerCase();
    const palabraEncontrada = BLACKLIST.find(palabra => texto.includes(palabra));
    if (palabraEncontrada) {
        console.log(`🚫 Oferta bloqueada por palabra '${palabraEncontrada}': ${job.title}`);
        return true;
    }
    return false;
}

// Función principal que orquesta todo
async function runAllScrapers() {
    console.log(`\n[${new Date().toLocaleTimeString()}] === INICIANDO RONDA DE BÚSQUEDA ===`);

    let allJobs = [];

    // Pre-cargar IDs ya vistos para que el scraper de CT no visite páginas de detalle redundantes
    const { getSeenJobsSet } = require('./db/database');
    const seenJobIds = await getSeenJobsSet();

    // 1. Scraping Telegram Channel (no necesita seenIds, es texto completo en la misma página)
    const tgJobs = await scrapeTelegramChannel();
    allJobs = allJobs.concat(tgJobs);

    // 2. Scraping Computrabajo (pasa seenIds para optimizar créditos de ScraperAPI)
    const ctJobs = await scrapeComputrabajo(seenJobIds);
    allJobs = allJobs.concat(ctJobs);

    // Más scrapers se añadirán aquí...

    // 3. Filtrar por blacklist y notificar
    let nuevas = 0;
    let bloqueadas = 0;
    for (const job of allJobs) {
        if (esOfertaBloqueada(job)) {
            bloqueadas++;
            // Igual la marcamos como vista para no reprocesarla en el futuro
            await addJob(job.id);
            continue;
        }
        if (!(await isJobSeen(job.id))) {
            if (await addJob(job.id)) {
                nuevas++;
                await enviarAlerta(job);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    }

    console.log(`=== RONDA FINALIZADA: ${nuevas} nuevas enviadas, ${bloqueadas} bloqueadas por blacklist ===\n`);
}

// Ejecutar una vez al inicio para probar
runAllScrapers();

// Programar para que corra cada 5 minutos
cron.schedule('*/5 * * * *', () => {
    runAllScrapers();
});
