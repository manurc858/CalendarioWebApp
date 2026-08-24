// Función serverless de Vercel: recibe todo lo reescrito desde /api/* (ver
// vercel.json) y delega en la app Express existente en server/index.js.
import app from '../server/index.js';

export default app;
