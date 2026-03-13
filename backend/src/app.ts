import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import reportRoutes from './routes/reports';
import settingsRoutes from './routes/settings';
import userRoutes from './routes/users';
import grainRoutes from './routes/grain';
import millingRoutes from './routes/milling';
import rawMaterialRoutes from './routes/rawMaterial';
import liquefactionRoutes from './routes/liquefaction';
import preFermentationRoutes from './routes/preFermentation';
import fermentationRoutes from './routes/fermentation';
import distillationRoutes from './routes/distillation';
import evaporationRoutes from './routes/evaporation';
import ethanolProductRoutes from './routes/ethanolProduct';
import ddgsRoutes from './routes/ddgs';
import dryerRoutes from './routes/dryer';
import decanterRoutes from './routes/decanter';
import calibrationRoutes from './routes/calibration';
import dispatchRoutes from './routes/dispatch';
import grainTruckRoutes from './routes/grainTruck';
import labSampleRoutes from './routes/labSample';
import ddgsStockRoutes from './routes/ddgsStock';
import ddgsDispatchRoutes from './routes/ddgsDispatch';
import dosingRecipeRoutes from './routes/dosingRecipes';

const app = express();

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.FRONTEND_URL || 'https://web-production-d305.up.railway.app']
    : true,
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/users', userRoutes);
app.use('/api/grain', grainRoutes);
app.use('/api/milling', millingRoutes);
app.use('/api/raw-material', rawMaterialRoutes);
app.use('/api/liquefaction', liquefactionRoutes);
app.use('/api/pre-fermentation', preFermentationRoutes);
app.use('/api/fermentation', fermentationRoutes);
app.use('/api/distillation', distillationRoutes);
app.use('/api/evaporation', evaporationRoutes);
app.use('/api/ethanol-product', ethanolProductRoutes);
app.use('/api/ddgs', ddgsRoutes);
app.use('/api/dryer', dryerRoutes);
app.use('/api/decanter', decanterRoutes);
app.use('/api/calibration', calibrationRoutes);
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/grain-truck', grainTruckRoutes);
app.use('/api/lab-sample', labSampleRoutes);
app.use('/api/ddgs-stock', ddgsStockRoutes);
app.use('/api/ddgs-dispatch', ddgsDispatchRoutes);
app.use('/api/dosing-recipes', dosingRecipeRoutes);

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 for unknown API routes (before SPA fallback)
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

export default app;
