const db = require('./src/db');
console.log(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='requests'").get());
