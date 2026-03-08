const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

async function scrapeComputrabajo() {
    // Usamos el query de las variables de entorno, por defecto 'desarrollador'
    const query = process.env.CT_QUERY || 'desarrollador';
    
    // URL base de búsqueda en Chile ordenado por fecha (pubdate) para obtener lo más reciente
    const url = `https://cl.computrabajo.com/trabajo-de-${query}?by=pubdate`;
    const sourceName = 'Computrabajo Chile';
    const jobs = [];

    try {
        console.log(`[Scraper] Buscando en ${sourceName} con término '${query}'...`);
        
        // Simular un User-Agent real para evitar bloqueos simples
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
            }
        });

        const $ = cheerio.load(data);

        // Seleccionar los artículos que contienen las ofertas (clase común en CT)
        $('article.box_offer').each((i, el) => {
            // El ID suele venir en el atributo data-id
            const jobId = $(el).attr('data-id');
            if (!jobId) return;

            const titleElement = $(el).find('h2.tO a');
            const title = titleElement.text().trim();
            const linkPath = titleElement.attr('href');
            const urlCompleta = linkPath ? `https://cl.computrabajo.com${linkPath}` : url;

            const company = $(el).find('p.empr a').text().trim() || $(el).find('p.empr').text().trim();
            
            // Descripción corta
            const description = $(el).find('p.dO').text().trim();

            jobs.push({
                id: `ct_${jobId}`,
                title: title,
                company: company,
                url: urlCompleta,
                source: sourceName,
                description: description
            });
        });

        console.log(`[Scraper] ${sourceName}: Encontradas ${jobs.length} ofertas en la primera página.`);
        return jobs;
    } catch (error) {
        // Manejar posibles errores (como bloqueos 403)
        console.error(`[Scraper Error] ${sourceName}:`, error.message);
        if (error.response && error.response.status === 403) {
            console.error("  -> CT está bloqueando la petición por falta de Captcha o cabeceras insuficientes. Posible uso de Puppeteer requerido en el futuro.");
        }
        return [];
    }
}

module.exports = { scrapeComputrabajo };
