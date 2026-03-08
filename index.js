const cron = require('node-cron');
const { addJob, isJobSeen } = require('./db/database');
const { enviarAlerta } = require('./notifier/telegram');
const { scrapeTelegramChannel } = require('./scrapers/telegram_channel');
const { scrapeComputrabajo } = require('./scrapers/computrabajo');

console.log("🤖 AlertasTrabajos Bot Iniciado. Esperando crons...");

// Función principal que orquesta todo
async function runAllScrapers() {
    console.log(`\n[${new Date().toLocaleTimeString()}] === INICIANDO RONDA DE BÚSQUEDA ===`);
    
    let allJobs = [];
    
    // 1. Scraping Telegram Channel
    const tgJobs = await scrapeTelegramChannel();
    allJobs = allJobs.concat(tgJobs);

    // 2. Scraping Computrabajo
    const ctJobs = await scrapeComputrabajo();
    allJobs = allJobs.concat(ctJobs);

    // Más scrapers se añadirán aquí...

    // 3. Filtrar y notificar
    let nuevas = 0;
    for (const job of allJobs) {
        if (!(await isJobSeen(job.id))) {
            if (await addJob(job.id)) {
                nuevas++;
                await enviarAlerta(job);
                // Pausar medio segundo para evitar rate limit de Telegram
                await new Promise(resolve => setTimeout(resolve, 500)); 
            }
        }
    }

    console.log(`=== RONDA FINALIZADA: ${nuevas} ofertas nuevas enviadas ===\n`);
}

// Ejecutar una vez al inicio para probar
runAllScrapers();

// Programar para que corra cada 15 minutos
cron.schedule('*/15 * * * *', () => {
    runAllScrapers();
});
