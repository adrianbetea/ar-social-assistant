const express = require('express');
const authRoutes = require('./routes/auth.js');

const app = express();
const PORT = process.env.BACKEND_IP || 3000;

app.use(express.json());
app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
    res.send('AR Social Assistant Backend is running!');
});

app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});