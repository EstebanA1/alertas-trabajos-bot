module.exports = {
    // Términos de búsqueda en Computrabajo y Laborum (uno por búsqueda, separados por coma)
    CT_QUERY: 'desarrollador,programador,ingeniero informatico,fullstack',

    // La oferta DEBE contener al menos una de estas tecnologías (aplica a portales de empleo, NO al canal Telegram)
    WHITELIST_KEYWORDS: [
        'javascript', 'typescript', 'node', 'react', 'python',
        'css', 'html', 'express', 'docker', 'angular', 'postgresql',
        'mongodb', 'sql', 'next', 'vite', 'fastapi', 'flask',
        'c#', '.net',
    ].join(','),

    // Descarte inmediato — roles que no tienen que ver con informática
    BLACKLIST_HARD: [
        'vendedor', 'vendedora', 'ventas en terreno', 'call center', 'teleoperador',
        'telemarketing', 'reponedor', 'promotor de ventas', 'ejecutivo de ventas',
        'asesor comercial', 'fuerza de ventas', 'captación de clientes',
    ].join(','),

    // Tecnologías no manejadas — se toleran hasta 2 hits antes de descartar
    BLACKLIST_SOFT: [
        'java', 'ruby', 'php', 'scala', 'kotlin', 'cobol', 'sap', 'mainframe',
        'vue', 'vue.js',
    ].join(','),
};
