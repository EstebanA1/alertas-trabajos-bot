/**
 * Entrypoint para ejecución LOCAL de pruebas.
 * Carga .env.local en lugar del .env de producción.
 * Uso: node local.js
 */
require('dotenv').config({ path: '.env.local' });
require('./index.js');
