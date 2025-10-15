// /server/config/db.js
const { Pool } = require('pg');


const pool = new Pool({
    user: 'administrationSTS',
    host: 'avo-adb-002.postgres.database.azure.com',
    database: 'RFQ_DATA',
    password: 'St$@0987',
    port: 5432
});

module.exports = pool;
