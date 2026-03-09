const axios = require('axios');
require('dotenv').config();
const { htmlToText } = require('../utils/html');

// API pública REST — sin API key. Docs: https://api-doc.getonbrd.com
const GOB_API = 'https://www.getonbrd.com/api/v0/search/jobs';
const SOURCE_NAME = 'GetOnBoard';

function esReciente(publishedAt) {
    if (!publishedAt) return true;
    const publicado = new Date(publishedAt * 1000);
    const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return publicado >= hace24h;
}

async function scrapeGetOnBoard(seenJobIds = new Set()) {
    const queries = ['desarrollador', 'developer', 'frontend', 'backend', 'fullstack'];

    const jobs = [];
    const seenInThisRun = new Set();

    for (const query of queries) {
        try {
            console.log(`[Scraper] ${SOURCE_NAME}: buscando '${query}'...`);

            const response = await axios.get(GOB_API, {
                params: {
                    query,
                    country_code: 'CL',
                    'expand[]': 'company',
                    per_page: 20,
                    page: 1,
                },
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                },
                timeout: 20000,
            });

            const jobList = response.data?.data || [];
            console.log(`[Scraper] '${query}': ${jobList.length} ofertas.`);

            for (const item of jobList) {
                const attrs = item.attributes || {};

                if (!esReciente(attrs.published_at)) continue;

                const jobId = `gob_${item.id}`;
                if (seenInThisRun.has(jobId)) continue;
                seenInThisRun.add(jobId);

                const company = attrs.company?.data?.attributes?.name
                    || attrs.organization?.data?.attributes?.name
                    || '';

                const partes = [
                    htmlToText(attrs.description || ''),
                    attrs.functions ? `\nResponsabilidades\n${htmlToText(attrs.functions)}` : '',
                    attrs.benefits  ? `\nBeneficios\n${htmlToText(attrs.benefits)}`  : '',
                ].filter(Boolean).join('\n');

                const jobUrl = item.links?.public_url || `https://www.getonboard.com/jobs/${item.id}`;

                jobs.push({
                    id: jobId,
                    title: attrs.title?.trim() || '(sin título)',
                    company,
                    url: jobUrl,
                    source: SOURCE_NAME,
                    description: partes,
                });
            }

            await new Promise(r => setTimeout(r, 1500));

        } catch (error) {
            console.error(`[Scraper Error] ${SOURCE_NAME} ('${query}'):`, error.message);
            if (error.response?.status === 429) {
                console.warn('[Scraper] GetOnBoard: rate limit alcanzado, esperando 10s...');
                await new Promise(r => setTimeout(r, 10000));
            }
        }
    }

    console.log(`[Scraper] ${SOURCE_NAME}: ${jobs.length} ofertas procesadas en total.`);
    return jobs;
}

module.exports = { scrapeGetOnBoard };
