const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeTelegramChannel() {
    const url = 'https://t.me/s/DCCEmpleoSinFiltro';
    const sourceName = 'DCCEmpleoSinFiltro (Telegram)';
    const jobs = [];

    try {
        console.log(`[Scraper] Buscando en ${sourceName}...`);
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        // Los mensajes en la versión web de Telegram están en divis que tienen la clase tgme_widget_message
        $('.tgme_widget_message').each((i, el) => {
            const messageId = $(el).attr('data-post'); // Ej: DCCEmpleoSinFiltro/1234
            if (!messageId) return;

            const textBlock = $(el).find('.tgme_widget_message_text');
            const htmlContent = textBlock.html();
            const textContent = textBlock.text();

            if (!textContent) return;

            // Extraer fecha del mensaje
            const timeElement = $(el).find('time').attr('datetime'); // Ej: 2024-03-08T15:21:00+00:00
            let isRecent = true;

            if (timeElement) {
                const messageDate = new Date(timeElement);
                const now = new Date();
                const hoursDifference = (now - messageDate) / (1000 * 60 * 60);

                // Solo notificar ofertas de las últimas 24 horas para evitar spam antiguo
                if (hoursDifference > 24) {
                    isRecent = false;
                }
            }

            if (!isRecent) return; // Saltamos este elemento del loop

            // Siempre usar el enlace directo al telegram del mensaje para ver el contexto completo
            const link = `https://t.me/${messageId}`;

            // Usamos las primeras 50 palabras para el título/resumen
            const title = textContent.split(' ').slice(0, 15).join(' ') + '...';

            jobs.push({
                id: messageId,
                title: title,
                company: 'Varios', // En canales de telegram no hay campos estructurados
                url: link,
                source: sourceName,
                description: textContent
            });
        });

        console.log(`[Scraper] ${sourceName}: Encontradas ${jobs.length} ofertas recientes.`);
        return jobs;
    } catch (error) {
        console.error(`[Scraper Error] ${sourceName}:`, error.message);
        return [];
    }
}

module.exports = { scrapeTelegramChannel };
