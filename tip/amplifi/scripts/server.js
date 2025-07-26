// src/server.js
import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
// Make sure to import the new image handler
import { getFrame, transactionFrame, webhook, getConfirmImage } from '../../amplifi/src/api/api';

config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Routes
app.get('/', (req, res) => res.send('GM, TipCast server is running!'));
app.post('/api/webhook', webhook);
app.get('/api/frame', getFrame); 
app.post('/api/transaction', transactionFrame);
// Add the new image route
app.get('/api/image/confirm', getConfirmImage); 

app.listen(PORT, () => {
  console.log(`🚀 TipCast server is running on port ${PORT}`);
});

export default app;