const fs = require('fs');
const path = require('path');

// ============================================================
// MODO DUAL: Si hay credenciales de Upstash Redis → usa Redis
//            Si no hay → usa archivo JSON local (desarrollo)
// ============================================================

let redisClient = null;

// Intentar cargar Redis solo si están las variables configuradas
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const { Redis } = require('@upstash/redis');
    redisClient = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    console.log('[DB] Usando Upstash Redis (modo nube)');
} else {
    console.log('[DB] Usando archivo JSON local (modo desarrollo)');
}

// --- Implementación LOCAL (archivo JSON) ---
const dbPath = path.join(__dirname, 'jobs.json');

function initLocalDb() {
    if (!fs.existsSync(dbPath)) {
        fs.writeFileSync(dbPath, JSON.stringify({ seenJobs: [] }, null, 2));
    }
}

function isJobSeenLocal(jobId) {
    initLocalDb();
    const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    return data.seenJobs.includes(jobId);
}

function addJobLocal(jobId) {
    initLocalDb();
    const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    if (!data.seenJobs.includes(jobId)) {
        data.seenJobs.push(jobId);
        if (data.seenJobs.length > 1000) data.seenJobs.shift();
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
        return true;
    }
    return false;
}

// --- Implementación REDIS (nube) ---
// Usamos un Set de Redis. 'SISMEMBER' es O(1) — muy eficiente.
async function isJobSeenRedis(jobId) {
    const result = await redisClient.sismember('seen_jobs', jobId);
    return result === 1;
}

async function addJobRedis(jobId) {
    // SADD devuelve 1 si el elemento fue añadido (no existía), 0 si ya existía
    const added = await redisClient.sadd('seen_jobs', jobId);
    return added === 1;
}

// --- Exportaciones (API unificada) ---
async function isJobSeen(jobId) {
    if (redisClient) return await isJobSeenRedis(jobId);
    return isJobSeenLocal(jobId);
}

async function addJob(jobId) {
    if (redisClient) return await addJobRedis(jobId);
    return addJobLocal(jobId);
}

// Devuelve un Set con todos los IDs ya vistos (útil para scrapers que necesitan evitar
// visitar páginas de detalle de trabajos ya procesados)
async function getSeenJobsSet() {
    if (redisClient) {
        const members = await redisClient.smembers('seen_jobs');
        return new Set(members);
    }
    // Modo local
    initLocalDb();
    const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    return new Set(data.seenJobs);
}

module.exports = { isJobSeen, addJob, getSeenJobsSet };
