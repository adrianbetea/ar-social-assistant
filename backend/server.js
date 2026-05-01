const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth.js');
const userConfigRoutes = require('./routes/user-config.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/user', userConfigRoutes);

app.get('/', (req, res) => {
    res.send('AR Social Assistant Backend is running!');
});

app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});