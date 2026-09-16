const express = require('express');
const authenticate = require('../middleware/authMiddleware');
const { requireAdmin } = authenticate;
const dataController = require('../controllers/dataController');

const router = express.Router();

router.get('/', authenticate, requireAdmin, dataController.getAllItems('users'));
router.put('/:id', authenticate, requireAdmin, dataController.updateItem('users'));

module.exports = router;
