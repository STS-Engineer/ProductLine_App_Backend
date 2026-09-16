const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

const JWT_SECRET = process.env.JWT_SECRET;

const authenticate = (req, res, next) => {
    // Check for token in Authorization header (Bearer <token>)
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authentication required: No token provided.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

        // Attach user info to the request for controllers
        req.user = {
            id: decoded.id,
            email: decoded.email,
            displayName: decoded.displayName,
            userRole: decoded.userRole
        };
        next();
    } catch (err) {
        logger.warn({ err }, 'JWT verification failed');
        return res.status(401).json({ message: 'Invalid or expired token.' });
    }
};

const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.userRole !== 'admin') {
        return res.status(403).json({ message: 'Admin access required.' });
    }
    next();
};

module.exports = authenticate;
module.exports.requireAdmin = requireAdmin;
