const SECCIONES = [
    'Responsabilidades', 'Requisitos', 'Beneficios', 'Funciones', 'Deseables',
    'Mandatorias', 'Formación requerida', 'Ofrecemos', 'Lo que ofrecemos',
    'Requerimientos', 'Condiciones', 'Tareas', 'Sobre nosotros', 'Sobre el cargo',
    'Qué harás', '¿Qué harás', 'Valoramos', 'Habilidades', 'Competencias',
];

/**
 * Convierte HTML a texto limpio preservando saltos de línea.
 * @param {string} html
 * @param {{ secciones?: boolean, minLineLen?: number }} opts
 */
function htmlToText(html, { secciones = false, minLineLen = 3 } = {}) {
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

    if (secciones) {
        for (const seccion of SECCIONES) {
            const regex = new RegExp(`(?<!\n)(${seccion})`, 'g');
            text = text.replace(regex, '\n\n$1');
        }
    }

    return text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length >= minLineLen || l === '')
        .reduce((acc, l) => {
            if (l === '' && acc.at(-1) === '') return acc;
            acc.push(l); return acc;
        }, [])
        .join('\n')
        .trim();
}

module.exports = { htmlToText };
