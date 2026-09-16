// Read-only pool into KPI_DB_Final — sources dropdown reference data (people, customers,
// manufacturing sites) for the product/product-line creation forms. Never written to.
const { Pool } = require('pg');

const kpiPool = new Pool({
    user: process.env.KPI_DB_USER,
    host: process.env.KPI_DB_HOST,
    database: process.env.KPI_DB_NAME,
    password: process.env.KPI_DB_PASSWORD,
    port: process.env.KPI_DB_PORT || 5432,
    ssl: {
        rejectUnauthorized: false
    }
});

module.exports = kpiPool;
