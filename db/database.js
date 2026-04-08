const { initDB, queryAsync, runAsync } = require('./schema');

const DEFAULT_PORTALS = [];
const ARRAY_FIELDS = new Set(['portals', 'queries', 'whitelist', 'blacklist_soft', 'blacklist_hard']);
const ALLOWED_CONFIG_FIELDS = new Set([
    'portals',
    'queries',
    'whitelist',
    'blacklist_soft',
    'blacklist_hard',
    'scraperapi_key',
    'days_lookback',
    'years_experience',
]);

let dbPromise = null;

async function getDB() {
    if (!dbPromise) {
        dbPromise = initDB().then(async (db) => {
            await runAsync(db, 'PRAGMA journal_mode = WAL');
            await runAsync(db, 'PRAGMA foreign_keys = ON');
            await runAsync(db, 'PRAGMA busy_timeout = 5000');
            return db;
        });
    }
    return dbPromise;
}

function parseJsonArray(value, fallback = []) {
    if (!value) return fallback;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function normalizeArray(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((v) => String(v).trim().toLowerCase())
        .filter(Boolean);
}

async function createUser(chatId) {
    const db = await getDB();

    await runAsync(
        db,
        `
        INSERT OR IGNORE INTO users (chat_id, state, active)
        VALUES (?, 'IDLE', 0)
        `,
        [chatId]
    );

    await runAsync(
        db,
        `
        INSERT OR IGNORE INTO user_config (
            chat_id, portals, queries, whitelist, blacklist_soft, blacklist_hard, scraperapi_key, days_lookback, years_experience
        )
        VALUES (?, ?, '[]', '[]', '[]', '[]', NULL, 1, NULL)
        `,
        [chatId, JSON.stringify(DEFAULT_PORTALS)]
    );

    return true;
}

async function getUser(chatId) {
    const db = await getDB();
    const rows = await queryAsync(db, 'SELECT * FROM users WHERE chat_id = ? LIMIT 1', [chatId]);
    return rows[0] || null;
}

async function updateUserState(chatId, state) {
    const db = await getDB();
    await runAsync(
        db,
        'UPDATE users SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?',
        [state, chatId]
    );
    return true;
}

async function activateUser(chatId, active = 1) {
    const db = await getDB();
    await runAsync(
        db,
        'UPDATE users SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?',
        [active ? 1 : 0, chatId]
    );
    return true;
}

async function getUserConfig(chatId) {
    const db = await getDB();
    const rows = await queryAsync(db, 'SELECT * FROM user_config WHERE chat_id = ? LIMIT 1', [chatId]);
    if (!rows.length) return null;

    const raw = rows[0];
    return {
        chat_id: raw.chat_id,
        portals: parseJsonArray(raw.portals),
        queries: parseJsonArray(raw.queries),
        whitelist: parseJsonArray(raw.whitelist),
        blacklist_soft: parseJsonArray(raw.blacklist_soft),
        blacklist_hard: parseJsonArray(raw.blacklist_hard),
        scraperapi_key: raw.scraperapi_key,
        days_lookback: raw.days_lookback ?? 1,
        years_experience: raw.years_experience ?? null,
    };
}

async function getUserDraftConfig(chatId) {
    const db = await getDB();
    const rows = await queryAsync(db, 'SELECT * FROM user_config_draft WHERE chat_id = ? LIMIT 1', [chatId]);
    if (!rows.length) return null;

    const raw = rows[0];
    return {
        chat_id: raw.chat_id,
        portals: parseJsonArray(raw.portals),
        queries: parseJsonArray(raw.queries),
        whitelist: parseJsonArray(raw.whitelist),
        blacklist_soft: parseJsonArray(raw.blacklist_soft),
        blacklist_hard: parseJsonArray(raw.blacklist_hard),
        scraperapi_key: raw.scraperapi_key,
        days_lookback: raw.days_lookback ?? 1,
        years_experience: raw.years_experience ?? null,
        updated_at: raw.updated_at,
    };
}

async function startUserConfigDraft(chatId) {
    await createUser(chatId);

    const existing = await getUserDraftConfig(chatId);
    if (existing) {
        console.log(`[Draft] reused for ${chatId}`);
        return existing;
    }

    const db = await getDB();
    await runAsync(
        db,
        `
        INSERT INTO user_config_draft (
            chat_id, portals, queries, whitelist, blacklist_soft, blacklist_hard, scraperapi_key, days_lookback, years_experience, updated_at
        )
        SELECT
            chat_id, portals, queries, whitelist, blacklist_soft, blacklist_hard, scraperapi_key, days_lookback, years_experience, CURRENT_TIMESTAMP
        FROM user_config
        WHERE chat_id = ?
        `,
        [chatId]
    );

    console.log(`[Draft] created for ${chatId}`);
    return getUserDraftConfig(chatId);
}

async function updateDraftFieldOnly(chatId, field, value) {
    if (!ALLOWED_CONFIG_FIELDS.has(field)) {
        throw new Error(`Campo de borrador inválido: ${field}`);
    }

    const db = await getDB();

    let persistedValue = value;
    if (ARRAY_FIELDS.has(field)) {
        persistedValue = JSON.stringify(normalizeArray(value));
    } else if (field === 'scraperapi_key') {
        const normalized = value ? String(value).trim() : '';
        persistedValue = normalized || null;
    }

    await runAsync(
        db,
        `UPDATE user_config_draft SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?`,
        [persistedValue, chatId]
    );

    return true;
}

async function updateUserConfig(chatId, field, value) {
    if (!ALLOWED_CONFIG_FIELDS.has(field)) {
        throw new Error(`Campo de configuración inválido: ${field}`);
    }

    const db = await getDB();
    await createUser(chatId);

    let persistedValue = value;
    if (ARRAY_FIELDS.has(field)) {
        persistedValue = JSON.stringify(normalizeArray(value));
    } else if (field === 'scraperapi_key') {
        const normalized = value ? String(value).trim() : '';
        persistedValue = normalized || null;
    }

    await runAsync(
        db,
        `UPDATE user_config SET ${field} = ? WHERE chat_id = ?`,
        [persistedValue, chatId]
    );

    await runAsync(db, 'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?', [chatId]);
    return true;
}

async function updateUserDraftConfig(chatId, field, value) {
    if (!ALLOWED_CONFIG_FIELDS.has(field)) {
        throw new Error(`Campo de borrador inválido: ${field}`);
    }

    const db = await getDB();
    await startUserConfigDraft(chatId);

    let persistedValue = value;
    if (ARRAY_FIELDS.has(field)) {
        persistedValue = JSON.stringify(normalizeArray(value));
    } else if (field === 'scraperapi_key') {
        const normalized = value ? String(value).trim() : '';
        persistedValue = normalized || null;
    }

    await runAsync(
        db,
        `UPDATE user_config_draft SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?`,
        [persistedValue, chatId]
    );

    return true;
}

async function discardUserConfigDraft(chatId) {
    const db = await getDB();
    await runAsync(db, 'DELETE FROM user_config_draft WHERE chat_id = ?', [chatId]);
    return true;
}

async function commitUserConfigDraft(chatId, { active = true } = {}) {
    const db = await getDB();

    await runAsync(db, 'BEGIN IMMEDIATE TRANSACTION');
    try {
        const draftRows = await queryAsync(db, 'SELECT * FROM user_config_draft WHERE chat_id = ? LIMIT 1', [chatId]);
        if (!draftRows.length) {
            throw new Error('No existe borrador para confirmar.');
        }

        const draft = draftRows[0];
        const portals = parseJsonArray(draft.portals);
        const queries = parseJsonArray(draft.queries);

        if (!queries.length) {
            throw new Error('El borrador no tiene queries.');
        }

        if (portals.includes('computrabajo') && !draft.scraperapi_key) {
            throw new Error('Falta ScraperAPI key para Computrabajo.');
        }

        await runAsync(
            db,
            `
            UPDATE user_config
            SET portals = ?,
                queries = ?,
                whitelist = ?,
                blacklist_soft = ?,
                blacklist_hard = ?,
                scraperapi_key = ?,
                days_lookback = ?,
                years_experience = ?
            WHERE chat_id = ?
            `,
            [
                draft.portals,
                draft.queries,
                draft.whitelist,
                draft.blacklist_soft,
                draft.blacklist_hard,
                draft.scraperapi_key,
                draft.days_lookback,
                draft.years_experience,
                chatId,
            ]
        );

        await runAsync(db, 'DELETE FROM user_config_draft WHERE chat_id = ?', [chatId]);
        await runAsync(
            db,
            'UPDATE users SET active = ?, state = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?',
            [active ? 1 : 0, active ? 'ACTIVE' : 'IDLE', chatId]
        );

        await runAsync(db, 'COMMIT');
    } catch (err) {
        try {
            await runAsync(db, 'ROLLBACK');
        } catch {
            // no-op
        }
        throw err;
    }

    return true;
}

async function resetUserConfiguration(chatId) {
    const db = await getDB();
    await createUser(chatId);

    await runAsync(
        db,
        `
        UPDATE user_config
        SET portals = '[]',
            queries = '[]',
            whitelist = '[]',
            blacklist_soft = '[]',
            blacklist_hard = '[]',
            scraperapi_key = NULL,
            days_lookback = 1,
            years_experience = NULL
        WHERE chat_id = ?
        `,
        [chatId]
    );

    await runAsync(
        db,
        'UPDATE users SET active = 0, state = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?',
        ['IDLE', chatId]
    );

    await runAsync(db, 'DELETE FROM user_config_draft WHERE chat_id = ?', [chatId]);

    return true;
}

async function getActiveUsers() {
    const db = await getDB();
    return queryAsync(db, 'SELECT chat_id FROM users WHERE active = 1');
}

async function isJobSeenByUser(chatId, jobId) {
    const db = await getDB();
    const rows = await queryAsync(
        db,
        'SELECT 1 AS exists_flag FROM seen_jobs WHERE chat_id = ? AND job_id = ? LIMIT 1',
        [chatId, jobId]
    );
    return rows.length > 0;
}

async function addSeenJobForUser(chatId, jobId) {
    const db = await getDB();
    const result = await runAsync(
        db,
        'INSERT OR IGNORE INTO seen_jobs (chat_id, job_id) VALUES (?, ?)',
        [chatId, jobId]
    );
    return result.changes === 1;
}

async function cleanOldSeenJobs(days = 14) {
    const db = await getDB();
    await runAsync(
        db,
        "DELETE FROM seen_jobs WHERE seen_at < datetime('now', ?)",
        [`-${days} days`]
    );
    await runAsync(
        db,
        "DELETE FROM seen_jobs_global WHERE seen_at < datetime('now', ?)",
        [`-${days} days`]
    );
    return true;
}

/**
 * Limpia TODOS los datos del usuario: config, draft y historial de ofertas vistas.
 * Deja al usuario en estado nuevo para poder re-configurar desde cero.
 */
async function clearUserData(chatId) {
    const db = await getDB();
    // Resetear configuración (igual que resetUserConfiguration)
    await runAsync(
        db,
        `UPDATE user_config
        SET portals = '[]', queries = '[]', whitelist = '[]',
            blacklist_soft = '[]', blacklist_hard = '[]',
            scraperapi_key = NULL, days_lookback = 1, years_experience = NULL
        WHERE chat_id = ?`,
        [chatId]
    );
    await runAsync(
        db,
        'UPDATE users SET active = 0, state = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?',
        ['IDLE', chatId]
    );
    await runAsync(db, 'DELETE FROM user_config_draft WHERE chat_id = ?', [chatId]);
    // Borrar historial de ofertas vistas del usuario
    await runAsync(db, 'DELETE FROM seen_jobs WHERE chat_id = ?', [chatId]);
    return true;
}

// Compatibilidad con scripts legacy (single-user)
async function isJobSeen(jobId) {
    const db = await getDB();
    const rows = await queryAsync(db, 'SELECT 1 AS exists_flag FROM seen_jobs_global WHERE job_id = ? LIMIT 1', [jobId]);
    return rows.length > 0;
}

async function addJob(jobId) {
    const db = await getDB();
    const result = await runAsync(db, 'INSERT OR IGNORE INTO seen_jobs_global (job_id) VALUES (?)', [jobId]);
    return result.changes === 1;
}

async function getSeenJobsSet() {
    const db = await getDB();
    const rows = await queryAsync(db, 'SELECT job_id FROM seen_jobs_global');
    return new Set(rows.map((r) => r.job_id));
}

module.exports = {
    getDB,
    createUser,
    getUser,
    updateUserState,
    getUserConfig,
    getUserDraftConfig,
    startUserConfigDraft,
    updateUserConfig,
    updateUserDraftConfig,
    updateDraftFieldOnly,
    discardUserConfigDraft,
    commitUserConfigDraft,
    resetUserConfiguration,
    activateUser,
    getActiveUsers,
    isJobSeenByUser,
    addSeenJobForUser,
    cleanOldSeenJobs,
    clearUserData,
    isJobSeen,
    addJob,
    getSeenJobsSet,
};
