const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// This function is imported from dataController.js
const logAction = require('./dataController').logAction; 

const SALT_ROUNDS = 10;
// Hardcoded JWT Secret (Copied from .env)
const JWT_SECRET_HARDCODED = 'YOUR_COMPLEX_JWT_SECRET_HERE_A8G9F2J3L4K5P6'; 

// --- Helper function to generate a JWT ---
const generateToken = (user) => {
    // CRITICAL: Ensure user_role is included in the token payload
    return jwt.sign(
        { id: user.id, email: user.email, displayName: user.display_name, userRole: user.user_role },
        JWT_SECRET_HARDCODED,
        { expiresIn: '1h' } // Token expires in 1 hour
    );
};

// --- SIGN UP ---
exports.signup = async (req, res) => {
    const { email, password, displayName } = req.body;
    
    if (!email || !password || !displayName) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    const client = await pool.connect();
    try {
        // 1. Check if user already exists
        const userCheck = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userCheck.rows.length > 0) {
            return res.status(409).json({ message: 'User already exists.' });
        }

        // 2. Hash password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // 3. Insert new user (role defaults to 'user' in the database schema)
        const result = await client.query(
            'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name, user_role',
            [email, hashedPassword, displayName]
        );
        const user = result.rows[0];

        // 4. Generate JWT
        const token = generateToken(user);

        // 5. Audit Log (SIGNUP)
        await logAction('SIGNUP', 'users', user.id, user.id, user.display_name, { email: user.email, role: user.user_role });

        // CRITICAL FIX: Ensure user_role is returned in the response payload
        res.status(201).json({ token, user: { id: user.id, email: user.email, displayName: user.display_name, user_role: user.user_role } });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ message: 'Server error during sign up.' });
    } finally {
        client.release();
    }
};

// --- LOG IN ---

exports.login = async (req, res) => {
    console.log('[LOGIN] Request received from origin:', req.headers.origin);
    console.log('[LOGIN] Request body:', req.body);
    
    const { email, password } = req.body;
    
    if (!email || !password) {
        console.log('[LOGIN] Missing credentials');
        return res.status(400).json({ message: 'Email and password are required.' });
    }

    const client = await pool.connect();
    try {
        console.log('[LOGIN] Querying database for user:', email);
        
        // 1. Find user by email. CRITICAL: Select 'user_role' here
        const result = await client.query('SELECT id, email, password_hash, display_name, user_role FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            console.log('[LOGIN] User not found');
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        // 2. Compare password hash
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            console.log('[LOGIN] Password mismatch');
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        console.log('[LOGIN] Authentication successful for user:', user.email);

        // 3. Generate JWT
        const token = generateToken(user);

        // 4. Audit Log (LOGIN)
        await logAction('LOGIN', 'users', user.id, user.id, user.display_name, { email: user.email, role: user.user_role });
        
        console.log('[LOGIN] Sending response with token');
        
        // CRITICAL FIX: Ensure user_role is returned in the response payload
        res.status(200).json({ token, user: { id: user.id, email: user.email, displayName: user.display_name, user_role: user.user_role } });
    } catch (error) {
        console.error('[LOGIN] Error:', error);
        res.status(500).json({ message: 'Server error during login.' });
    } finally {
        client.release();
    }
};
// --- LOG OUT ---
exports.logout = async (req, res) => {
    const userId = req.user.id;
    const userName = req.user.displayName;
    
    try {
        await logAction('LOGOUT', 'users', userId, userId, userName, { message: 'User logged out.' });
        res.status(200).json({ message: 'Logout successfully logged.' });

    } catch (error) {
        console.error('Logout logging error:', error);
        res.status(202).json({ message: 'Logout registered, but failed to log to audit table.' });
    }
};
