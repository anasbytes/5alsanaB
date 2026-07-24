const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middleware/authMiddleware');
const { body, validationResult } = require('express-validator');

function requireHost(req, res, next) {
    if (req.user.role !== 'host') return res.status(403).json({ error: 'Hosts only' });
    next();
}

// GET /blocked-slots/facility/:facilityId — public, used by calendar to mark blocked dates
router.get('/facility/:facilityId', async (req, res) => {
    const { facilityId } = req.params;
    const { room_id } = req.query;
    try {
        let query = `SELECT * FROM blocked_slot WHERE facility_id = $1`;
        const params = [facilityId];
        if (room_id) { query += ` AND (room_id = $2 OR room_id IS NULL)`; params.push(room_id); }
        query += ` ORDER BY blocked_date ASC`;
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// POST /blocked-slots — host creates a block
router.post('/', authenticateToken, requireHost,
    body('facility_id').isInt(),
    body('blocked_date').isDate(),
    body('is_full_day').isBoolean(),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        const { facility_id, room_id, blocked_date, start_time, end_time, reason, is_full_day } = req.body;
        const ownerId = req.user.userId;
        try {
            const check = await pool.query(
                'SELECT id FROM facility WHERE id = $1 AND owner_id = $2',
                [facility_id, ownerId]
            );
            if (check.rows.length === 0) return res.status(403).json({ error: 'Unauthorized' });
            const result = await pool.query(
                `INSERT INTO blocked_slot (facility_id, room_id, blocked_date, start_time, end_time, reason, is_full_day)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                [facility_id, room_id || null, blocked_date, is_full_day ? null : start_time, is_full_day ? null : end_time, reason || null, is_full_day]
            );
            res.status(201).json(result.rows[0]);
        } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
    }
);

// DELETE /blocked-slots/:id — host removes a block
router.delete('/:id', authenticateToken, requireHost, async (req, res) => {
    const { id } = req.params;
    const ownerId = req.user.userId;
    try {
        const result = await pool.query(
            `DELETE FROM blocked_slot USING facility
             WHERE blocked_slot.id = $1 AND blocked_slot.facility_id = facility.id AND facility.owner_id = $2
             RETURNING blocked_slot.*`,
            [id, ownerId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found or unauthorized' });
        res.json({ message: 'Deleted', slot: result.rows[0] });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;