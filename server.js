const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- ACCOUNTS API ---
app.get('/api/accounts', (req, res) => {
    db.all(`SELECT * FROM accounts`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/accounts', (req, res) => {
    const { id, name, initial_balance } = req.body;
    db.run(`INSERT INTO accounts (id, name, initial_balance) VALUES (?, ?, ?)`, [id, name, initial_balance || 0], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id, name, initial_balance });
    });
});

app.post('/api/accounts/:id/correct', (req, res) => {
    const account_id = req.params.id;
    const { target_balance, date } = req.body;
    
    db.get(`SELECT initial_balance FROM accounts WHERE id = ?`, [account_id], (err, acc) => {
        if (err || !acc) return res.status(404).json({ error: 'Kasa bulunamadı.' });
        
        db.all(`SELECT type, amount FROM transactions WHERE account_id = ? AND status = 'completed'`, [account_id], (err, txs) => {
            if (err) return res.status(500).json({ error: err.message });
            
            let current_balance = acc.initial_balance;
            txs.forEach(t => {
                if (t.type === 'income') current_balance += t.amount;
                if (t.type === 'expense') current_balance -= t.amount;
            });
            
            const difference = target_balance - current_balance;
            if (Math.abs(difference) < 0.01) {
                return res.json({ message: 'Bakiye zaten güncel.' });
            }
            
            const type = difference > 0 ? 'income' : 'expense';
            const amount = Math.abs(difference);
            const id = 't_' + Date.now();
            
            db.run(`INSERT INTO transactions (id, type, status, amount, category, description, date, account_id, is_recurring) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, type, 'completed', amount, 'Diğer', 'Kasa Düzeltme', date, account_id, 0], function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: 'Kasa düzeltildi.', difference });
            });
        });
    });
});

// --- BACKUP & RESTORE API ---
app.get('/api/export', (req, res) => {
    db.all('SELECT * FROM accounts', (err, accounts) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all('SELECT * FROM transactions', (err, transactions) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ accounts, transactions });
        });
    });
});

app.post('/api/import', (req, res) => {
    const { accounts, transactions } = req.body;
    if (!accounts || !transactions) return res.status(400).json({ error: 'Geçersiz yedekleme dosyası.' });

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.run('DELETE FROM accounts');
        db.run('DELETE FROM transactions');

        const stmtAcc = db.prepare('INSERT INTO accounts (id, name, initial_balance) VALUES (?, ?, ?)');
        accounts.forEach(a => stmtAcc.run(a.id, a.name, a.initial_balance));
        stmtAcc.finalize();

        const stmtTx = db.prepare('INSERT INTO transactions (id, type, status, amount, category, description, date, account_id, is_recurring, transfer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        transactions.forEach(t => stmtTx.run(t.id, t.type, t.status, t.amount, t.category, t.description, t.date, t.account_id, t.is_recurring, t.transfer_id));
        stmtTx.finalize();

        db.run('COMMIT', (err) => {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'Geri yükleme başarısız oldu.' });
            }
            res.json({ message: 'Veriler başarıyla geri yüklendi.' });
        });
    });
});

// --- TRANSACTIONS API ---
app.get('/api/transactions', (req, res) => {
    db.all(`SELECT t.*, a.name as account_name FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/transactions', (req, res) => {
    const { id, type, status, amount, category, description, date, account_id, is_recurring } = req.body;
    
    if (is_recurring) {
        const day_of_month = new Date(date).getDate();
        const templateId = 'rec_' + Date.now();
        db.run(`INSERT INTO recurring_templates (id, type, amount, category, description, account_id, day_of_month) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [templateId, type, amount, category, description, account_id || 'default_kasa', day_of_month]);
    }

    const sql = `INSERT INTO transactions (id, type, status, amount, category, description, date, account_id, is_recurring) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [id, type, status, amount, category, description, date, account_id || 'default_kasa', is_recurring ? 1 : 0];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json(req.body);
    });
});

app.delete('/api/transactions/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT transfer_id FROM transactions WHERE id = ?`, [id], (err, row) => {
        if (row && row.transfer_id) {
            db.run(`DELETE FROM transactions WHERE transfer_id = ?`, [row.transfer_id]);
        } else {
            db.run(`DELETE FROM transactions WHERE id = ?`, [id]);
        }
        res.json({ message: 'İşlem silindi.' });
    });
});

app.put('/api/transactions/:id', (req, res) => {
    const id = req.params.id;
    
    // Sadece durum güncellemesi ise
    if (Object.keys(req.body).length === 1 && req.body.status) {
        db.run(`UPDATE transactions SET status = ? WHERE id = ?`, [req.body.status, id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Durum güncellendi.' });
        });
        return;
    }

    // Tam güncelleme
    const { type, status, amount, category, description, date, account_id } = req.body;
    const sql = `UPDATE transactions SET type = ?, status = ?, amount = ?, category = ?, description = ?, date = ?, account_id = ? WHERE id = ?`;
    const params = [type, status, amount, category, description, date, account_id, id];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'İşlem güncellendi.' });
    });
});

// --- TRANSFERS API ---
app.post('/api/transfers', (req, res) => {
    const { id_from, id_to, account_from, account_to, amount, description, date, status } = req.body;
    const transfer_id = 'trf_' + Date.now();

    db.run(`INSERT INTO transactions (id, type, status, amount, category, description, date, account_id, transfer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id_from, 'expense', status, amount, 'Transfer', description + ' (Gönderilen)', date, account_from, transfer_id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            db.run(`INSERT INTO transactions (id, type, status, amount, category, description, date, account_id, transfer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id_to, 'income', status, amount, 'Transfer', description + ' (Alınan)', date, account_to, transfer_id], (err2) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    res.json({ message: 'Transfer başarılı.' });
            });
    });
});

// --- RECURRING GENERATOR API ---
app.post('/api/generate-recurring', (req, res) => {
    const { year, month } = req.body; 
    
    db.all(`SELECT * FROM recurring_templates`, [], (err, templates) => {
        if (err || !templates) return res.json({ message: 'No templates' });
        
        templates.forEach(t => {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(t.day_of_month).padStart(2, '0')}`;
            const occ_id = `rec_occ_${t.id}_${year}_${month}`;
            
            db.get(`SELECT id FROM transactions WHERE id = ?`, [occ_id], (err, row) => {
                if (!row) {
                    db.run(`INSERT INTO transactions (id, type, status, amount, category, description, date, account_id, is_recurring) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [occ_id, t.type, 'planned', t.amount, t.category, t.description, dateStr, t.account_id, 1]);
                }
            });
        });
        res.json({ message: 'Düzenli işlemler kontrol edildi/eklendi.' });
    });
});

app.listen(PORT, () => console.log(`Sunucu http://localhost:${PORT} üzerinde çalışıyor.`));
