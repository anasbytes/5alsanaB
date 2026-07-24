require('dotenv').config();

const requiredEnvVars = ['PORT', 'JWT_SECRET', 'DB_USER', 'DB_HOST', 'DB_NAME', 'DB_PASSWORD', 'DB_PORT'];
const missing = requiredEnvVars.filter((key) => !process.env[key]);
if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT;

if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

app.set('trust proxy', 1);
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors());
app.use(express.json());

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { error: 'Too many requests. Please try again later.' }
});
app.use(globalLimiter);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many attempts. Please try again in 15 minutes.' }
});

const facilityRoutes = require('./routes/facilities');
const userRoutes = require('./routes/users');
const bookingRoutes = require('./routes/bookings');
const authRoutes = require('./routes/auth');
const favoritesRoutes = require('./routes/favorites');
const reviewsRoutes = require('./routes/reviews');
const { router: waitlistRoutes } = require('./routes/waitlist');

const { startScheduler } = require('./utils/scheduler');
const roomsRouter = require('./routes/rooms');
const blockedSlotsRouter = require('./routes/blockedSlots');



app.use('/facilities', facilityRoutes);
app.use('/users', userRoutes);
app.use('/bookings', bookingRoutes);
app.use('/auth', authLimiter, authRoutes);
app.use('/uploads', express.static('uploads'));
app.use('/favorites', favoritesRoutes);
app.use('/reviews', reviewsRoutes);
app.use('/waitlist', waitlistRoutes);
app.use('/rooms', roomsRouter);
app.use('/blocked-slots', blockedSlotsRouter);

app.get('/', (req, res) => {
    res.send('The 5alsana server is running!');
});

app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong' });
});

app.listen(PORT, () => {
    console.log(`Server is listening to ${PORT}`);
    startScheduler();
});