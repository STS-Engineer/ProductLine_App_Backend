// dataController.js

const pool = require('../config/db');
// NEW: Import the file controller for file deletion logic
const { deleteFile } = require('./fileController'); 

// --- AUDITING FUNCTION (Centralized logging) ---
exports.logAction = async (action, table_name, document_id, user_id, user_name, details = {}) => {
    try {
        await pool.query(
            'INSERT INTO audit_logs (action, table_name, document_id, user_id, user_name, details) VALUES ($1, $2, $3, $4, $5, $6)',
            [action, table_name, document_id, user_id, user_name, details]
        );
    } catch (error) {
        console.error(`CRITICAL: Failed to write audit log for ${action} on ${table_name}/${document_id}. Error:`, error);
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

        if (tableName === 'audit_logs') {
            // FIX APPLIED HERE: Filter out LOGIN and LOGOUT actions at the database level
            orderByClause = 'ORDER BY logged_at DESC';
            whereClause = "WHERE action NOT IN ('LOGIN', 'LOGOUT')";
            // OPTIMIZATION: Limit the logs to the 500 most recent records
            limitClause = 'LIMIT 500'; 
        } else if (tableName === 'users' || tableName === 'product_lines' || tableName === 'products') {
            orderByClause = 'ORDER BY created_at DESC';
        }

        // OPTIMIZATION: Append limitClause to the final query string
        const result = await pool.query(`SELECT * FROM ${tableName} ${whereClause} ${orderByClause} ${limitClause}`, queryParams);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(`Error fetching ${tableName}:`, error);
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
    
    // 1. Process uploaded files from Multer and add path array to data payload
    if (req.files) {
        // Determine the specific file field for the current table
        const fileField = tableName === 'products' ? 'product_pictures' : 
                          tableName === 'product_lines' ? 'attachments_raw' : null;

        if (fileField && req.files[fileField] && Array.isArray(req.files[fileField])) {
            const paths = req.files[fileField].map(file => {
                const path = `uploads/${file.filename}`;
                newlyUploadedFiles.push(path); // Track for rollback
                return path;
            });
            // CRITICAL: Store a JSON stringified array of paths
            data[fileField] = JSON.stringify(paths);
        }
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
        
        // ************************************************
        // ***** NEW FIX: Filter the payload to prevent 'column does not exist' errors *****
        // ************************************************
        const tableColumns = {
            products: ['product_name', 'product_line', 'description', 'product_definition', 'operating_environment', 'technical_parameters', 'machines_and_tooling', 'manufacturing_strategy', 'purchasing_strategy', 'prototypes_ppap_and_sop', 'engineering_and_testing', 'capacity', 'our_advantages', 'gmdc_pct', 'product_line_id', 'customers_in_production', 'customer_in_development', 'level_of_interest_and_why', 'estimated_price_per_product', 'prod_if_customer_in_china', 'costing_data', 'product_pictures'],
            product_lines: ['name', 'type_of_products', 'manufacturing_locations', 'design_center', 'product_line_manager', 'history', 'type_of_customers', 'metiers', 'strength', 'weakness', 'perspectives', 'compliance_resource_id', 'attachments_raw']
        };

        const finalPayload = {};
        if (tableColumns[tableName]) {
            // Only include keys from the data object that are present in the column list
            Object.keys(data).forEach(key => {
                if (tableColumns[tableName].includes(key)) {
                    finalPayload[key] = data[key];
                }
            });
        } else {
             // Fallback for unexpected tables, though unnecessary here
            Object.assign(finalPayload, data);
        }
        
        // Remove product_line for product lines data if the payload is being explicitly filtered
        if (tableName === 'products' && finalPayload.product_line) {
            // The value has already been used to look up product_line_id above, 
            // but we keep it since it's a field in the DB schema.
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
        console.error(`Error creating ${tableName}:`, error);
        
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
    
    // 1. Process NEWLY uploaded files from Multer
    if (req.files && fileField) {
        if (req.files[fileField] && Array.isArray(req.files[fileField])) {
            const newPaths = req.files[fileField].map(file => {
                const path = `uploads/${file.filename}`;
                newlyUploadedFiles.push(path); // Track for rollback
                return path;
            });
            // Temporarily store the new paths
            data.new_files_paths = newPaths; 
        }
    }

    // 2. Handle RETAINED paths sent from the frontend
    const retainedField = `${fileField}_retained`;
    // If retained paths were sent, they are a single string or an array of strings
    const retainedPaths = Array.isArray(data[retainedField]) ? data[retainedField] : (data[retainedField] ? [data[retainedField]] : []);
    
    // Combine retained paths and newly uploaded paths
    const finalFilePaths = [...retainedPaths, ...(data.new_files_paths || [])]; 
    
    // The final value to be set in the database column (JSON array string)
    if (fileField) {
        data[fileField] = JSON.stringify(finalFilePaths);
        delete data[retainedField]; // Remove the temporary retained field
        delete data.new_files_paths; // Remove the temporary new files field
    }


    // Filter out server-managed columns. 
    const allowedKeys = Object.keys(data).filter(key => 
        !['id', 'created_at', 'created_by', 'updated_at', 'updated_by'].includes(key)
    );

    if (allowedKeys.length === 0 && newlyUploadedFiles.length === 0) {
        return res.status(400).json({ message: 'No valid fields or new files provided for update.' });
    }
    
    const setClauses = allowedKeys
        .map((key, i) => `${key} = $${i + 1}`)
        .join(', ');

    const values = allowedKeys.map(key => data[key]);
    
    // Append updated_at and updated_by to the end of SET clauses
    // userId is $N+1, id is $N+2 (where N is values.length)
    const totalValues = [...values, userId, id]; 
    const setClauseFinal = (setClauses ? `${setClauses}, ` : '') + `updated_at = NOW(), updated_by = $${values.length + 1}`;
    
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Start transaction
        
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

        // 2. Get the old data for the audit log AND old file path
        const oldDataResult = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1`, [id]);
        const oldData = oldDataResult.rows[0] || {};
        
        // CRITICAL: Determine files to be deleted
        if (fileField && oldData[fileField]) {
            try {
                // Parse the existing JSON array of paths from the database
                const existingDbPaths = JSON.parse(oldData[fileField]); 
                // Files to delete are those present in the DB but NOT in the final set of files being saved (finalFilePaths)
                filesToDelete = existingDbPaths.filter(path => !finalFilePaths.includes(path));
            } catch (e) {
                console.error("Error parsing existing file paths from DB for update cleanup:", e);
            }
        }

        // 3. Update main table
        const updateQuery = `UPDATE ${tableName} SET ${setClauseFinal} WHERE id = $${values.length + 2} RETURNING *`;
        const result = await pool.query(updateQuery, totalValues);

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: `${tableName} with ID ${id} not found.` });
        }
        
        // 4. FILE CLEANUP (Success): Delete the old files that were not retained
        if (filesToDelete.length > 0) {
            filesToDelete.forEach(path => deleteFile(path));
        }

        // 5. Audit Log (DUAL-WRITE)
        await logAction('UPDATE', tableName, id, userId, userName, { oldData, newData: data });

        await client.query('COMMIT'); // Commit transaction
        res.status(200).json(result.rows[0]);

    } catch (error) {
        await client.query('ROLLBACK'); // Rollback on error
        console.error(`Error updating ${tableName}:`, error);
        
        // CRITICAL: Cleanup the NEWLY uploaded files if the database update failed
        if (newlyUploadedFiles.length > 0) {
            newlyUploadedFiles.forEach(path => deleteFile(path));
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
        
        const oldDataResult = await pool.query(selectQuery, [id]);
        const oldData = oldDataResult.rows[0];

        // CRITICAL FIX: Parse the JSON array and set filesToDelete
        if (oldData && fileField && oldData[fileField]) {
            try {
                filesToDelete = JSON.parse(oldData[fileField]); // filesToDelete is now an array
            } catch (e) {
                 console.error("Error parsing existing file paths from DB for delete cleanup:", e);
            }
        }

        // 2. Delete from main table
        const result = await pool.query(`DELETE FROM ${tableName} WHERE id = $1`, [id]);
        
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
        console.error(`Error deleting ${tableName}:`, error);
        res.status(500).json({ message: `Error deleting ${tableName}.` });
    } finally {
        client.release();
    }
};