require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT;

app.use(helmet());
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

app.use('/facilities', facilityRoutes);
app.use('/users', userRoutes);
app.use('/bookings', bookingRoutes);
app.use('/auth', authLimiter, authRoutes);
app.use('/uploads', express.static('uploads'));

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
});