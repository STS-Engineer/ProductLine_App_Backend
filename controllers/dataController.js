// dataController.js

const pool = require('../config/db');
// NEW: Import the file controller for file deletion logic
const { deleteFile } = require('./fileController');
const logger = require('../config/logger');

// Shared by createItem and updateItem — prevents arbitrary column writes from request body keys.
const TABLE_COLUMNS = {
    products: ['product_name', 'product_line', 'description', 'product_definition', 'operating_environment', 'technical_parameters', 'machines_and_tooling', 'manufacturing_strategy', 'purchasing_strategy', 'prototypes_ppap_and_sop', 'engineering_and_testing', 'capacity', 'our_advantages', 'gmdc_pct', 'product_line_id', 'customers_in_production', 'customer_in_development', 'level_of_interest_and_why', 'estimated_price_per_product', 'prod_if_customer_in_china', 'costing_data', 'product_pictures'],
    product_lines: ['name', 'type_of_products', 'manufacturing_locations', 'design_center', 'product_line_manager', 'history', 'type_of_customers', 'metiers', 'strength', 'weakness', 'perspectives', 'compliance_resource_id', 'attachments_raw'],
    users: ['user_role']
};

// --- AUDITING FUNCTION (Centralized logging) ---
exports.logAction = async (action, table_name, document_id, user_id, user_name, details = {}) => {
    try {
        await pool.query(
            'INSERT INTO audit_logs (action, table_name, document_id, user_id, user_name, details) VALUES ($1, $2, $3, $4, $5, $6)',
            [action, table_name, document_id, user_id, user_name, details]
        );
    } catch (error) {
        logger.error({ err: error, action, table_name, document_id }, 'CRITICAL: Failed to write audit log');
        // Do not throw, as a failed log should not crash the main operation
    }
};

const { logAction } = exports; // Reference for internal use

// --- DYNAMIC CRUD OPERATIONS (using tableName from server.js routes) ---

// GET All Items
exports.getAllItems = (tableName) => async (req, res) => {
    try {
        let orderByClause = 'ORDER BY id ASC';
        let whereClause = '';
        const queryParams = [];
        let limitClause = '';
        let selectClause = '*';

        if (tableName === 'audit_logs') {
            // FIX APPLIED HERE: Filter out LOGIN and LOGOUT actions at the database level
            orderByClause = 'ORDER BY logged_at DESC';
            whereClause = "WHERE action NOT IN ('LOGIN', 'LOGOUT')";
            // OPTIMIZATION: Limit the logs to the 500 most recent records
            limitClause = 'LIMIT 500';
        } else if (tableName === 'users') {
            orderByClause = 'ORDER BY created_at DESC';
            // Never return password hashes over the API. The users table has no
            // created_by/updated_at/updated_by columns (unlike product_lines/products).
            selectClause = 'id, email, display_name, user_role, created_at';
        } else if (tableName === 'product_lines' || tableName === 'products') {
            orderByClause = 'ORDER BY created_at DESC';
        }

        // OPTIMIZATION: Append limitClause to the final query string
        const result = await pool.query(`SELECT ${selectClause} FROM ${tableName} ${whereClause} ${orderByClause} ${limitClause}`, queryParams);
        res.status(200).json(result.rows);
    } catch (error) {
        logger.error({ err: error, tableName }, 'Error fetching data');
        res.status(500).json({ message: `Error fetching data for ${tableName}.` });
    }
};

