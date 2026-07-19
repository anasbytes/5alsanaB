const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

router.post('/register',
    body('username').trim().toLowerCase().notEmpty().isLength({ max: 50 }).withMessage('Username is required and must be under 50 characters'),
    body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail().withMessage('Invalid email format'),
    body('phone_number').trim().notEmpty().isLength({ max: 20 }).withMessage('Phone number is required and must be under 20 characters'),
    body('password').isLength({ min: 6, max: 72 }).withMessage('Password must be between 6 and 72 characters'),
    body('role').optional().isIn(['player', 'host']).withMessage('Role must be player or host'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { username, email, phone_number, password, role } = req.body;
        try {
            const finalEmail = email || null;
            const finalRole = role || 'player';
            const hashedPassword = await bcrypt.hash(password, 10);
            const result = await pool.query(
                'INSERT INTO "user" (username, email, phone_number, password, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, phone_number, role',
                [username, finalEmail, phone_number, hashedPassword, finalRole]
            );
            const user = result.rows[0];
            const token = jwt.sign(
                { userId: user.id, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );
            res.status(201).json({ user, token });
        } catch (err) {
            console.error(err);
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Username, email, or phone number is already taken.' });
            }
            res.status(500).json({ error: 'Server error during registration.' });
        }
    }
);

router.post('/login',
    body('identifier').trim().toLowerCase().notEmpty().withMessage('Username or phone number is required'),
    body('password').notEmpty().withMessage('Password is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { identifier, password } = req.body;
        try {
            const result = await pool.query(
                'SELECT * FROM "user" WHERE username = $1 OR phone_number = $1',
                [identifier]
            );
            if (result.rows.length === 0) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            const user = result.rows[0];
            const validPassword = await bcrypt.compare(password, user.password);
            if (!validPassword) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            const token = jwt.sign(
                { userId: user.id, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );
            res.json({
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    phone_number: user.phone_number,
                    role: user.role
                },
                token
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error during login.' });
        }
    }
);

module.exports = router;