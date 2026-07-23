const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middleware/authMiddleware');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: function (req, file, cb) {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/heic', 'image/heif'];
        if (!allowed.includes(file.mimetype)) {
            return cb(new Error('Only image files are allowed'));
        }
        cb(null, true);
    }
});

function requireHost(req, res, next) {
    if (req.user.role !== 'host') {
        return res.status(403).json({ error: 'Only hosts can perform this action' });
    }
    next();
}

function handleUpload(req, res, next) {
    upload.array('images', 10)(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'Each image must be under 5MB.' });
            }
            return res.status(400).json({ error: err.message });
        } else if (err) {
            return res.status(400).json({ error: err.message });
        }
        next();
    });
}

function deleteFile(imageUrl) {
    if (!imageUrl) return;
    const filename = imageUrl.split('/uploads/')[1];
    if (!filename) return;
    fs.unlink(path.join('uploads', filename), (err) => {
        if (err) console.error('Failed to delete old image:', err);
    });
}

router.get('/', async (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    const { type, search } = req.query;

    const conditions = ['is_active = true'];
    const params = [];
    let paramIndex = 1;

    if (type && type.toLowerCase() !== 'all') {
        conditions.push(`LOWER(type) = LOWER($${paramIndex++})`);
        params.push(type);
    }

    if (search && search.trim()) {
        const escapedSearch = search.trim().replace(/[%_\\]/g, '\\$&');
        conditions.push(`(LOWER(name) LIKE LOWER($${paramIndex}) ESCAPE '\\' OR LOWER(location) LIKE LOWER($${paramIndex}) ESCAPE '\\')`);
        params.push(`%${escapedSearch}%`);
        paramIndex++;
    }

    params.push(limit, offset);

    try {
        const result = await pool.query(
            `SELECT f.*, 
        COALESCE(json_agg(fi.image_url ORDER BY fi.display_order) FILTER (WHERE fi.image_url IS NOT NULL), '[]') AS images,
        ROUND(AVG(r.rating)::numeric, 1) AS avg_rating,
        COUNT(r.id) AS review_count
     FROM facility f
     LEFT JOIN facility_image fi ON fi.facility_id = f.id
     LEFT JOIN review r ON r.facility_id = f.id
     WHERE ${conditions.join(' AND ')}
     GROUP BY f.id
     ORDER BY f.id DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
            params
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/', authenticateToken, requireHost, handleUpload,
    body('name').trim().notEmpty().isLength({ max: 100 }).withMessage('Name is required and must be under 100 characters'),
    body('type').trim().notEmpty().withMessage('Type is required'),
    body('type').isIn(['football', 'basketball', 'padel', 'ping pong', 'playstation']).withMessage('Invalid facility type'),
    body('location').trim().notEmpty().isLength({ max: 200 }).withMessage('Location is required and must be under 200 characters'),
    body('price_per_hour').isFloat({ min: 0 }).withMessage('Valid price is required'),
    body('description').optional({ checkFalsy: true }).isLength({ max: 1000 }).withMessage('Description must be under 1000 characters'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { name, type, location, price_per_hour, latitude, longitude, description } = req.body;
        const owner_id = req.user.userId;

        const imageUrls = (req.files || []).map(f => `${req.protocol}://${req.get('host')}/uploads/${f.filename}`);

        try {
            const result = await pool.query(
                'INSERT INTO facility (name, type, location, price_per_hour, owner_id, is_active, latitude, longitude, description) VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8) RETURNING *',
                [name, type, location, price_per_hour, owner_id, latitude || null, longitude || null, description || null]
            );
            const facility = result.rows[0];
            for (let i = 0; i < imageUrls.length; i++) {
                await pool.query(
                    'INSERT INTO facility_image (facility_id, image_url, display_order) VALUES ($1, $2, $3)',
                    [facility.id, imageUrls[i], i]
                );
            }
            res.status(201).json(facility);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

router.get('/owner/me', authenticateToken, async (req, res) => {
    const ownerId = req.user.userId;
    try {
        const result = await pool.query(
            `SELECT f.*, COALESCE(json_agg(fi.image_url ORDER BY fi.display_order) FILTER (WHERE fi.image_url IS NOT NULL), '[]') AS images,
        ROUND(AVG(r.rating)::numeric, 1) AS avg_rating,
        COUNT(r.id) AS review_count
     FROM facility f
     LEFT JOIN facility_image fi ON fi.facility_id = f.id
     LEFT JOIN review r ON r.facility_id = f.id
     WHERE f.owner_id = $1 AND f.is_active = true
     GROUP BY f.id
     ORDER BY f.id DESC`,
            [ownerId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            `SELECT f.*, 
        COALESCE(json_agg(fi.image_url ORDER BY fi.display_order) FILTER (WHERE fi.image_url IS NOT NULL), '[]') AS images,
        ROUND(AVG(r.rating)::numeric, 1) AS avg_rating,
        COUNT(r.id) AS review_count
     FROM facility f
     LEFT JOIN facility_image fi ON fi.facility_id = f.id
     LEFT JOIN review r ON r.facility_id = f.id
     WHERE f.id = $1
     GROUP BY f.id`,
            [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Facility not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.put('/:id', authenticateToken, requireHost, handleUpload,
    body('name').trim().notEmpty().isLength({ max: 100 }).withMessage('Name is required and must be under 100 characters'),
    body('type').trim().notEmpty().withMessage('Type is required'),
    body('type').isIn(['football', 'basketball', 'padel', 'ping pong', 'playstation']).withMessage('Invalid facility type'),
    body('location').trim().notEmpty().isLength({ max: 200 }).withMessage('Location is required and must be under 200 characters'),
    body('price_per_hour').isFloat({ min: 0 }).withMessage('Valid price is required'),
    body('description').optional({ checkFalsy: true }).isLength({ max: 1000 }).withMessage('Description must be under 1000 characters'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { id } = req.params;
        const { name, type, location, price_per_hour, latitude, longitude, description } = req.body;

        const newImageUrls = (req.files || []).map(f => `${req.protocol}://${req.get('host')}/uploads/${f.filename}`);

        try {
            const result = await pool.query(
                'UPDATE facility SET name = $1, type = $2, location = $3, price_per_hour = $4, latitude = $5, longitude = $6, description = $7 WHERE id = $8 AND owner_id = $9 AND is_active = true RETURNING *',
                [name, type, location, price_per_hour, latitude || null, longitude || null, description || null, id, req.user.userId]
            );
            if (result.rows.length === 0) return res.status(404).json({ error: 'Facility not found or unauthorized' });

            const newImageUrls = (req.files || []).map(f => `${req.protocol}://${req.get('host')}/uploads/${f.filename}`);
            const existingImages = JSON.parse(req.body.existing_images || '[]');

            const currentImages = await pool.query('SELECT image_url FROM facility_image WHERE facility_id = $1', [id]);
            const currentUrls = currentImages.rows.map(r => r.image_url);
            const toDelete = currentUrls.filter(url => !existingImages.includes(url));
            for (const url of toDelete) deleteFile(url);
            if (toDelete.length > 0) {
                await pool.query('DELETE FROM facility_image WHERE facility_id = $1 AND image_url = ANY($2)', [id, toDelete]);
            }

            let nextOrder = existingImages.length;
            for (let i = 0; i < newImageUrls.length; i++) {
                await pool.query(
                    'INSERT INTO facility_image (facility_id, image_url, display_order) VALUES ($1, $2, $3)',
                    [id, newImageUrls[i], nextOrder++]
                );
            }

            res.json(result.rows[0]);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

router.delete('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'UPDATE facility SET is_active = false WHERE id = $1 AND owner_id = $2 RETURNING *',
            [id, req.user.userId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Facility not found or unauthorized' });
        const imgs = await pool.query('SELECT image_url FROM facility_image WHERE facility_id = $1', [id]);
        for (const row of imgs.rows) deleteFile(row.image_url);
        res.json({ message: 'Facility deactivated successfully', facility: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;