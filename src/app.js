const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const sitesRoutes = require('./routes/sites');
const scheduleRoutes = require('./routes/schedule');

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret-key', // Secure in production
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// API Routes
app.use('/api', authRoutes);
app.use('/api', adminRoutes);
app.use('/api', sitesRoutes);
app.use('/api', scheduleRoutes);

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

module.exports = app;
