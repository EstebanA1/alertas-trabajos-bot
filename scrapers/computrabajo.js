const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

// ScraperAPI actúa como proxy rotatorio de IPs residenciales.
function buildScraperApiUrl(targetUrl) {
    const apiKey = process.env.SCRAPERAPI_KEY;
    if (!apiKey) {
        console.warn('[Scraper] SCRAPERAPI_KEY no configurada. Petición directa (puede fallar).');
        return targetUrl;
    }
    return `http://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&country_code=cl`;
}

// Convierte HTML a texto limpio preservando saltos de línea (igual que telegram_channel.js)
function htmlToText(html) {
    if (!html) return '';
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// Visita la página individual de la oferta y extrae la descripción completa
async function fetchJobDescription(jobUrl) {
    try {
        const proxyUrl = buildScraperApiUrl(jobUrl);
        const { data } = await axios.get(proxyUrl, { timeout: 30000 });
        const $ = cheerio.load(data);

        // Computrabajo pone la descripción completa en #jobDescription o .job-description
        const descHtml = $('#jobDescription').html()
            || $('.job-description').html()
            || $('[data-id="oferta-detalle"]').html()
            || $('section.box_offer_detail').html()
            || '';

        return htmlToText(descHtml);
    } catch (err) {
        console.warn(`[Scraper] No se pudo obtener descripción completa de: ${jobUrl}`);
        return '';
    }
}

async function scrapeComputrabajo(seenJobIds = new Set()) {
    const query = process.env.CT_QUERY || 'desarrollador';
    const targetUrl = `https://cl.computrabajo.com/trabajo-de-${query}?by=pubdate`;
    const listingUrl = buildScraperApiUrl(targetUrl);
    const sourceName = 'Computrabajo Chile';
    const jobs = [];

    try {
        console.log(`[Scraper] Buscando en ${sourceName} con término '${query}'...`);
        const { data } = await axios.get(listingUrl, { timeout: 30000 });
        const $ = cheerio.load(data);

        // Recopilar primero los trabajos básicos del listado
        const rawJobs = [];
        $('article[data-id]').each((i, el) => {
            const jobId = $(el).attr('data-id');
            if (!jobId) return;

            const titleEl = $(el).find('h2 a, .js-o-link');
            const title = titleEl.first().text().trim();
            if (!title) return;

            const linkPath = titleEl.first().attr('href');
            const jobUrl = linkPath
                ? (linkPath.startsWith('http') ? linkPath : `https://cl.computrabajo.com${linkPath}`)
                : targetUrl;

            const company = $(el).find('[data-company-name], p.dV a').first().text().trim()
                || $(el).find('p.dV').first().text().trim();

            // Filtro de tiempo: "Hace X días" → ignorar si X > 1
            const dateText = $(el).find('.pb5 > span, time').first().text().trim().toLowerCase();
            if (dateText.includes('día') || dateText.includes('dias')) {
                const days = parseInt(dateText.match(/\d+/)?.[0] || '1');
                if (days > 1) return;
            }

            rawJobs.push({ id: `ct_${jobId}`, title, company, url: jobUrl, source: sourceName });
        });

        console.log(`[Scraper] ${sourceName}: ${rawJobs.length} ofertas en página. Obteniendo descripciones completas de nuevas...`);

        // Solo visitar la página de detalle si el job es realmente nuevo (no está en seenJobIds)
        // Esto ahorra créditos de ScraperAPI evitando visitar páginas de trabajos ya notificados
        for (const job of rawJobs) {
            if (seenJobIds.has(job.id)) {
                // Ya fue visto, no necesitamos bajar la descripción completa
                jobs.push({ ...job, description: '' });
            } else {
                // Es nuevo → visitar página de detalle para obtener texto completo
                const description = await fetchJobDescription(job.url);
                jobs.push({ ...job, description });
                // Pequeña pausa para no abusar de la API
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        console.log(`[Scraper] ${sourceName}: Procesadas ${jobs.length} ofertas.`);
        return jobs;
    } catch (error) {
        console.error(`[Scraper Error] ${sourceName}:`, error.message);
        if (error.response?.status === 403) {
            console.error('  -> Bloqueado por 403. Verifica tu SCRAPERAPI_KEY.');
        }
        return [];
    }
}

module.exports = { scrapeComputrabajo };
