const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

const dbPath = path.join(dataDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        
        db.serialize(() => {
            // Create Accounts Table
            db.run(`CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                initial_balance REAL DEFAULT 0
            )`);
            
            // Create Recurring Templates Table
            db.run(`CREATE TABLE IF NOT EXISTS recurring_templates (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                account_id TEXT NOT NULL,
                day_of_month INTEGER NOT NULL
            )`);

            // Create or Update Transactions Table
            db.run(`CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY,
                type TEXT,
                status TEXT,
                amount REAL,
                category TEXT,
                description TEXT,
                date TEXT,
                account_id TEXT,
                is_recurring BOOLEAN DEFAULT 0,
                transfer_id TEXT
            )`);

            // Add columns safely if they don't exist
            db.all("PRAGMA table_info(transactions)", (err, rows) => {
                if (!err && rows) {
                    const hasAccountId = rows.some(r => r.name === 'account_id');
                    if (!hasAccountId) {
                        db.run("ALTER TABLE transactions ADD COLUMN account_id TEXT", (err) => {
                            if (!err) {
                                db.run("UPDATE transactions SET account_id = 'default_kasa'");
                            }
                        });
                        db.run("ALTER TABLE transactions ADD COLUMN is_recurring BOOLEAN DEFAULT 0");
                        db.run("ALTER TABLE transactions ADD COLUMN transfer_id TEXT");
                    } else {
                        // Eğer sütun varsa ama bazı eski kayıtlarda boş/NULL kalmışsa
                        db.run("UPDATE transactions SET account_id = 'default_kasa' WHERE account_id IS NULL OR account_id = ''");
                    }
                }
            });

            // Insert default account if none exists
            db.get("SELECT COUNT(*) as count FROM accounts", (err, row) => {
                if (row && row.count === 0) {
                    db.run("INSERT INTO accounts (id, name, initial_balance) VALUES ('default_kasa', 'Nakit Kasa', 0)");
                }
            });
        });
    }
});

module.exports = db;
