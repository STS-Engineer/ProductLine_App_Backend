const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { BlobServiceClient } = require('@azure/storage-blob');
const logger = require('../config/logger');

const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER;
const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

// Files are buffered in memory, then uploaded to blob storage by the middleware below —
// nothing is written to local disk.
const storage = multer.memoryStorage();

// Rejects anything not in this list (e.g. .html/.svg that could be served back as script)
const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'];

const uploadMiddleware = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB file size limit
    fileFilter: (req, file, cb) => {
        // Ensure only files from the expected fields are accepted
        if (file.fieldname !== 'product_pictures' && file.fieldname !== 'attachments_raw') {
            return cb(new Error(`Invalid fieldname: ${file.fieldname}. File rejected.`), false);
        }

        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype) || !ALLOWED_EXTENSIONS.includes(ext)) {
            return cb(new Error(`File type not allowed: ${file.mimetype || ext}.`), false);
        }

        cb(null, true);
    }
}).fields([
    { name: 'product_pictures', maxCount: 10 },
    { name: 'attachments_raw', maxCount: 10 }
]);

// After multer buffers the files, upload each to blob storage and attach the resulting
// public URL as file.blobUrl so controllers never touch the filesystem or the SDK directly.
const uploadToBlob = async (req, res, next) => {
    try {
        if (!req.files) return next();

        const fields = Object.keys(req.files);
        for (const field of fields) {
            for (const file of req.files[field]) {
                const blobName = `${crypto.randomUUID()}${path.extname(file.originalname)}`;
                const blockBlobClient = containerClient.getBlockBlobClient(blobName);
                await blockBlobClient.uploadData(file.buffer, {
                    blobHTTPHeaders: { blobContentType: file.mimetype }
                });
                file.blobUrl = blockBlobClient.url;
            }
        }
        next();
    } catch (error) {
        logger.error({ err: error }, 'Error uploading file(s) to blob storage');
        res.status(500).json({ message: 'Failed to upload file(s).' });
    }
};

exports.upload = [uploadMiddleware, uploadToBlob];

/**
 * Deletes a blob given its full public URL (as stored in the DB).
 * @param {string} blobUrl
 */
exports.deleteFile = async (blobUrl) => {
    if (!blobUrl || typeof blobUrl !== 'string' || !blobUrl.startsWith(containerClient.url)) return;

    try {
        const blobName = blobUrl.substring(containerClient.url.length + 1);
        await containerClient.getBlockBlobClient(blobName).deleteIfExists();
    } catch (error) {
        logger.error({ err: error, blobUrl }, 'File deletion error');
    }
};

exports.CONTAINER_URL = containerClient.url;
