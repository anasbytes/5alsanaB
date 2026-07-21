const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middleware/authMiddleware');
const { body, validationResult } = require('express-validator');

router.post('/', authenticateToken,
    body('facility_id').isInt().withMessage('Valid facility ID required'),
    body('booking_id').isInt().withMessage('Valid booking ID required'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1-5'),
    body('comment').optional({ checkFalsy: true }).isLength({ max: 500 }).withMessage('Comment must be under 500 characters'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const userId = req.user.userId;
        const { facility_id, booking_id, rating, comment } = req.body;

        try {
            const bookingCheck = await pool.query(
                `SELECT id FROM booking 
                 WHERE id = $1 AND user_id = $2 AND facility_id = $3
                 AND (status = 'completed' OR booking_date < CURRENT_DATE OR (booking_date = CURRENT_DATE AND end_time < CURRENT_TIME))`,
                [booking_id, userId, facility_id]
            );

            if (bookingCheck.rows.length === 0) {
                return res.status(403).json({ error: 'You can only review facilities you have completed a booking for.' });
            }

            const result = await pool.query(
                `INSERT INTO review (user_id, facility_id, booking_id, rating, comment)
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [userId, facility_id, booking_id, rating, comment || null]
            );

            res.status(201).json(result.rows[0]);
        } catch (err) {
            if (err.code === '23505') {
                return res.status(409).json({ error: 'You have already reviewed this booking.' });
            }
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

router.get('/facility/:facilityId', async (req, res) => {
    const { facilityId } = req.params;
    try {
        const result = await pool.query(
            `SELECT r.id, r.rating, r.comment, r.created_at, u.username
             FROM review r
             JOIN "user" u ON r.user_id = u.id
             WHERE r.facility_id = $1
             ORDER BY r.created_at DESC`,
            [facilityId]
        );

        const avgResult = await pool.query(
            'SELECT ROUND(AVG(rating)::numeric, 1) AS average, COUNT(*) AS total FROM review WHERE facility_id = $1',
            [facilityId]
        );

        res.json({
            reviews: result.rows,
            average: parseFloat(avgResult.rows[0].average) || 0,
            total: parseInt(avgResult.rows[0].total)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/check/:bookingId', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { bookingId } = req.params;
    try {
        const result = await pool.query(
            'SELECT id FROM review WHERE booking_id = $1 AND user_id = $2',
            [bookingId, userId]
        );
        res.json({ has_reviewed: result.rows.length > 0 });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;