// CREATE Item
exports.createItem = (tableName) => async (req, res) => {
    // Data from req.body (non-file fields) AND req.files (file paths)
    const data = req.body;
    const userId = req.user.id;
    const userName = req.user.displayName;

    // CRITICAL FIX: Array to track all files uploaded in this request
    const newlyUploadedFiles = [];

    // Determine the specific file field for the current table
    const fileField = tableName === 'products' ? 'product_pictures' :
                      tableName === 'product_lines' ? 'attachments_raw' : null;

    // 1. Process uploaded files from Multer and add path array to data payload
    if (req.files) {
        if (fileField && req.files[fileField] && Array.isArray(req.files[fileField])) {
            const paths = req.files[fileField].map(file => {
                newlyUploadedFiles.push(file.blobUrl); // Track for rollback
                return file.blobUrl;
            });
            // CRITICAL: Store a JSON stringified array of paths
            data[fileField] = JSON.stringify(paths);
        }
    }

    // A JSON (non-multipart) request with no pictures/attachments arrives here as a plain JS
    // array (e.g. []), never touched by the multer branch above. Passed straight through as a
    // query parameter, node-postgres serializes a bare array as a *Postgres* array literal
    // ('{}' for empty) rather than JSON — corrupting this TEXT column. Must always be a JSON
    // string before it reaches the query.
    if (fileField && Array.isArray(data[fileField])) {
        data[fileField] = JSON.stringify(data[fileField]);
    }

    // Store path for potential cleanup (now an array)
    const filesToDeleteOnRollback = newlyUploadedFiles;

    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Start transaction

        // --- CRITICAL FIX START: Lookup product_line_id from name for 'products' table ---
        if (tableName === 'products' && data.product_line) {
            const productLineResult = await client.query(
                'SELECT id FROM product_lines WHERE name = $1',
                [data.product_line]
            );

            if (productLineResult.rows.length === 0) {
                // If the name is not found, throw an error to trigger a rollback
                throw new Error(`Product line with name "${data.product_line}" not found. Please create the Product Line first.`);
            }

            // Populate the product_line_id foreign key with the found ID
            data.product_line_id = productLineResult.rows[0].id;
        }

        // --- CRITICAL FIX END ---

        // Filter the payload against the column allowlist to prevent 'column does not exist' errors
        // and arbitrary column writes.
        const finalPayload = {};
        if (TABLE_COLUMNS[tableName]) {
            Object.keys(data).forEach(key => {
                if (TABLE_COLUMNS[tableName].includes(key)) {
                    finalPayload[key] = data[key];
                }
            });
        }

        const columns = Object.keys(finalPayload).join(', ');
        const values = Object.values(finalPayload);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

        // Add columns for user and date tracking
        const userColumns = 'created_by, updated_by';
        const userPlaceholders = `$${values.length + 1}, $${values.length + 2}`;

        // 2. Insert into main table
        const insertQuery = `INSERT INTO ${tableName} (${columns}, ${userColumns}) VALUES (${placeholders}, ${userPlaceholders}) RETURNING *`;

        const result = await client.query(insertQuery, [...values, userId, userId]);
        const newItem = result.rows[0];

        // 3. Audit Log (DUAL-WRITE)
        await logAction('CREATE', tableName, newItem.id, userId, userName, finalPayload); // Use finalPayload for clean logs

        await client.query('COMMIT'); // Commit transaction
        res.status(201).json(newItem);

    } catch (error) {
        await client.query('ROLLBACK'); // Rollback on error
        logger.error({ err: error, tableName }, 'Error creating item');

        // CRITICAL: Cleanup ALL uploaded files if transaction fails
        if (filesToDeleteOnRollback.length > 0) {
            filesToDeleteOnRollback.forEach(path => deleteFile(path));
        }

        // Handle common PostgreSQL errors (e.g., unique constraint violation)
        if (error.code === '23505') {
            return res.status(409).json({ message: `A record with this unique name/ID already exists.` });
        }

        // Return the specific error from the lookup if it exists
        if (error.message.includes('Product line with name')) {
             return res.status(400).json({ message: error.message });
        }

        res.status(500).json({ message: `Error creating new ${tableName}.` });
    } finally {
        client.release();
    }
};


