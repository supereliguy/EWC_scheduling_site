const db = require('./src/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const seed = async () => {
    try {
        const adminUser = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
        if (!adminUser) {
            const passwordHash = await bcrypt.hash('password123', 10);
            const token = crypto.randomUUID();
            db.prepare('INSERT INTO users (username, password_hash, role, token) VALUES (?, ?, ?, ?)').run('admin', passwordHash, 'admin', token);
            console.log('Admin user created: admin / password123');
        } else {
            console.log('Admin user already exists.');
        }
    } catch (error) {
        console.error('Error seeding database:', error);
    }
};

seed();
