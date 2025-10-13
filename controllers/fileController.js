const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 1. Configure Storage
// Files will be stored in a 'uploads' directory at the root of the project
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '..', 'uploads');
        // Ensure the directory exists
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath);
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        // Use fieldname-timestamp-originalname to ensure unique filenames
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

// 2. Multer Upload Middleware
// Configured to handle 'product_pictures' (Products) and 'attachments_raw' (Product Lines)
exports.upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB file size limit
    fileFilter: (req, file, cb) => {
        // Ensure only files from the expected fields are accepted
        if (file.fieldname === 'product_pictures' || file.fieldname === 'attachments_raw') {
            cb(null, true);
        } else {
            // Reject files from other field names
            cb(new Error(`Invalid fieldname: ${file.fieldname}. File rejected.`), false);
        }
    }
}).fields([
    // CRITICAL FIX: Increased maxCount to 10 to allow multiple file uploads
    { name: 'product_pictures', maxCount: 10 },
    { name: 'attachments_raw', maxCount: 10 }
]);

/**
 * Helper function to handle the deletion of a file from the file system.
 * @param {string} relativePath - The path (e.g., 'uploads/filename.ext') to delete.
 */
exports.deleteFile = (relativePath) => {
    if (!relativePath || typeof relativePath !== 'string' || !relativePath.startsWith('uploads/')) return;
    
    // Construct the absolute path: project_root/uploads/filename.ext
    const filePath = path.join(__dirname, '..', relativePath);

    // Check if file exists before attempting to delete (to prevent E_NOENT errors)
    fs.stat(filePath, (err, stats) => {
        if (err) {
            if (err.code === 'ENOENT') {
                 console.warn(`File deletion warning: File not found on disk at ${filePath}. Skipping.`);
            } else {
                console.warn(`File deletion warning: Failed to stat file at ${filePath}. Error:`, err);
            }
            return;
        }

        fs.unlink(filePath, (err) => {
            if (err) {
                console.error(`File deletion error: Failed to delete file at ${filePath}. Error:`, err);
            } else {
                console.log(`Successfully deleted file: ${filePath}`);
            }
        });
    });
};