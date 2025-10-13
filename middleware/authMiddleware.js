const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
    // Check for token in Authorization header (Bearer <token>)
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authentication required: No token provided.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // Verify the token using the secret from the .env file
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Attach user info to the request for controllers
        req.user = { 
            id: decoded.id, 
            email: decoded.email,
            displayName: decoded.displayName 
        };
        next();
    } catch (err) {
        console.error("JWT Verification failed:", err);
        return res.status(401).json({ message: 'Invalid or expired token.' });
    }
};

module.exports = authenticate;