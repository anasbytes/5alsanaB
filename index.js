require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT;

app.use(express.json());

const facilityRoutes = require('./routes/facilities');
const userRoutes = require('./routes/users');
const bookingRoutes = require('./routes/bookings');
const authRoutes = require('./routes/auth');

app.use('/facilities', facilityRoutes);
app.use('/users', userRoutes);
app.use('/bookings', bookingRoutes);
app.use('/auth', authRoutes);

app.get('/', (req, res) => {
    res.send('The 5alsana server is running!');
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong' });
});

app.listen(PORT, () => {
    console.log(`Server is listening to ${PORT}`);
});