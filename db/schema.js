// db/schema.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

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
                    FOREIGN KEY(chat_id) REFERENCES users(chat_id)
                )
            `);

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
