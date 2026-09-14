const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'atm_optimizer.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Failed to connect to SQLite:', err.message);
    } else {
        console.log('✅ Connected to SQLite database at', DB_PATH);
    }
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

module.exports = db;
