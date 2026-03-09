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

// Convierte HTML a texto limpio preservando saltos de línea
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

        // Intentar selectores conocidos de Computrabajo (del más específico al más general)
        const selectores = [
            '#jobDescription',
            '#job-description',
            '.job-description',
            '.jobDescription',
            '#oferta-detalle',
            '[data-id="oferta-detalle"]',
            'section.box_offer_detail',
            '.offer_description',
            '.offer-description',
            '#offerDescription',
            '.cont_description',
            'div[class*="description"]',
            'div[class*="Description"]',
            'section[class*="description"]',
            'article[class*="description"]',
        ];

        let descHtml = '';
        for (const sel of selectores) {
            const el = $(sel);
            if (el.length && el.html()?.trim()) {
                descHtml = el.html();
                break;
            }
        }

        // Fallback: si ningún selector funcionó, buscar el bloque de texto más largo de la página
        if (!descHtml) {
            let maxLen = 0;
            $('div, section, article').each((_, el) => {
                // Ignorar headers, footers, navs y sidebars
                const tag = $(el).parents('header, footer, nav, aside').length;
                if (tag) return;
                const text = $(el).text().trim();
                if (text.length > maxLen && text.length > 200) {
                    maxLen = text.length;
                    descHtml = $(el).html();
                }
            });
        }

        return htmlToText(descHtml);
    } catch (err) {
        console.warn(`[Scraper] No se pudo obtener descripción de: ${jobUrl} — ${err.message}`);
        return '';
    }
}

// Extrae los trabajos básicos de una página de resultados de CT
function extractJobsFromPage($, targetUrl) {
    const sourceName = 'Computrabajo Chile';
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

        // Filtro de tiempo: ignorar si tiene más de 1 día
        const dateText = $(el).find('.pb5 > span, time').first().text().trim().toLowerCase();
        if (dateText.includes('día') || dateText.includes('dias')) {
            const days = parseInt(dateText.match(/\d+/)?.[0] || '1');
            if (days > 1) return;
        }

        rawJobs.push({ id: `ct_${jobId}`, title, company, url: jobUrl, source: sourceName });
    });

    return rawJobs;
}

async function scrapeComputrabajo(seenJobIds = new Set()) {
    const sourceName = 'Computrabajo Chile';

    // CT_QUERY puede tener múltiples términos separados por coma.
    // Computrabajo solo acepta UN término por URL, así que hacemos una búsqueda por término.
    const queries = (process.env.CT_QUERY || 'desarrollador')
        .split(',')
        .map(q => q.trim())
        .filter(Boolean);

    const jobs = [];
    const seenInThisRun = new Set(); // Evitar duplicados entre distintas búsquedas

    for (const query of queries) {
        const targetUrl = `https://cl.computrabajo.com/trabajo-de-${encodeURIComponent(query)}?by=pubdate&pubdate=1`;
        const listingUrl = buildScraperApiUrl(targetUrl);

        try {
            console.log(`[Scraper] ${sourceName}: buscando '${query}'...`);
            const { data } = await axios.get(listingUrl, { timeout: 30000 });
            const $ = cheerio.load(data);
            const rawJobs = extractJobsFromPage($, targetUrl);

            console.log(`[Scraper] '${query}': ${rawJobs.length} ofertas. Obteniendo descripciones de nuevas...`);

            for (const job of rawJobs) {
                // Saltar si ya procesamos este job en esta misma ronda (puede aparecer en 2 búsquedas)
                if (seenInThisRun.has(job.id)) continue;
                seenInThisRun.add(job.id);

                if (seenJobIds.has(job.id)) {
                    // Ya fue notificado antes, no necesitamos la descripción completa
                    jobs.push({ ...job, description: '' });
                } else {
                    // Nuevo → obtener descripción completa desde la página de detalle
                    const description = await fetchJobDescription(job.url);
                    jobs.push({ ...job, description });
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            // Pausa entre búsquedas para no saturar ScraperAPI
            await new Promise(r => setTimeout(r, 2000));

        } catch (error) {
            console.error(`[Scraper Error] ${sourceName} ('${query}'):`, error.message);
            if (error.response?.status === 403) {
                console.error('  -> Bloqueado por 403. Verifica tu SCRAPERAPI_KEY.');
            }
        }
    }

    console.log(`[Scraper] ${sourceName}: ${jobs.length} ofertas procesadas en total.`);
    return jobs;
}

module.exports = { scrapeComputrabajo };
