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
 * Intenta llamar a Gemini pasando por una lista de modelos hasta que uno funcione.
 */
async function generateContentWithFallback(genAI, prompt) {
    const models = ['gemini-2.0-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-pro', 'gemini-2.5-flash'];
    let lastError = null;
    
    for (const modelName of models) {
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: { responseMimeType: "application/json" }
            });
            const result = await model.generateContent(prompt);
            console.log(`[Gemini] Análisis exitoso con el modelo: ${modelName}`);
            return result;
        } catch (err) {
            console.warn(`[Gemini Fallback] El modelo ${modelName} falló temporalmente: ${err.message}`);
            lastError = err;
        }
    }
    throw new Error(`Todos los modelos de Gemini fallaron por alta demanda. Por favor intenta más tarde. Detalle: ${lastError.message}`);
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

    // Limitar el texto para no exceder tokens (aprox. 10.000 chars ~ 2.500 tokens)
    const truncated = cvText.substring(0, 10000);

    const prompt = `Eres un asistente que analiza CVs en español. Del siguiente texto de un CV extrae la siguiente información:

- "queries": una lista de máximo 5 cargos o puestos de trabajo que esta persona podría estar buscando, basándote en su experiencia y formación. Deben estar en minúsculas, sin tildes.
- "whitelist": una lista de máximo 8 habilidades, tecnologías, áreas de conocimiento o herramientas clave que aparecen en el CV. En minúsculas, sin tildes.
- "years_experience": número entero que representa los años totales de experiencia laboral de la persona. Si no se puede determinar con seguridad, usa null.

Responde ÚNICAMENTE con un objeto JSON válido con esas 3 claves. Sin texto adicional, sin bloques de código markdown, sin explicaciones.

Texto del CV:
${truncated}`;

    const result = await generateContentWithFallback(genAI, prompt);
    const responseText = result.response.text().trim();

    // Limpiar por si Gemini igual agrega backticks de markdown
    const cleaned = responseText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

    const parsed = JSON.parse(cleaned);

    let exp = null;
    if (parsed.years_experience !== undefined && parsed.years_experience !== null) {
        exp = Number(parsed.years_experience);
        if (!isNaN(exp)) {
            exp = Math.round(exp); // Convert 0.5 to 1
            if (exp === 0) exp = 1;
            exp = Math.min(Math.max(exp, 1), 40);
        } else {
            exp = null;
        }
    }

    return {
        queries: Array.isArray(parsed.queries) ? parsed.queries.slice(0, 5) : [],
        whitelist: Array.isArray(parsed.whitelist) ? parsed.whitelist.slice(0, 8) : [],
        years_experience: exp,
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

    const prompt = `Eres un experto en búsqueda de empleo en Chile (Computrabajo, Laborum, GetOnBoard).

El usuario tiene esta configuración de búsqueda:
- Cargos buscados: ${(currentConfig.queries || []).join(', ') || 'ninguno'}
- Palabras clave (habilidades): ${(currentConfig.whitelist || []).join(', ') || 'ninguna'}
- Años de experiencia: ${currentConfig.years_experience ?? 'no especificado'}

Sugiere mejoras para ampliar el alcance SIN cambiar el perfil, e incluye términos para evitar cargos basuras o que no calcen:
1. Agrega sinónimos o variantes de los cargos (ej: "contador" → agrega "contador general", "analista contable")
2. Agrega palabras clave relevantes que probablemente faltan.
3. Sugiere palabras para "blacklist_soft" (palabras poco deseables. Ej: "práctica", "junior" si es senior. MUY IMPORTANTE EN TI: agrega lenguajes, frameworks, herramientas Cloud/CI/CD o arquitecturas (ej: kafka, jenkins, aws, microservicios, spring boot, etc.) que NO estén en sus 'Palabras clave'. La idea es penalizar ofertas que exijan ecosistemas o tecnologías que el usuario no domina).
4. Sugiere palabras para "blacklist_hard" (cargos completamente alejados que suelen aparecer mezclados, ej: "reemplazo", "vendedor", "call center").
5. Máximo 6 cargos, 10 palabras whitelist, 10 palabras blacklist_soft, y 6 palabras blacklist_hard.
6. Usa minúsculas y sin tildes. NO repitas lo que ya tiene.

Responde SOLO con JSON válido con estas claves:
- "queries": lista completa (originales + sugeridos)
- "whitelist": lista completa (originales + sugeridos)
- "blacklist_soft": lista sugerida
- "blacklist_hard": lista sugerida

Sin texto adicional ni bloques markdown.`;

    const result = await generateContentWithFallback(genAI, prompt);
    const responseText = result.response.text().trim();
    const cleaned = responseText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
        queries: Array.isArray(parsed.queries) ? parsed.queries.slice(0, 6) : (currentConfig.queries || []),
        whitelist: Array.isArray(parsed.whitelist) ? parsed.whitelist.slice(0, 10) : (currentConfig.whitelist || []),
        blacklist_soft: Array.isArray(parsed.blacklist_soft) ? parsed.blacklist_soft.slice(0, 5) : [],
        blacklist_hard: Array.isArray(parsed.blacklist_hard) ? parsed.blacklist_hard.slice(0, 5) : [],
    };
}

module.exports = { parseCvFromTelegram, generateRecommendations };
