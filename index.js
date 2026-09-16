const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const multer = require('multer');
const pinoHttp = require('pino-http');

// Load environment variables (must be first)
dotenv.config();

const logger = require('./config/logger');

// Ensure DB connection is initiated (though it runs on require)
require('./config/db');

// --- 1. CONFIGURATION ---
const PORT = process.env.PORT || 3001;

// --- 2. IMPORT ROUTES ---
const authRoutes = require('./routes/auth.routes');
const dataRoutes = require('./routes/data.routes');
const usersRoutes = require('./routes/users.routes');
const auditRoutes = require('./routes/audit.routes');
const kpiRoutes = require('./routes/kpi.routes');

const app = express();

// --- 3. MIDDLEWARE ---
app.use(pinoHttp({ logger }));

// CSP/frameguard disabled here — the iframe-embedding middleware below sets its own
app.use(helmet({ contentSecurityPolicy: false, frameguard: false }));

// Define the single allowed production origin (must use HTTPS)
const FRONTEND_URL = 'https://product-db.azurewebsites.net';
const allowedOrigins = [FRONTEND_URL, 'https://docs.google.com', 'http://localhost:3000'];
// Add logging to verify CORS is working
logger.info({ frontendUrl: FRONTEND_URL }, '[CORS] Allowing origin');

// More permissive CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);

    // Allow your frontend
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    logger.warn({ origin }, '[CORS] Origin blocked');
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200 // Some legacy browsers choke on 204
}));

// Ensure Express responds to any preflight before other middleware kicks in
app.options('*', (req, res) => {
  if (allowedOrigins.includes(req.headers.origin)) {
    res.header('Access-Control-Allow-Origin', req.headers.origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// If some upstream later returns 405 to OPTIONS, this belt-and-suspenders handler prevents it:
app.use((req, res, next) => {
   if (req.method === 'OPTIONS') {
     return res.sendStatus(204);
   }
   next();
});

app.use(express.json({ limit: '10mb' })); 

// 2. CRITICAL FIX: Add headers to allow file content to be viewed in an iframe 
app.use((req, res, next) => {
    // 1. Remove X-Frame-Options to allow framing
    res.removeHeader('X-Frame-Options'); 
    
    // 2. Set Content-Security-Policy header to allow content in iframes.
    res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${FRONTEND_URL} https://docs.google.com`);
    next();
});

// --- 4. ROUTES ---
app.get('/', (req, res) => {
    res.status(200).send({ message: "Product CRUD API is running and connected to PostgreSQL." });
});

app.use('/api/auth', authRoutes);
app.use('/api/audit_logs', auditRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/kpi', kpiRoutes);
app.use('/api', dataRoutes);

// Centralized error handler — catches multer/file-filter rejections and anything else
// passed via next(err) that a route didn't already handle itself.
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || (err && /file type not allowed|invalid fieldname/i.test(err.message || ''))) {
        logger.warn({ err }, 'Upload rejected');
        return res.status(400).json({ message: err.message });
    }
    logger.error({ err }, 'Unhandled error');
    res.status(500).json({ message: 'Internal server error.' });
});

// --- 5. START SERVER ---
app.listen(PORT, () => {
    logger.info({ port: PORT }, '[API] Server listening');
});
