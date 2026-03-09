require('dotenv').config();
const { Redis } = require('@upstash/redis');

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

(async () => {
    const count = await redis.scard('seen_jobs');
    console.log(`[Redis] IDs almacenados actualmente: ${count}`);
    await redis.del('seen_jobs');
    console.log('[Redis] Set "seen_jobs" eliminado. La próxima ejecución tratará todas las ofertas como nuevas.');
    process.exit(0);
})();
