const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middleware/authMiddleware');
const multer = require('multer');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `${Date.now()}${path.extname(file.originalname)}`)
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/heic', 'image/heif'];
        allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only image files are allowed'));
    }
});

// Toggle favorite (add if not exists, remove if exists)
router.post('/toggle/:facilityId', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { facilityId } = req.params;

    try {
        const existing = await pool.query(
            'SELECT id FROM favorite WHERE user_id = $1 AND facility_id = $2',
            [userId, facilityId]
        );

        if (existing.rows.length > 0) {
            await pool.query(
                'DELETE FROM favorite WHERE user_id = $1 AND facility_id = $2',
                [userId, facilityId]
            );
            return res.json({ is_favorited: false });
        } else {
            await pool.query(
                'INSERT INTO favorite (user_id, facility_id) VALUES ($1, $2)',
                [userId, facilityId]
            );
            return res.status(201).json({ is_favorited: true });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get all favorites for the logged-in user
router.get('/', authenticateToken, async (req, res) => {
    const userId = req.user.userId;

    try {
        const result = await pool.query(
            `SELECT f.*, fav.created_at AS favorited_at
             FROM facility f
             JOIN favorite fav ON f.id = fav.facility_id
             WHERE fav.user_id = $1 AND f.is_active = true
             ORDER BY fav.created_at DESC`,
            [userId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Check if a specific facility is favorited
router.get('/check/:facilityId', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { facilityId } = req.params;

    try {
        const result = await pool.query(
            'SELECT id FROM favorite WHERE user_id = $1 AND facility_id = $2',
            [userId, facilityId]
        );
        res.json({ is_favorited: result.rows.length > 0 });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;