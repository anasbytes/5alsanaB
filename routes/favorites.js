const express = require('express');
const router = express.Router();
const pool = require('../db'); // Adjust this path if your db connection file is named differently
const authenticateToken = require('../middleware/auth'); // Adjust this path to your JWT middleware

// 1. Toggle Favorite (Add or Remove)
router.post('/toggle/:facility_id', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const facilityId = req.params.facility_id;

    try {
        // Check if it's already favorited
        const checkFav = await pool.query(
            'SELECT * FROM favorites WHERE user_id = $1 AND facility_id = $2',
            [userId, facilityId]
        );

        if (checkFav.rows.length > 0) {
            // It exists! So we remove it (Unfavorite)
            await pool.query(
                'DELETE FROM favorites WHERE user_id = $1 AND facility_id = $2',
                [userId, facilityId]
            );
            return res.json({ message: 'Removed from favorites', is_favorited: false });
        } else {
            // It doesn't exist! So we add it (Favorite)
            await pool.query(
                'INSERT INTO favorites (user_id, facility_id) VALUES ($1, $2)',
                [userId, facilityId]
            );
            return res.status(201).json({ message: 'Added to favorites', is_favorited: true });
        }
    } catch (error) {
        console.error('Error toggling favorite:', error);
        res.status(500).json({ error: 'Server error toggling favorite' });
    }
});

// 2. Get all Favorites for the logged-in user
router.get('/', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        const result = await pool.query(
            `SELECT f.*, fav.created_at as favorited_at 
             FROM facilities f
             JOIN favorites fav ON f.id = fav.facility_id
             WHERE fav.user_id = $1
             ORDER BY fav.created_at DESC`,
            [userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching favorites:', error);
        res.status(500).json({ error: 'Server error fetching favorites' });
    }
});

// 3. Check if a specific facility is favorited (useful for initial UI load)
router.get('/check/:facility_id', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const facilityId = req.params.facility_id;

    try {
        const result = await pool.query(
            'SELECT * FROM favorites WHERE user_id = $1 AND facility_id = $2',
            [userId, facilityId]
        );
        res.json({ is_favorited: result.rows.length > 0 });
    } catch (error) {
        console.error('Error checking favorite status:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;