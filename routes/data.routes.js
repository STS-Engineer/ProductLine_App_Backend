const express = require('express');
const authenticate = require('../middleware/authMiddleware');
const { requireAdmin } = authenticate;
const dataController = require('../controllers/dataController');
const fileController = require('../controllers/fileController');

const router = express.Router();

// product_lines and products share the same generic CRUD pattern, just a different table name
function registerCrud(path, tableName) {
    router.get(`/${path}`, authenticate, dataController.getAllItems(tableName));
    router.post(`/${path}`, authenticate, fileController.upload, dataController.createItem(tableName));
    router.put(`/${path}/:id`, authenticate, fileController.upload, dataController.updateItem(tableName));
    router.delete(`/${path}/:id`, authenticate, requireAdmin, dataController.deleteItem(tableName));
}

registerCrud('product_lines', 'product_lines');
registerCrud('products', 'products');

module.exports = router;
