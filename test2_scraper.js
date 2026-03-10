// Script de diagnóstico: corre solo 1 query por portal con logs detallados.
// NO envía alertas ni escribe en Redis — solo muestra lo que encontraría.

require('dotenv').config();
const config = require('./config');
const { getSeenJobsSet } = require('./db/database');
const { scrapeTelegramChannel } = require('./scrapers/telegram_channel');
const { scrapeComputrabajo } = require('./scrapers/computrabajo');
const { scrapeLaborum } = require('./scrapers/laborum');
const { scrapeGetOnBoard } = require('./scrapers/getonboard');
const { scrapeTrabajandog } = require('./scrapers/trabajando');

// Solo la primera query de CT_QUERY
const QUERY_TEST = (process.env.CT_QUERY || config.CT_QUERY)
    .split(',')[0].trim();

console.log(`\n🔍 MODO DIAGNÓSTICO — Query de prueba: '${QUERY_TEST}'\n`);

// Parchamos CT_QUERY para que los scrapers solo usen 1 término
process.env.CT_QUERY = QUERY_TEST;

const WHITELIST = (process.env.WHITELIST_KEYWORDS || config.WHITELIST_KEYWORDS)
    .split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

const BLACKLIST_HARD = (process.env.BLACKLIST_HARD || config.BLACKLIST_HARD)
    .split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

const BLACKLIST_SOFT = (process.env.BLACKLIST_SOFT || config.BLACKLIST_SOFT)
    .split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

const EXP_REGEX = /(?:experiencia(?:\s+\w+){0,5}\s+(?:de\s+)?([3-9]|\d{2,})\s*\+?\s*años|(?:mínimo|al\s+menos|sobre)\s+([3-9]|\d{2,})\s*\+?\s*años|([3-9]|\d{2,})\+\s*años|([3-9]|\d{2,})\s*años\s+de\s+experiencia|([3-9]|\d{2,})\s*años\s+en\s+(?:cargos?|roles?|el\s+cargo))/;

function matchPalabra(texto, palabra) {
    const escaped = palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = /\w$/.test(palabra) ? new RegExp(`\\b${escaped}\\b`) : new RegExp(escaped);
    return regex.test(texto);
}

function diagnosticarJob(job, aplicarWhitelist) {
    const texto = `${job.title} ${job.description}`.toLowerCase();

    const expMatch = texto.match(EXP_REGEX);
    if (expMatch) {
        return { pasa: false, razon: `❌ Exp. excesiva detectada: "${expMatch[0].trim()}"` };
    }

    const hardHit = BLACKLIST_HARD.find(p => matchPalabra(texto, p));
    if (hardHit) {
        return { pasa: false, razon: `❌ Blacklist hard: "${hardHit}"` };
    }

    const softHits = BLACKLIST_SOFT.filter(p => matchPalabra(texto, p));
    if (softHits.length > 2) {
        return { pasa: false, razon: `❌ Blacklist soft (${softHits.length} hits): [${softHits.join(', ')}]` };
    }

    if (aplicarWhitelist && WHITELIST.length > 0) {
        const coincide = WHITELIST.find(p => matchPalabra(texto, p));
        if (!coincide) {
            return { pasa: false, razon: `⏭️  Sin tecnologías de interés` };
        }
        const wlHits = WHITELIST.filter(p => matchPalabra(texto, p));
        const softMsg = softHits.length > 0 ? ` | ⚠️ soft: [${softHits.join(', ')}]` : '';
        return { pasa: true, razon: `✅ Whitelist: [${wlHits.join(', ')}]${softMsg}` };
    }

    return { pasa: true, razon: `✅ Pasa (sin whitelist)` };
}

function imprimirJobs(label, jobs, aplicarWhitelist) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📦 ${label} — ${jobs.length} ofertas recibidas del scraper`);
    console.log('─'.repeat(60));
    jobs.forEach((job, i) => {
        const { pasa, razon } = diagnosticarJob(job, aplicarWhitelist);
        const desc = job.description
            ? `(desc: ${job.description.length} chars)`
            : '(desc: VACÍA ⚠️)';
        console.log(`[${i + 1}] ${job.title}`);
        console.log(`    🏢 ${job.company || '(sin empresa)'} | 🔗 ${job.url}`);
        console.log(`    📝 ${desc}`);
        console.log(`    ${razon}`);
    });
}

async function diagnose() {
    const seenJobIds = await getSeenJobsSet();
    console.log(`[Redis] IDs ya vistos en total: ${seenJobIds.size}\n`);

    console.log(`[20:xx:xx] === CANAL DE TELEGRAM ===`);
    const tgJobs = await scrapeTelegramChannel();
    imprimirJobs('DCCEmpleoSinFiltro (Telegram)', tgJobs, false);

    console.log(`\n[20:xx:xx] === COMPUTRABAJO ===`);
    const ctJobs = await scrapeComputrabajo(seenJobIds);
    imprimirJobs('Computrabajo Chile', ctJobs, true);

    console.log(`\n[20:xx:xx] === LABORUM ===`);
    const laborumJobs = await scrapeLaborum(seenJobIds);
    imprimirJobs('Laborum Chile', laborumJobs, true);

    console.log(`\n[20:xx:xx] === GETONBOARD ===`);
    const gobJobs = await scrapeGetOnBoard(seenJobIds);
    imprimirJobs('GetOnBoard', gobJobs, true);

    console.log(`\n[20:xx:xx] === TRABAJANDO.CL ===`);
    const trabajandoJobs = await scrapeTrabajandog(seenJobIds);
    imprimirJobs('Trabajando.cl', trabajandoJobs, true);

    const total = tgJobs.length + ctJobs.length + laborumJobs.length + gobJobs.length + trabajandoJobs.length;
    const vacias = [...tgJobs, ...ctJobs, ...laborumJobs, ...gobJobs, ...trabajandoJobs]
        .filter(j => !j.description && !j.source?.toLowerCase().includes('telegram')).length;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`RESUMEN:`);
    console.log(`  Total ofertas recibidas : ${total}`);
    console.log(`  Con descripción vacía   : ${vacias}  ← posibles fallos en detalle API`);
    console.log(`  IDs ya en Redis         : ${seenJobIds.size}`);
    console.log('═'.repeat(60));

    process.exit(0);
}

diagnose();
