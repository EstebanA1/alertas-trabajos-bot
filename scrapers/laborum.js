const axios = require('axios');
require('dotenv').config();
const config = require('../config');
const { htmlToText } = require('../utils/html');

// API interna de Laborum — descubierta via inspección de red. No requiere ScraperAPI.
const LABORUM_API = 'https://www.laborum.cl/api/avisos/searchV2';
const SOURCE_NAME = 'Laborum Chile';

function esReciente(fechaIso, maxAgeDays = 1) {
    if (!fechaIso) return true;
    const publicado = new Date(fechaIso);
    const limite = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    return publicado >= limite;
}

function resolveArgs(arg1, arg2) {
    if (Array.isArray(arg1)) {
        return {
            queries: arg1.map(q => String(q).trim()).filter(Boolean),
            seenJobIds: arg2 instanceof Set ? arg2 : new Set(),
        };
    }

    return {
        queries: (process.env.CT_QUERY || config.CT_QUERY)
            .split(',').map(q => q.trim()).filter(Boolean),
        seenJobIds: arg1 instanceof Set ? arg1 : new Set(),
    };
}

async function scrapeLaborum(arg1, arg2, maxAgeDays = 1) {
    const { queries, seenJobIds } = resolveArgs(arg1, arg2);

    const jobs = [];
    const seenInThisRun = new Set();

    for (const query of queries) {
        try {
            console.log(`[Scraper] ${SOURCE_NAME}: buscando '${query}'...`);

            const response = await axios.post(
                `${LABORUM_API}?pageSize=20&page=0&sort=RECIENTES`,
                { filtros: [], query },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-site-id': 'BMCL',
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Referer': 'https://www.laborum.cl/',
                        'Origin': 'https://www.laborum.cl',
                    },
                    timeout: 20000,
                }
            );

            const jobList = response.data?.content || [];
            console.log(`[Scraper] '${query}': ${jobList.length} ofertas.`);

            for (const item of jobList) {
                if (!esReciente(item.fechaHoraPublicacion, maxAgeDays)) continue;

                const jobId = `laborum_${item.id}`;
                if (seenInThisRun.has(jobId)) continue;
                seenInThisRun.add(jobId);

                const slugTitulo = (item.titulo || 'empleo')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '');
                const jobUrl = `https://www.laborum.cl/empleos/${slugTitulo}-${item.id}.html`;

                const description = htmlToText(item.detalle || '', { secciones: true });

                jobs.push({
                    id: jobId,
                    title: item.titulo?.trim() || '(sin título)',
                    company: item.empresa?.trim() || '',
                    url: jobUrl,
                    source: SOURCE_NAME,
                    description,
                    publishedAt: item.fechaHoraPublicacion ? new Date(item.fechaHoraPublicacion).getTime() : null,
                });
            }

            await new Promise(r => setTimeout(r, 1500));

        } catch (error) {
            console.error(`[Scraper Error] ${SOURCE_NAME} ('${query}'):`, error.message);
            if (error.response?.status === 401 || error.response?.status === 403) {
                console.error('  -> Laborum bloqueó la petición. Los headers pueden necesitar actualización.');
                break;
            }
        }
    }

    console.log(`[Scraper] ${SOURCE_NAME}: ${jobs.length} ofertas procesadas en total.`);
    return jobs;
}

module.exports = { scrapeLaborum };
