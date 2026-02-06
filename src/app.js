const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const adminRoutes = require('./routes/admin');
const sitesRoutes = require('./routes/sites');
const scheduleRoutes = require('./routes/schedule');

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api', adminRoutes);
app.use('/api', sitesRoutes);
app.use('/api', scheduleRoutes);

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

module.exports = app;
