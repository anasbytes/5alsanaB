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
        const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
        if (!allowed.includes(path.extname(file.originalname).toLowerCase())) {
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

    try {
        const result = await pool.query(
            'SELECT * FROM facility WHERE is_active = true ORDER BY id DESC LIMIT $1 OFFSET $2',
            [limit, offset]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/', authenticateToken, requireHost, upload.single('image'),
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('type').trim().notEmpty().withMessage('Type is required'),
    body('type').isIn(['football', 'basketball', 'padel', 'ping pong', 'playstation']).withMessage('Invalid facility type'),
    body('location').trim().notEmpty().withMessage('Location is required'),
    body('price_per_hour').isFloat({ min: 0 }).withMessage('Valid price is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { name, type, location, price_per_hour, latitude, longitude, description } = req.body;
        const owner_id = req.user.userId;
        
        let image_url = null;
        if (req.file) {
            image_url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        }

        try {
            const result = await pool.query(
                'INSERT INTO facility (name, type, location, price_per_hour, image_url, owner_id, is_active, latitude, longitude, description) VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9) RETURNING *',
                [name, type, location, price_per_hour, image_url, owner_id, latitude || null, longitude || null, description || null]
            );
            res.status(201).json(result.rows[0]);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

router.get('/owner/me', authenticateToken, async (req, res) => {
    const ownerId = req.user.userId;
    try {
        const result = await pool.query('SELECT * FROM facility WHERE owner_id = $1 AND is_active = true ORDER BY id DESC', [ownerId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM facility WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Facility not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.put('/:id', authenticateToken, requireHost, upload.single('image'),
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('type').trim().notEmpty().withMessage('Type is required'),
    body('type').isIn(['football', 'basketball', 'padel', 'ping pong', 'playstation']).withMessage('Invalid facility type'),
    body('location').trim().notEmpty().withMessage('Location is required'),
    body('price_per_hour').isFloat({ min: 0 }).withMessage('Valid price is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        
        const { id } = req.params;
        const { name, type, location, price_per_hour, existing_image_url, latitude, longitude, description } = req.body;

        let image_url = existing_image_url || null;
        if (req.file) {
            image_url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        }

        try {
            const result = await pool.query(
                'UPDATE facility SET name = $1, type = $2, location = $3, price_per_hour = $4, image_url = $5, latitude = $6, longitude = $7, description = $8 WHERE id = $9 AND owner_id = $10 AND is_active = true RETURNING *',
                [name, type, location, price_per_hour, image_url, latitude || null, longitude || null, description || null, id, req.user.userId]
            );
            if (result.rows.length === 0) return res.status(404).json({ error: 'Facility not found or unauthorized' });
            if (req.file && existing_image_url) {
                deleteFile(existing_image_url);
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
        res.json({ message: 'Facility deactivated successfully', facility: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;