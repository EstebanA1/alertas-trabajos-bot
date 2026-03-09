module.exports = {
    // Términos de búsqueda en Computrabajo (uno por búsqueda, separados por coma)
    CT_QUERY: 'desarrollador,programador,ingeniero informatico,fullstack',

    // La oferta DEBE contener al menos una de estas tecnologías para ser notificada
    // (aplica a portales de empleo, NO al canal de Telegram)
    WHITELIST_KEYWORDS: [
        'javascript', 'typescript', 'node', 'react', 'python',
        'css', 'html', 'express', 'docker', 'angular', 'postgresql',
        'mongodb', 'sql', 'next', 'vite', 'fastapi', 'django', 'flask',
        'c#', '.net',
    ].join(','),

    // Si la oferta contiene alguna de estas palabras, se descarta
    BLACKLIST_KEYWORDS: [
        // Tecnologías no manejadas
        'java', 'ruby', 'php', 'scala', 'kotlin', 'cobol', 'sap', 'mainframe',
        'vue', 'vue.js',
        // Roles de ventas / call center / terreno que se cuelan por búsquedas amplias
        'vendedor', 'vendedora', 'ventas en terreno', 'call center', 'teleoperador',
        'telemarketing', 'reponedor', 'promotor de ventas', 'ejecutivo de ventas',
        'asesor comercial', 'fuerza de ventas', 'captación de clientes',
        // Experiencia mínima mayor a la disponible
        '3 años de experiencia', '4 años de experiencia', '5 años de experiencia',
        '3 años en', '4 años en', '5 años en',
    ].join(','),
};

