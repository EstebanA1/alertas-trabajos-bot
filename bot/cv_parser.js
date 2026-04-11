const axios = require('axios');
const pdfParse = require('pdf-parse');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const MAX_PDF_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Descarga el archivo PDF desde los servidores de Telegram.
 * @param {TelegramBot} bot
 * @param {string} fileId
 * @returns {Promise<Buffer>}
 */
async function downloadTelegramFile(bot, fileId) {
    const fileInfo = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 20000 });
    return Buffer.from(response.data);
}

/**
 * Extrae texto plano de un Buffer de PDF usando pdf-parse.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function extractTextFromPdf(buffer) {
    const data = await pdfParse(buffer);
    return (data.text || '').trim();
}

/**
 * Llama a la API de Gemini para extraer campos del texto del CV.
 * @param {string} cvText
 * @returns {Promise<{ queries: string[], whitelist: string[], years_experience: number|null }>}
 */
async function extractCvDataWithGemini(cvText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY no está configurada en el servidor.');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash',
        generationConfig: { responseMimeType: "application/json" }
    });

    // Limitar el texto para no exceder tokens (aprox. 10.000 chars ~ 2.500 tokens)
    const truncated = cvText.substring(0, 10000);

    const prompt = `Eres un asistente que analiza CVs en español. Del siguiente texto de un CV extrae la siguiente información:

- "queries": una lista de máximo 5 cargos o puestos de trabajo que esta persona podría estar buscando, basándote en su experiencia y formación. Deben estar en minúsculas, sin tildes.
- "whitelist": una lista de máximo 8 habilidades, tecnologías, áreas de conocimiento o herramientas clave que aparecen en el CV. En minúsculas, sin tildes.
- "years_experience": número entero que representa los años totales de experiencia laboral de la persona. Si no se puede determinar con seguridad, usa null.

Responde ÚNICAMENTE con un objeto JSON válido con esas 3 claves. Sin texto adicional, sin bloques de código markdown, sin explicaciones.

Texto del CV:
${truncated}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    // Limpiar por si Gemini igual agrega backticks de markdown
    const cleaned = responseText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

    const parsed = JSON.parse(cleaned);

    return {
        queries: Array.isArray(parsed.queries) ? parsed.queries.slice(0, 5) : [],
        whitelist: Array.isArray(parsed.whitelist) ? parsed.whitelist.slice(0, 8) : [],
        years_experience: typeof parsed.years_experience === 'number' ? Math.min(Math.max(parsed.years_experience, 0), 40) : null,
    };
}

/**
 * Handler principal: recibe el file_id de Telegram, descarga, parsea y extrae datos del CV.
 * @param {TelegramBot} bot
 * @param {string} fileId
 * @param {number} fileSize  tamaño en bytes reportado por Telegram
 * @returns {Promise<{ queries, whitelist, years_experience } | null>}
 */
async function parseCvFromTelegram(bot, fileId, fileSize) {
    if (fileSize && fileSize > MAX_PDF_BYTES) {
        throw new Error(`El archivo es demasiado grande (${Math.round(fileSize / 1024 / 1024)} MB). Máximo permitido: 5 MB.`);
    }

    const buffer = await downloadTelegramFile(bot, fileId);
    const text = await extractTextFromPdf(buffer);

    if (!text || text.length < 50) {
        throw new Error('No se pudo extraer texto del PDF. Asegúrate de que no sea un documento escaneado (imagen).');
    }

    return extractCvDataWithGemini(text);
}

/**
 * Usa Gemini para sugerir expansiones/mejoras a la config actual del usuario.
 * @param {{ queries: string[], whitelist: string[], years_experience: number|null }} currentConfig
 * @returns {Promise<{ queries: string[], whitelist: string[] }>}
 */
async function generateRecommendations(currentConfig) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY no configurada.');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash',
        generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `Eres un experto en búsqueda de empleo en Chile (Computrabajo, Laborum, GetOnBoard).

El usuario tiene esta configuración de búsqueda:
- Cargos buscados: ${(currentConfig.queries || []).join(', ') || 'ninguno'}
- Palabras clave (habilidades): ${(currentConfig.whitelist || []).join(', ') || 'ninguna'}
- Años de experiencia: ${currentConfig.years_experience ?? 'no especificado'}

Sugiere mejoras para ampliar el alcance SIN cambiar el perfil:
1. Agrega sinónimos o variantes de los cargos (ej: "contador" → agrega "contador general", "analista contable")
2. Agrega palabras clave relevantes que probablemente faltan (herramientas, certificaciones, áreas relacionadas)
3. Máximo 6 cargos en total y 10 palabras clave en total
4. Usa minúsculas y sin tildes
5. NO repitas lo que ya tiene

Responde SOLO con JSON válido con estas claves:
- "queries": lista completa (originales + sugeridos)
- "whitelist": lista completa (originales + sugeridos)

Sin texto adicional ni bloques markdown.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();
    const cleaned = responseText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
        queries:   Array.isArray(parsed.queries)   ? parsed.queries.slice(0, 6)   : (currentConfig.queries || []),
        whitelist: Array.isArray(parsed.whitelist)  ? parsed.whitelist.slice(0, 10) : (currentConfig.whitelist || []),
    };
}

module.exports = { parseCvFromTelegram, generateRecommendations };
