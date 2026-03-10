require('dotenv').config();
const config = require('./config');
const { addJob, isJobSeen, getSeenJobsSet } = require('./db/database');
const { enviarAlerta } = require('./notifier/telegram');
const { scrapeTelegramChannel } = require('./scrapers/telegram_channel');
const { scrapeComputrabajo } = require('./scrapers/computrabajo');
const { scrapeLaborum } = require('./scrapers/laborum');
const { scrapeGetOnBoard } = require('./scrapers/getonboard');
const { scrapeTrabajandog } = require('./scrapers/trabajando');

const WHITELIST = (process.env.WHITELIST_KEYWORDS || config.WHITELIST_KEYWORDS)
    .split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

// Hard: descarte inmediato con 1 sola coincidencia (roles no-IT, experiencia excesiva)
const BLACKLIST_HARD = (process.env.BLACKLIST_HARD || config.BLACKLIST_HARD)
    .split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

// Soft: tecnologías no manejadas — se tolera hasta este número de hits
const BLACKLIST_SOFT = (process.env.BLACKLIST_SOFT || config.BLACKLIST_SOFT)
    .split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

const SOFT_TOLERANCE = 2;

function matchPalabra(texto, palabra) {
    const escaped = palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = /\w$/.test(palabra)
        ? new RegExp(`\\b${escaped}\\b`)
        : new RegExp(escaped);
    return regex.test(texto);
}

// Acepta: "3+ años", "3 años de experiencia", "experiencia de 3 años", "mínimo 3 años", "3 años en cargos/roles"
// "trayectoria" excluida: las empresas la usan para su propia antigüedad ("60 años de trayectoria")
const EXP_REGEX = /(?:experiencia(?:\s+\w+){0,5}\s+(?:de\s+)?([3-9]|\d{2,})\s*\+?\s*años|(?:mínimo|al\s+menos|sobre)\s+([3-9]|\d{2,})\s*\+?\s*años|([3-9]|\d{2,})\+\s*años|([3-9]|\d{2,})\s*años\s+de\s+experiencia|([3-9]|\d{2,})\s*años\s+en\s+(?:cargos?|roles?|el\s+cargo))/;

function tieneExpExcesiva(texto) {
    const match = texto.match(EXP_REGEX);
    return match !== null;
}

function pasaFiltros(job, aplicarWhitelist = false) {
    const texto = `${job.title} ${job.description}`.toLowerCase();

    if (tieneExpExcesiva(texto)) {
        console.log(`🚫 Bloqueada [experiencia >= 3 años]: ${job.title}`);
        return false;
    }

    const hardHit = BLACKLIST_HARD.find(p => matchPalabra(texto, p));
    if (hardHit) {
        console.log(`🚫 Bloqueada ['${hardHit}']: ${job.title}`);
        return false;
    }

    const softHits = BLACKLIST_SOFT.filter(p => matchPalabra(texto, p));
    if (softHits.length > SOFT_TOLERANCE) {
        console.log(`🚫 Bloqueada [${softHits.join(', ')}]: ${job.title}`);
        return false;
    }
    if (softHits.length > 0) {
        console.log(`⚠️  ${softHits.length} tech(s) ajena(s) [${softHits.join(', ')}]: ${job.title}`);
    }

    if (aplicarWhitelist && WHITELIST.length > 0) {
        const coincide = WHITELIST.find(p => matchPalabra(texto, p));
        if (!coincide) {
            console.log(`⏭️  Sin tecnologías de interés: ${job.title}`);
            return false;
        }
    }

    return true;
}

async function runOnce() {
    const seenJobIds = await getSeenJobsSet();

    const timestamp = () => `[${new Date().toLocaleTimeString()}]`;

    console.log(`${timestamp()} === REVISANDO CANAL DE TELEGRAM ===`);
    const tgJobs = await scrapeTelegramChannel();

    console.log(`${timestamp()}\n === REVISANDO COMPUTRABAJO ===`);
    const ctJobs = await scrapeComputrabajo(seenJobIds);

    console.log(`${timestamp()}\n === REVISANDO LABORUM ===`);
    const laborumJobs = await scrapeLaborum(seenJobIds);

    console.log(`${timestamp()}\n === REVISANDO GETONBOARD ===`);
    const gobJobs = await scrapeGetOnBoard(seenJobIds);

    console.log(`${timestamp()}\n === REVISANDO TRABAJANDO.CL ===`);
    const trabajandoJobs = await scrapeTrabajandog(seenJobIds);

    let nuevas = 0;
    let descartadas = 0;
    let yaVistas = 0;

    const grupos = [
        { jobs: tgJobs, whitelist: false },
        { jobs: ctJobs, whitelist: true },
        { jobs: laborumJobs, whitelist: true },
        { jobs: gobJobs, whitelist: true },
        { jobs: trabajandoJobs, whitelist: true },
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
            } else {
                yaVistas++;
            }
        }
    }

    console.log(`\n=== RONDA FINALIZADA: ${nuevas} enviadas, ${descartadas} descartadas, ${yaVistas} ya vistas ===\n`);
    process.exit(0);
}

runOnce();
