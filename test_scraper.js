require('dotenv').config();
const config = require('./config');
const { addJob, isJobSeen, getSeenJobsSet } = require('./db/database');
const { enviarAlerta } = require('./notifier/telegram');
const { scrapeTelegramChannel } = require('./scrapers/telegram_channel');
const { scrapeComputrabajo } = require('./scrapers/computrabajo');
const { scrapeLaborum } = require('./scrapers/laborum');
const { scrapeGetOnBoard } = require('./scrapers/getonboard');

const WHITELIST = (process.env.WHITELIST_KEYWORDS || config.WHITELIST_KEYWORDS)
    .split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

const BLACKLIST = (process.env.BLACKLIST_KEYWORDS || config.BLACKLIST_KEYWORDS)
    .split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

function pasaFiltros(job, aplicarWhitelist = false) {
    const texto = `${job.title} ${job.description}`.toLowerCase();

    const bloqueada = BLACKLIST.find(p => texto.includes(p));
    if (bloqueada) {
        console.log(`🚫 Bloqueada ['${bloqueada}']: ${job.title}`);
        return false;
    }

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

    const tgJobs      = await scrapeTelegramChannel();
    const ctJobs      = await scrapeComputrabajo(seenJobIds);
    const laborumJobs = await scrapeLaborum(seenJobIds);
    const gobJobs     = await scrapeGetOnBoard(seenJobIds);

    let nuevas = 0;
    let descartadas = 0;

    const grupos = [
        { jobs: tgJobs,       whitelist: false },
        { jobs: ctJobs,       whitelist: true  },
        { jobs: laborumJobs,  whitelist: true  },
        { jobs: gobJobs,      whitelist: true  },
    ];

    for (const { jobs, whitelist } of grupos) {
        for (const job of jobs) {
            if (!pasaFiltros(job, whitelist)) {
                descartadas++;
                await addJob(job.id);
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
