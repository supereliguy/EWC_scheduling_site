const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

// Serve static files from the root directory
// This allows the frontend (index.html, admin.js, etc.) to be served directly
app.use(express.static(path.join(__dirname, '../')));

// Catch-all route to serve index.html for any unhandled routes
// This supports client-side routing if added later, and ensures the app loads on root
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Serving static files from: ${path.join(__dirname, '../')}`);
});
