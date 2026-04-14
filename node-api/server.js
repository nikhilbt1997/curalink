const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PYTHON_API = process.env.PYTHON_API_URL || 'http://localhost:8000';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/curalink';
const PORT = process.env.PORT || 3001;

// ── MONGODB SCHEMA ────────────────────────────────────────────────────────────

mongoose.connect(MONGO_URI).then(() => console.log('MongoDB connected')).catch(console.error);

const MessageSchema = new mongoose.Schema({
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const ConversationSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, unique: true },
    patientName: { type: String, default: '' },
    disease: { type: String, default: '' },
    location: { type: String, default: '' },
    messages: [MessageSchema],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Conversation = mongoose.model('Conversation', ConversationSchema);

// ── ROUTES ────────────────────────────────────────────────────────────────────

// Create or get session
app.post('/api/session', async (req, res) => {
    try {
        const { sessionId, patientName, disease, location } = req.body;
        let conv = await Conversation.findOne({ sessionId });

        if (!conv) {
            conv = new Conversation({ sessionId, patientName, disease, location, messages: [] });
            await conv.save();
        }

        res.json({ sessionId: conv.sessionId, messages: conv.messages });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Main research query
app.post('/api/research', async (req, res) => {
    try {
        const { sessionId, disease, query, location, patientName } = req.body;

        if (!disease || !query) {
            return res.status(400).json({ error: 'Disease and query are required' });
        }

        // Get conversation history
        let conv = await Conversation.findOne({ sessionId });
        if (!conv) {
            conv = new Conversation({ sessionId: sessionId || `session_${Date.now()}`, patientName, disease, location, messages: [] });
        }

        // Update disease/location if provided
        if (disease) conv.disease = disease;
        if (location) conv.location = location;

        const history = conv.messages.slice(-6).map(m => ({
            role: m.role,
            content: m.content
        }));

        // Save user message
        conv.messages.push({ role: 'user', content: query });
        conv.updatedAt = new Date();

        // Call Python research engine
        const pythonResp = await axios.post(`${PYTHON_API}/research`, {
            disease: conv.disease || disease,
            query,
            location: conv.location || location || '',
            patient_name: patientName || conv.patientName || '',
            conversation_history: history
        }, { timeout: 90000 });

        const { answer, publications, clinical_trials, sources_used } = pythonResp.data;

        // Save assistant response
        conv.messages.push({ role: 'assistant', content: answer });
        await conv.save();

        res.json({
            answer,
            publications,
            clinical_trials,
            sources_used,
            sessionId: conv.sessionId,
            disease: conv.disease
        });

    } catch (err) {
        console.error('Research error:', err.message);
        res.status(500).json({ error: 'Research failed. Please try again.', details: err.message });
    }
});

// Get conversation history
app.get('/api/conversation/:sessionId', async (req, res) => {
    try {
        const conv = await Conversation.findOne({ sessionId: req.params.sessionId });
        if (!conv) return res.status(404).json({ error: 'Session not found' });
        res.json(conv);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Clear session
app.delete('/api/session/:sessionId', async (req, res) => {
    try {
        await Conversation.deleteOne({ sessionId: req.params.sessionId });
        res.json({ message: 'Session cleared' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'CuraLink Node API' }));

app.listen(PORT, () => console.log(`CuraLink Node API running on port ${PORT}`));
