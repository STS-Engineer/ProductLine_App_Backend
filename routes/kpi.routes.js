const express = require('express');
const authenticate = require('../middleware/authMiddleware');
const kpiController = require('../controllers/kpiController');

const router = express.Router();

router.get('/people', authenticate, kpiController.searchPeople);
router.get('/customers', authenticate, kpiController.searchCustomers);

module.exports = router;
