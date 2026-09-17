// kpiController.js — read-only lookups against KPI_DB_Final, used to power searchable
// dropdowns on the product / product-line creation forms instead of free-text inputs.
const kpiPool = require('../config/kpiDb');
const logger = require('../config/logger');

const SUGGESTION_LIMIT = 20;

// GET /api/kpi/people?q=
// people.name is the surname and people.first_name the given name — combined here into one
// display/search string so a manager's full name is suggested, not just their surname.
// Only powers the product_line_manager field (see FIELD_SUGGESTION_ENDPOINTS), so results are
// restricted to people with an active "Product line manager" role assignment, not all employees.
exports.searchPeople = async (req, res) => {
    const q = (req.query.q || '').trim();
    try {
        const result = await kpiPool.query(
            `SELECT full_name FROM (
                 SELECT DISTINCT TRIM(COALESCE(p.first_name || ' ', '') || p.name) AS full_name
                 FROM people p
                 JOIN people_role_assignment pra ON pra.people_id = p.people_id
                 JOIN role r ON r.role_id = pra.role_id
                 WHERE p.status = 'Active' AND p.name IS NOT NULL
                   AND r.role_slug = 'product_line_manager'
                   AND pra.assignment_status = 'ACTIVE'
             ) t
             WHERE full_name ILIKE $1
             ORDER BY full_name LIMIT $2`,
            [`%${q}%`, SUGGESTION_LIMIT]
        );
        res.status(200).json(result.rows.map(r => r.full_name));
    } catch (error) {
        logger.error({ err: error }, 'Error querying KPI DB for people');
        res.status(500).json({ message: 'Error fetching people from KPI database.' });
    }
};

// GET /api/kpi/customers?q=
exports.searchCustomers = async (req, res) => {
    const q = (req.query.q || '').trim();
    try {
        const result = await kpiPool.query(
            `SELECT DISTINCT customer_name FROM customer
             WHERE customer_status = 'Active' AND is_deleted IS NOT TRUE
               AND customer_name IS NOT NULL AND customer_name ILIKE $1
             ORDER BY customer_name LIMIT $2`,
            [`%${q}%`, SUGGESTION_LIMIT]
        );
        res.status(200).json(result.rows.map(r => r.customer_name));
    } catch (error) {
        logger.error({ err: error }, 'Error querying KPI DB for customers');
        res.status(500).json({ message: 'Error fetching customers from KPI database.' });
    }
};
