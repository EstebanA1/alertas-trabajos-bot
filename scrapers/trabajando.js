const axios = require('axios');
require('dotenv').config();
const config = require('../config');
const { htmlToText } = require('../utils/html');

// API interna de Trabajando.cl — descubierta via inspección de red.
const TRABAJANDO_API = 'https://www.trabajando.cl/api/searchjob';
const SOURCE_NAME = 'Trabajando.cl';

function esReciente(fechaStr) {
    if (!fechaStr) return true;
    const publicado = new Date(fechaStr);
    const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return publicado >= hace24h;
}

function slugify(str) {
    return (str || 'empleo')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

async function scrapeTrabajandog(seenJobIds = new Set()) {
    const queries = (process.env.CT_QUERY || config.CT_QUERY)
        .split(',').map(q => q.trim()).filter(Boolean);

    const jobs = [];
    const seenInThisRun = new Set();

    for (const query of queries) {
        try {
            console.log(`[Scraper] ${SOURCE_NAME}: buscando '${query}'...`);

            const response = await axios.get(TRABAJANDO_API, {
                params: {
                    palabraClave: query,
                    pagina: 1,
                    orden: 'RANKING',
                    tipoOrden: 'DESC',
                },
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://www.trabajando.cl/',
                    'Origin': 'https://www.trabajando.cl',
                },
                timeout: 20000,
            });

            const jobList = response.data?.ofertas || [];
            console.log(`[Scraper] '${query}': ${jobList.length} ofertas.`);

            const slugQuery = slugify(query);

            for (const item of jobList) {
                if (!esReciente(item.fechaPublicacion)) continue;

                const jobId = `trabajando_${item.idOferta}`;
                if (seenInThisRun.has(jobId)) continue;
                seenInThisRun.add(jobId);

                // Trabajando.cl ahora usa el título del cargo codificado en la URL de oferta
                const cargoEncode = encodeURIComponent(item.nombreCargo?.trim() || '');
                const jobUrl = `https://www.trabajando.cl/trabajo-empleo/${cargoEncode}`;

                let description = '';
                let aniosExp = null;

                if (!seenJobIds.has(jobId)) {
                    try {
                        const detail = await axios.get(
                            `https://www.trabajando.cl/api/ofertas/${item.idOferta}`,
                            {
                                headers: {
                                    'Accept': 'application/json',
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                    'Referer': jobUrl,
                                },
                                timeout: 15000,
                            }
                        );
                        const d = detail.data;
                        aniosExp = d.aniosExperiencia ?? null;
                        const partes = [
                            htmlToText(d.descripcionOferta || '', { secciones: true }),
                            d.requisitosMinimos ? `\nRequisitos mínimos\n${htmlToText(d.requisitosMinimos, { secciones: true })}` : '',
                        ].filter(Boolean).join('\n');
                        description = partes;
                        await new Promise(r => setTimeout(r, 800));
                    } catch (err) {
                        console.warn(`[Scraper] No se pudo obtener detalle de ${jobId}: ${err.message}`);
                    }
                }

                // Filtro de experiencia directo desde el campo de la API (más fiable que el regex en texto)
                if (aniosExp !== null && aniosExp >= 3) {
                    console.log(`[Scraper] Descartada por experiencia (${aniosExp} años): ${item.nombreCargo}`);
                    continue;
                }

                jobs.push({
                    id: jobId,
                    title: item.nombreCargo?.trim() || '(sin título)',
                    company: item.nombreEmpresa?.trim() || '',
                    url: jobUrl,
                    source: SOURCE_NAME,
                    description,
                });
            }

            await new Promise(r => setTimeout(r, 1500));

        } catch (error) {
            console.error(`[Scraper Error] ${SOURCE_NAME} ('${query}'):`, error.message);
            if (error.response?.status === 403 || error.response?.status === 401) {
                console.error('  -> Trabajando.cl bloqueó la petición. Puede requerir actualización de headers.');
                break;
            }
        }
    }

    console.log(`[Scraper] ${SOURCE_NAME}: ${jobs.length} ofertas procesadas en total.`);
    return jobs;
}

module.exports = { scrapeTrabajandog };