// UPDATE Item
exports.updateItem = (tableName) => async (req, res) => {
    const { id } = req.params;
    const data = req.body; // Contains non-file fields and file path if uploaded
    const userId = req.user.id;
    const userName = req.user.displayName;

    // Determine the specific file field for the current table
    const fileField = tableName === 'products' ? 'product_pictures' :
                      tableName === 'product_lines' ? 'attachments_raw' : null;

    // CRITICAL FIX: Arrays for files uploaded/deleted in this request
    const newlyUploadedFiles = [];
    let filesToDelete = []; // Files on disk that need to be removed (old files not retained)

    // Multer's field middleware only sets req.files on an actual multipart request — a plain
    // JSON PUT (editing fields without touching the picture/attachment) leaves it undefined.
    // Only a multipart request uses the `${fileField}_retained` convention below; a JSON request
    // instead sends the desired final path list directly as data[fileField].
    const isMultipartRequest = req.files !== undefined;

    // 1. Process NEWLY uploaded files from Multer
    if (req.files && fileField) {
        if (req.files[fileField] && Array.isArray(req.files[fileField])) {
            const newPaths = req.files[fileField].map(file => {
                newlyUploadedFiles.push(file.blobUrl); // Track for rollback
                return file.blobUrl;
            });
            // Temporarily store the new paths
            data.new_files_paths = newPaths;
        }
    }

    // 2. Retained paths sent from the frontend — validated against oldData below
    const retainedField = `${fileField}_retained`;
    const requestedRetainedPaths = Array.isArray(data[retainedField]) ? data[retainedField] : (data[retainedField] ? [data[retainedField]] : []);

    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Start transaction

        // Fetched first: retained paths are validated against this record's own files below,
        // so a request can't "claim" another record's uploaded file.
        const oldDataResult = await client.query(`SELECT * FROM ${tableName} WHERE id = $1`, [id]);
        const oldData = oldDataResult.rows[0];

        if (!oldData) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: `${tableName} with ID ${id} not found.` });
        }

        let existingDbPaths = [];
        if (fileField && oldData[fileField]) {
            try {
                existingDbPaths = JSON.parse(oldData[fileField]);
            } catch (e) {
                logger.error({ err: e }, 'Error parsing existing file paths from DB for update cleanup');
            }
        }

        let finalFilePaths;
        if (isMultipartRequest) {
            const retainedPaths = requestedRetainedPaths.filter(p => existingDbPaths.includes(p));
            finalFilePaths = [...retainedPaths, ...(data.new_files_paths || [])];
        } else if (fileField) {
            // JSON request: data[fileField], if present, already IS the desired final list of
            // existing paths (the frontend filters out anything that isn't a string path before
            // sending). Re-validate against this record's own files so a request can't "claim"
            // another record's file. If the field wasn't sent at all, leave it untouched.
            finalFilePaths = Array.isArray(data[fileField])
                ? data[fileField].filter(p => typeof p === 'string' && existingDbPaths.includes(p))
                : existingDbPaths;
        }

        if (fileField) {
            data[fileField] = JSON.stringify(finalFilePaths);
            delete data[retainedField]; // Remove the temporary retained field
            delete data.new_files_paths; // Remove the temporary new files field

            filesToDelete = existingDbPaths.filter(path => !finalFilePaths.includes(path));
        }

        // --- CRITICAL FIX START: Lookup product_line_id from name on UPDATE for 'products' table ---
        if (tableName === 'products' && data.product_line) {
            const productLineResult = await client.query(
                'SELECT id FROM product_lines WHERE name = $1',
                [data.product_line]
            );

            if (productLineResult.rows.length === 0) {
                // If the name is not found, throw an error to trigger a rollback
                throw new Error(`Product line with name "${data.product_line}" not found. Please create the Product Line first.`);
            }

            // Populate the product_line_id foreign key with the found ID
            data.product_line_id = productLineResult.rows[0].id;
        }
        // --- CRITICAL FIX END ---

        // Same allowlist as createItem — without it, request body keys map directly to SQL columns.
        const finalPayload = {};
        if (TABLE_COLUMNS[tableName]) {
            Object.keys(data).forEach(key => {
                if (TABLE_COLUMNS[tableName].includes(key)) {
                    finalPayload[key] = data[key];
                }
            });
        }

        if (Object.keys(finalPayload).length === 0 && newlyUploadedFiles.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'No valid fields or new files provided for update.' });
        }

        // Prevent an admin from demoting their own account (avoids accidental self-lockout)
        if (tableName === 'users' && String(id) === String(userId) && finalPayload.user_role && finalPayload.user_role !== 'admin') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'You cannot change your own admin role.' });
        }

        const allowedKeys = Object.keys(finalPayload);
        const setClauses = allowedKeys
            .map((key, i) => `${key} = $${i + 1}`)
            .join(', ');

        const values = allowedKeys.map(key => finalPayload[key]);

        // users has no updated_at/updated_by columns (unlike product_lines/products)
        const hasAuditColumns = tableName !== 'users';
        const setClauseFinal = hasAuditColumns
            ? (setClauses ? `${setClauses}, ` : '') + `updated_at = NOW(), updated_by = $${values.length + 1}`
            : setClauses;
        const totalValues = hasAuditColumns ? [...values, userId, id] : [...values, id];

        // 3. Update main table
        const updateQuery = `UPDATE ${tableName} SET ${setClauseFinal} WHERE id = $${totalValues.length} RETURNING *`;
        const result = await client.query(updateQuery, totalValues);

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: `${tableName} with ID ${id} not found.` });
        }

        // 4. FILE CLEANUP (Success): Delete the old files that were not retained
        if (filesToDelete.length > 0) {
            filesToDelete.forEach(path => deleteFile(path));
        }

        // 5. Audit Log (DUAL-WRITE)
        await logAction('UPDATE', tableName, id, userId, userName, { oldData, newData: finalPayload });

        await client.query('COMMIT'); // Commit transaction
        res.status(200).json(result.rows[0]);

    } catch (error) {
        await client.query('ROLLBACK'); // Rollback on error
        logger.error({ err: error, tableName }, 'Error updating item');

        // CRITICAL: Cleanup the NEWLY uploaded files if the database update failed
        if (newlyUploadedFiles.length > 0) {
            newlyUploadedFiles.forEach(path => deleteFile(path));
        }

        // Handle common PostgreSQL errors (e.g., unique constraint violation)
        if (error.code === '23505') {
            return res.status(409).json({ message: `A record with this unique name/ID already exists.` });
        }

        // Return the specific error from the lookup if it exists
        if (error.message.includes('Product line with name')) {
             return res.status(400).json({ message: error.message });
        }

        res.status(500).json({ message: `Error updating ${tableName}.` });
    } finally {
        client.release();
    }
};

