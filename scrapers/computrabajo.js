const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();
const config = require('../config');
const { htmlToText } = require('../utils/html');

function buildScraperApiUrl(targetUrl) {
    const apiKey = process.env.SCRAPERAPI_KEY;
    if (!apiKey) {
        console.warn('[Scraper] SCRAPERAPI_KEY no configurada. Petición directa (puede fallar).');
        return targetUrl;
    }
    return `http://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&country_code=cl`;
}

async function fetchJobDescription(jobUrl) {
    try {
        const proxyUrl = buildScraperApiUrl(jobUrl);
        const { data } = await axios.get(proxyUrl, { timeout: 30000 });
        const $ = cheerio.load(data);

        const selectores = [
            '#jobDescription', '#job-description', '.job-description', '.jobDescription',
            '#oferta-detalle', '[data-id="oferta-detalle"]', 'section.box_offer_detail',
            '.offer_description', '.offer-description', '#offerDescription', '.cont_description',
            'div[class*="description"]', 'div[class*="Description"]',
            'section[class*="description"]', 'article[class*="description"]',
        ];

        let descHtml = '';
        for (const sel of selectores) {
            const el = $(sel);
            if (el.length && el.html()?.trim()) {
                descHtml = el.html();
                break;
            }
        }

        if (!descHtml) {
            let maxLen = 0;
            $('div, section, article').each((_, el) => {
                const tag = $(el).parents('header, footer, nav, aside').length;
                if (tag) return;
                const text = $(el).text().trim();
                if (text.length > maxLen && text.length > 200) {
                    maxLen = text.length;
                    descHtml = $(el).html();
                }
            });
        }

        const rawText = htmlToText(descHtml);

        const marcadoresInicio = [
            'descripción de la oferta', 'descripcion de la oferta',
            'sobre el empleo', 'acerca del empleo',
        ];
        let textoFinal = rawText;
        for (const marcador of marcadoresInicio) {
            const idx = rawText.toLowerCase().indexOf(marcador);
            if (idx !== -1) {
                textoFinal = rawText.slice(idx).replace(/^[^\n]+\n/, '').trim();
                break;
            }
        }

        const marcadoresFin = [
            'palabras clave:', 'acerca de ', 'evaluación general', 'evaluacion general',
            'mostrar las', 'mostrar los', 'ofertas similares',
            'avísame con ofertas', 'avisame con ofertas', 'denunciar empleo', 'postularme',
        ];
        for (const marcador of marcadoresFin) {
            const idx = textoFinal.toLowerCase().indexOf(marcador);
            if (idx !== -1 && idx > 50) {
                textoFinal = textoFinal.slice(0, idx).trim();
            }
        }

        return textoFinal;
    } catch (err) {
        console.warn(`[Scraper] No se pudo obtener descripción de: ${jobUrl} — ${err.message}`);
        return '';
    }
}

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
        const rawUrl = linkPath
            ? (linkPath.startsWith('http') ? linkPath : `https://cl.computrabajo.com${linkPath}`)
            : targetUrl;
        const jobUrl = rawUrl.split('#')[0];

        const company = $(el).find('[data-company-name], p.dV a').first().text().trim()
            || $(el).find('p.dV').first().text().trim();

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
    const queries = (process.env.CT_QUERY || config.CT_QUERY)
        .split(',').map(q => q.trim()).filter(Boolean);

    const jobs = [];
    const seenInThisRun = new Set();

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
                if (seenInThisRun.has(job.id)) continue;
                seenInThisRun.add(job.id);

                if (seenJobIds.has(job.id)) {
                    jobs.push({ ...job, description: '' });
                } else {
                    const description = await fetchJobDescription(job.url);
                    jobs.push({ ...job, description });
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

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
