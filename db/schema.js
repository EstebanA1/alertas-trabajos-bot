const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');

function initDB() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) return reject(err);
        });

        db.serialize(() => {
            // Tabla de usuarios y su estado conversacional
            db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    chat_id TEXT PRIMARY KEY,
                    state TEXT DEFAULT 'IDLE',
                    active INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Tabla de configuración por usuario
            db.run(`
                CREATE TABLE IF NOT EXISTS user_config (
                    chat_id TEXT PRIMARY KEY,
                    portals TEXT DEFAULT '[]', -- JSON array
                    queries TEXT DEFAULT '[]', -- JSON array
                    whitelist TEXT DEFAULT '[]', -- JSON array
                    blacklist_soft TEXT DEFAULT '[]', -- JSON array
                    blacklist_hard TEXT DEFAULT '[]', -- JSON array
                    scraperapi_key TEXT DEFAULT NULL,
                    days_lookback INTEGER NOT NULL DEFAULT 1,
                    years_experience INTEGER DEFAULT NULL,
                    FOREIGN KEY(chat_id) REFERENCES users(chat_id)
                )
            `);

            // Borrador editable de configuración (no impacta runner hasta confirmar)
            db.run(`
                CREATE TABLE IF NOT EXISTS user_config_draft (
                    chat_id TEXT PRIMARY KEY,
                    portals TEXT DEFAULT '[]',
                    queries TEXT DEFAULT '[]',
                    whitelist TEXT DEFAULT '[]',
                    blacklist_soft TEXT DEFAULT '[]',
                    blacklist_hard TEXT DEFAULT '[]',
                    scraperapi_key TEXT DEFAULT NULL,
                    days_lookback INTEGER NOT NULL DEFAULT 1,
                    years_experience INTEGER DEFAULT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(chat_id) REFERENCES users(chat_id)
                )
            `);

            // Migrations idempotentes para bases de datos existentes
            const migrations = [
                `ALTER TABLE user_config ADD COLUMN days_lookback INTEGER NOT NULL DEFAULT 1`,
                `ALTER TABLE user_config ADD COLUMN years_experience INTEGER DEFAULT NULL`,
                `ALTER TABLE user_config_draft ADD COLUMN days_lookback INTEGER NOT NULL DEFAULT 1`,
                `ALTER TABLE user_config_draft ADD COLUMN years_experience INTEGER DEFAULT NULL`,
            ];
            for (const sql of migrations) {
                db.run(sql, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.error('[DB Migration]', err.message);
                    }
                });
            }

            // Tabla de trabajos vistos por usuario (para no repetir alertas)
            db.run(`
                CREATE TABLE IF NOT EXISTS seen_jobs (
                    chat_id TEXT,
                    job_id TEXT,
                    seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (chat_id, job_id),
                    FOREIGN KEY(chat_id) REFERENCES users(chat_id)
                )
            `);

            // Tabla global de vistos (compatibilidad con scripts legacy)
            db.run(`
                CREATE TABLE IF NOT EXISTS seen_jobs_global (
                    job_id TEXT PRIMARY KEY,
                    seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            db.run(`
                CREATE INDEX IF NOT EXISTS idx_seen_jobs_seen_at
                ON seen_jobs(seen_at)
            `);

            db.run(`
                CREATE INDEX IF NOT EXISTS idx_user_config_draft_updated_at
                ON user_config_draft(updated_at)
            `);

            db.run(`
                CREATE INDEX IF NOT EXISTS idx_seen_jobs_global_seen_at
                ON seen_jobs_global(seen_at)
            `);

            resolve(db);
        });
    });
}

// Wrapper para ejecutar queries con Promesas
const queryAsync = (db, query, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const runAsync = (db, query, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
};

module.exports = { initDB, dbPath, queryAsync, runAsync };
