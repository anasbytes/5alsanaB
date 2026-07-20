const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const authenticateToken = require('../middleware/authMiddleware');
const { body, validationResult } = require('express-validator');
const fs = require('fs');
const path = require('path');

function deleteFile(imageUrl) {
    if (!imageUrl) return;
    const filename = imageUrl.split('/uploads/')[1];
    if (!filename) return;
    fs.unlink(path.join('uploads', filename), (err) => {
        if (err) console.error('Failed to delete image:', err);
    });
}

// Get a specific user (Secured: Users can only get their own data, or use 'me')
router.get('/:id', authenticateToken, async (req, res) => {
    let targetId = req.params.id;

    if (targetId === 'me') {
        targetId = req.user.userId;
    } else if (parseInt(targetId) !== req.user.userId) {
        return res.status(403).json({ error: 'Unauthorized to view this profile' });
    }

    try {
        const result = await pool.query(
            'SELECT id, username, email, phone_number, role FROM "user" WHERE id = $1',
            [targetId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update a user (Secured: Users can only update their own profile)
router.put('/:id', authenticateToken,
    body('username').optional().trim().toLowerCase().notEmpty().isLength({ max: 50 }).withMessage('Username cannot be empty and must be under 50 characters'),
    body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail().withMessage('Invalid email format'),
    body('phone_number').optional().notEmpty().isLength({ max: 20 }).withMessage('Phone number cannot be empty and must be under 20 characters'),
    body('password').optional().isLength({ min: 6, max: 72 }).withMessage('Password must be between 6 and 72 characters'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        let targetId = req.params.id;

        if (targetId === 'me') {
            targetId = req.user.userId;
        } else if (parseInt(targetId) !== req.user.userId) {
            return res.status(403).json({ error: 'Unauthorized to update this profile' });
        }

        const { username, email, phone_number, password, push_token } = req.body;

        try {
            const fields = [];
            const values = [];
            let index = 1;

            if (username !== undefined) { fields.push(`username = $${index++}`); values.push(username); }
            if (email !== undefined) { fields.push(`email = $${index++}`); values.push(email); }
            if (phone_number !== undefined) { fields.push(`phone_number = $${index++}`); values.push(phone_number); }
            if (push_token !== undefined) { fields.push(`push_token = $${index++}`); values.push(push_token); }
            if (password !== undefined) {
                const hashedPassword = await bcrypt.hash(password, 10);
                fields.push(`password = $${index++}`);
                values.push(hashedPassword);
            }

            if (fields.length === 0) {
                return res.status(400).json({ error: 'No fields to update' });
            }

            values.push(targetId);
            const result = await pool.query(
                `UPDATE "user" SET ${fields.join(', ')} WHERE id = $${index} RETURNING id, username, email, phone_number, role`,
                values
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
            res.json(result.rows[0]);
        } catch (err) {
            console.error(err);
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Username, email, or phone number is already taken.' });
            }
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// Delete a user (Secured: Users can only delete their own profile)
router.delete('/:id', authenticateToken, async (req, res) => {
    let targetId = req.params.id;

    if (targetId === 'me') {
        targetId = req.user.userId;
    } else if (parseInt(targetId) !== req.user.userId) {
        return res.status(403).json({ error: 'Unauthorized to delete this profile' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Delete all bookings made by this player
        await client.query('DELETE FROM booking WHERE user_id = $1', [targetId]);

        // 2. Delete all bookings made on facilities owned by this user (if they are a host)
        // 2. Delete all bookings made on facilities owned by this user (if they are a host)
        await client.query('DELETE FROM booking WHERE facility_id IN (SELECT id FROM facility WHERE owner_id = $1)', [targetId]);

        // 3. Delete all favorites by this user
        await client.query('DELETE FROM favorite WHERE user_id = $1', [targetId]);

        // 4. Delete all favorites on owned facilities
        await client.query('DELETE FROM favorite WHERE facility_id IN (SELECT id FROM facility WHERE owner_id = $1)', [targetId]);

        // 5. Delete all facilities created by this user (if they are a host)

        // 3. Delete all facilities created by this user (if they are a host)
        const ownedFacilities = await client.query('SELECT image_url FROM facility WHERE owner_id = $1', [targetId]);
        await client.query('DELETE FROM facility WHERE owner_id = $1', [targetId]);

        // 4. Finally, delete the user account
        const result = await client.query(
            'DELETE FROM "user" WHERE id = $1 RETURNING id, username, email, phone_number, role',
            [targetId]
        );

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User not found' });
        }

        await client.query('COMMIT');
        ownedFacilities.rows.forEach(row => deleteFile(row.image_url));
        res.json({ message: 'User deleted', user: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Account deletion error:", err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

module.exports = router;