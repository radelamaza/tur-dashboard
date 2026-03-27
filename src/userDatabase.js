const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

class UserDatabase {
    constructor(dbPath = './sales_history.db') {
        this.db = new sqlite3.Database(dbPath);
        this.ready = this.init();
    }

    async init() {
        await this.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                role TEXT NOT NULL DEFAULT 'viewer',
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await this.run(`
            CREATE TABLE IF NOT EXISTS password_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token TEXT UNIQUE NOT NULL,
                expires_at DATETIME NOT NULL,
                used INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        `);
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async createUser(email, role = 'viewer') {
        await this.ready;
        const result = await this.run(
            'INSERT INTO users (email, role) VALUES (?, ?)',
            [email.toLowerCase(), role]
        );
        return result.id;
    }

    async getUserByEmail(email) {
        await this.ready;
        return this.get('SELECT * FROM users WHERE email = ? AND is_active = 1', [email.toLowerCase()]);
    }

    async getUserById(id) {
        await this.ready;
        return this.get('SELECT * FROM users WHERE id = ?', [id]);
    }

    async getAllUsers() {
        await this.ready;
        return this.all(
            'SELECT id, email, role, is_active, created_at, CASE WHEN password_hash IS NOT NULL THEN 1 ELSE 0 END as has_password FROM users ORDER BY created_at DESC'
        );
    }

    async setPassword(userId, passwordHash) {
        await this.ready;
        await this.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
    }

    async deactivateUser(userId) {
        await this.ready;
        await this.run('UPDATE users SET is_active = 0 WHERE id = ?', [userId]);
    }

    async createPasswordToken(userId) {
        await this.ready;
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48h
        await this.run(
            'INSERT INTO password_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
            [userId, token, expiresAt]
        );
        return token;
    }

    async getValidToken(token) {
        await this.ready;
        return this.get(
            `SELECT pt.*, u.email, u.role FROM password_tokens pt
             JOIN users u ON pt.user_id = u.id
             WHERE pt.token = ? AND pt.used = 0 AND pt.expires_at > datetime('now')`,
            [token]
        );
    }

    async markTokenUsed(token) {
        await this.ready;
        await this.run('UPDATE password_tokens SET used = 1 WHERE token = ?', [token]);
    }

    async ensureAdminExists(adminEmail) {
        await this.ready;
        const existing = await this.get('SELECT * FROM users WHERE email = ?', [adminEmail.toLowerCase()]);
        if (!existing) {
            const id = await this.createUser(adminEmail, 'admin');
            const token = await this.createPasswordToken(id);
            return token;
        }
        if (!existing.password_hash) {
            const token = await this.createPasswordToken(existing.id);
            return token;
        }
        return null;
    }
}

module.exports = UserDatabase;
