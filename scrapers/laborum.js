const axios = require('axios');
require('dotenv').config();
const config = require('../config');

// Laborum Chile usa una API REST interna (descubierta via inspección de red).
// No requiere ScraperAPI ni claves externas — funciona con headers correctos.

const LABORUM_API = 'https://www.laborum.cl/api/avisos/searchV2';
const SOURCE_NAME = 'Laborum Chile';

// Secciones típicas de ofertas laborales — se separan con doble salto de línea
const SECCIONES = [
    'Responsabilidades', 'Requisitos', 'Beneficios', 'Funciones', 'Deseables',
    'Mandatorias', 'Formación requerida', 'Ofrecemos', 'Lo que ofrecemos',
    'Requerimientos', 'Condiciones', 'Tareas', 'Sobre nosotros', 'Sobre el cargo',
    'Qué harás', '¿Qué harás', 'Valoramos', 'Habilidades', 'Competencias',
];

function htmlToText(html) {
    if (!html) return '';

    let text = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

    // Añadir doble salto antes de secciones conocidas que no estén al inicio
    for (const seccion of SECCIONES) {
        // Busca el nombre de sección cuando aparece pegado a texto previo (sin \n antes)
        const regex = new RegExp(`(?<!\n)(${seccion})`, 'g');
        text = text.replace(regex, '\n\n$1');
    }

    return text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length >= 2 || l === '')
        .reduce((acc, l) => {
            if (l === '' && acc.at(-1) === '') return acc;
            acc.push(l); return acc;
        }, [])
        .join('\n')
        .trim();
}

// Filtra publicaciones de las últimas 24 horas
function esReciente(fechaIso) {
    if (!fechaIso) return true; // Si no hay fecha, incluimos por las dudas
    const publicado = new Date(fechaIso);
    const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return publicado >= hace24h;
}

async function scrapeLaborum(seenJobIds = new Set()) {
    const queries = (process.env.CT_QUERY || config.CT_QUERY)
        .split(',').map(q => q.trim()).filter(Boolean);

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
                        'x-site-id': 'BMCL',      // Identifica el sitio como Laborum Chile
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
                // Filtrar solo las últimas 24 horas
                if (!esReciente(item.fechaHoraPublicacion)) continue;

                const jobId = `laborum_${item.id}`;
                if (seenInThisRun.has(jobId)) continue;
                seenInThisRun.add(jobId);

                // Construir URL limpia de la oferta
                const slugTitulo = (item.titulo || 'empleo')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '');
                const jobUrl = `https://www.laborum.cl/empleos/${slugTitulo}-${item.id}.html`;

                const description = htmlToText(item.detalle || '');

                jobs.push({
                    id: jobId,
                    title: item.titulo?.trim() || '(sin título)',
                    company: item.empresa?.trim() || '',
                    url: jobUrl,
                    source: SOURCE_NAME,
                    description,
                });
            }

            // Pausa entre búsquedas para no saturar la API
            await new Promise(r => setTimeout(r, 1500));

        } catch (error) {
            console.error(`[Scraper Error] ${SOURCE_NAME} ('${query}'):`, error.message);
            if (error.response?.status === 401 || error.response?.status === 403) {
                console.error('  -> Laborum bloqueó la petición. Los headers pueden necesitar actualización.');
                break; // No seguir intentando si estamos bloqueados
            }
        }
    }

    console.log(`[Scraper] ${SOURCE_NAME}: ${jobs.length} ofertas procesadas en total.`);
    return jobs;
}

module.exports = { scrapeLaborum };
