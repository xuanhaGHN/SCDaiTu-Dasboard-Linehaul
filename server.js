const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// Environment variables or hardcoded constants
const GOOGLE_CLIENT_ID = "196922761837-1u6n4e7196jtt96n5revbgg7ag0386ud.apps.googleusercontent.com";
const JWT_SECRET = process.env.JWT_SECRET || 'ghn-super-secret-key-for-dev'; 
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1wdkjfAUmZfxczJQ72MJWySbN5qY9YWgxQjLkVRNsJYY/export?format=csv&gid=1730908608";
const ALLOWED_ORIGINS = [
    'https://xuanhaghn.github.io',
    'http://localhost:3000',
    'http://127.0.0.1:5500'
];

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

app.use(express.json());
app.use(cookieParser());
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

// Middleware to verify session
const requireAuth = (req, res, next) => {
    let token = req.cookies.ghn_session;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    }
    
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: No session token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized: Invalid session token' });
    }
};

// Verify Google Token and Issue Session
app.post('/api/auth', async (req, res) => {
    const { credential } = req.body;
    if (!credential) {
        return res.status(400).json({ error: 'Missing credential' });
    }

    try {
        // 1. Verify Google JWT signature and audience
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID
        });
        
        const payload = ticket.getPayload();
        
        // 2. Validate domain
        if (!payload.email || !payload.email.endsWith('@ghn.vn')) {
            return res.status(403).json({ error: 'Forbidden: Must use a @ghn.vn email account' });
        }

        // 3. Issue our own JWT session token
        const sessionToken = jwt.sign({
            email: payload.email,
            name: payload.name,
            sub: payload.sub
        }, JWT_SECRET, { expiresIn: '8h' });

        // 4. Set HttpOnly cookie
        res.cookie('ghn_session', sessionToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'none', // Needed for cross-origin requests
            maxAge: 8 * 60 * 60 * 1000 // 8 hours
        });

        res.json({ success: true, email: payload.email, name: payload.name, token: sessionToken });
    } catch (error) {
        console.error('Auth verification failed:', error);
        res.status(401).json({ error: 'Unauthorized: Invalid Google token' });
    }
});

// Proxy Google Sheet Data
app.get('/api/data', requireAuth, async (req, res) => {
    try {
        const response = await axios.get(SHEET_CSV_URL, {
            responseType: 'stream'
        });
        
        // Set content type and stream directly back to client
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.data.pipe(res);
    } catch (error) {
        console.error('Failed to fetch sheet data:', error);
        res.status(500).json({ error: 'Internal Server Error while fetching data' });
    }
});

// Logout
app.post('/api/logout', (req, res) => {
    res.clearCookie('ghn_session', {
        httpOnly: true,
        secure: true,
        sameSite: 'none'
    });
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`🚀 GHN Dashboard Backend running on http://localhost:${PORT}`);
});
