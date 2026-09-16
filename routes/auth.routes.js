const express = require('express');
const rateLimit = require('express-rate-limit');
const authenticate = require('../middleware/authMiddleware');
const authController = require('../controllers/authController');

const router = express.Router();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many attempts, please try again later.' }
});

router.post('/signup', authLimiter, authController.signup);
router.post('/login', authLimiter, authController.login);
router.post('/logout', authenticate, authController.logout);

module.exports = router;
