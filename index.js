const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const mime = require('mime-types'); // ✅ CORRECT: Imported 'mime-types'

// Load environment variables (must be first)
dotenv.config();

// Ensure DB connection is initiated (though it runs on require)
require('./config/db');

// --- 1. CONFIGURATION ---
const PORT = process.env.PORT || 3001;

// --- 2. IMPORT COMPONENTS ---
const authenticate = require('./middleware/authMiddleware');
const authController = require('./controllers/authController');
const dataController = require('./controllers/dataController'); 
const fileController = require('./controllers/fileController');

const app = express();

// --- 3. MIDDLEWARE ---
// Define the single allowed production origin (must use HTTPS)
const PRODUCTION_URL = 'https://product-db.azurewebsites.net';

// 1. Configure CORS
// Only allow requests from the production URL
app.use(cors({
  origin: 'https://product-db.azurewebsites.net',  // frontend domain
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' })); 

// 2. CRITICAL FIX: Add headers to allow file content to be viewed in an iframe 
app.use((req, res, next) => {
    // 1. Remove X-Frame-Options to allow framing
    res.removeHeader('X-Frame-Options'); 
    
    // 2. Set Content-Security-Policy header to allow content in iframes.
    // Frame-ancestors is restricted to 'self' (the API domain) and the PRODUCTION_URL
    res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${PRODUCTION_URL}`);
    next();
});

// 3. Serve static files with correct MIME types for the Google Viewer
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    setHeaders: (res, filePath, stat) => {
        const mimeType = mime.lookup(filePath); 
        if (mimeType) {
            res.setHeader('Content-Type', mimeType);
        }
    }
}));

// --- 4. ROUTES ---
app.get('/', (req, res) => {
    res.status(200).send({ message: "Product CRUD API is running and connected to PostgreSQL." });
});

// --- PUBLIC AUTH ROUTES ---
app.post('/api/auth/signup', authController.signup);
app.post('/api/auth/login', authController.login);
app.post('/api/auth/logout', authenticate, authController.logout);


// Logs endpoint (Requires Auth, Read-Only)
app.get('/api/audit_logs', authenticate, dataController.getAllItems('audit_logs'));

// --- PROTECTED CRUD ROUTES (ALL require authentication) ---

// Product Lines Routes
app.get('/api/product_lines', authenticate, dataController.getAllItems('product_lines'));
app.post('/api/product_lines', authenticate, fileController.upload, dataController.createItem('product_lines'));
app.put('/api/product_lines/:id', authenticate, fileController.upload, dataController.updateItem('product_lines'));
app.delete('/api/product_lines/:id', authenticate, dataController.deleteItem('product_lines'));

// Products Routes
app.get('/api/products', authenticate, dataController.getAllItems('products'));
app.post('/api/products', authenticate, fileController.upload, dataController.createItem('products'));
app.put('/api/products/:id', authenticate, fileController.upload, dataController.updateItem('products'));
app.delete('/api/products/:id', authenticate, dataController.deleteItem('products'));


// --- 5. START SERVER ---
app.listen(PORT, () => {
    console.log(`[API] Server listening on http://localhost:${PORT}`);
});
