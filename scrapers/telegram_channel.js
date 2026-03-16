const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeTelegramChannel(maxAgeDays = 1) {
    const url = 'https://t.me/s/DCCEmpleoSinFiltro';
    const sourceName = 'DCCEmpleoSinFiltro (Telegram)';
    const jobs = [];

    try {
        console.log(`[Scraper] Buscando en ${sourceName}...`);
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        $('.tgme_widget_message').each((i, el) => {
            const messageId = $(el).attr('data-post');
            if (!messageId) return;

            const textBlock = $(el).find('.tgme_widget_message_text');
            const htmlContent = textBlock.html();
            if (!htmlContent) return;

            const textContent = htmlContent
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/p>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/\n{3,}/g, '\n\n')
                .trim();

            const timeElement = $(el).find('time').attr('datetime');
            if (timeElement) {
                const messageDate = new Date(timeElement);
                const daysDifference = (new Date() - messageDate) / (1000 * 60 * 60 * 24);
                if (daysDifference > maxAgeDays) return;
            }

            const link = `https://t.me/${messageId}`;
            const title = textContent.split(' ').slice(0, 15).join(' ') + '...';

            jobs.push({
                id: messageId,
                title,
                company: 'Varios',
                url: link,
                source: sourceName,
                description: textContent,
                publishedAt: timeElement ? new Date(timeElement).getTime() : null,
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