// DELETE Item
exports.deleteItem = (tableName) => async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const userName = req.user.displayName;

    // Determine the specific file field for the current table
    const fileField = tableName === 'products' ? 'product_pictures' :
                      tableName === 'product_lines' ? 'attachments_raw' : null;

    const client = await pool.connect();
    let filesToDelete = null; // Changed to hold an array of paths
    try {
        await client.query('BEGIN'); // Start transaction

        // 1. Get the record's file path before deletion
        let selectQuery = `SELECT * FROM ${tableName} WHERE id = $1`;

        // FIX: Conditionally select only the relevant file field if it exists
        if (fileField) {
            selectQuery = `SELECT ${fileField} FROM ${tableName} WHERE id = $1`;
        }

        const oldDataResult = await client.query(selectQuery, [id]);
        const oldData = oldDataResult.rows[0];

        // CRITICAL FIX: Parse the JSON array and set filesToDelete
        if (oldData && fileField && oldData[fileField]) {
            try {
                filesToDelete = JSON.parse(oldData[fileField]); // filesToDelete is now an array
            } catch (e) {
                 logger.error({ err: e }, 'Error parsing existing file paths from DB for delete cleanup');
            }
        }

        // 2. Delete from main table
        const result = await client.query(`DELETE FROM ${tableName} WHERE id = $1`, [id]);

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: `${tableName} with ID ${id} not found.` });
        }

        // 3. FILE CLEANUP (Success)
        // CRITICAL FIX: Iterate and delete each file in the array
        if (Array.isArray(filesToDelete) && filesToDelete.length > 0) {
            filesToDelete.forEach(path => deleteFile(path));
        }

        // 4. Audit Log (DUAL-WRITE)
        await logAction('DELETE', tableName, id, userId, userName, { status: 'Record permanently deleted.' });

        await client.query('COMMIT'); // Commit transaction
        res.status(204).send(); // HTTP 204 No Content for successful deletion

    } catch (error) {
        await client.query('ROLLBACK'); // Rollback on error
        logger.error({ err: error, tableName }, 'Error deleting item');
        res.status(500).json({ message: `Error deleting ${tableName}.` });
    } finally {
        client.release();
    }
};
