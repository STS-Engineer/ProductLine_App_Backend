const express = require('express');
const authenticate = require('../middleware/authMiddleware');
const { requireAdmin } = authenticate;
const dataController = require('../controllers/dataController');

const router = express.Router();

router.get('/', authenticate, requireAdmin, dataController.getAllItems('audit_logs'));

module.exports = router;
