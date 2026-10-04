import { Router } from 'express';
import mongoose from 'mongoose';
import transactionRoutes from './transaction.routes.js';
import splitRoutes from './split.routes.js';
import advisorRoutes from './advisor.routes.js';
import accountRoutes from './account.routes.js';
import { protectedAuthRoutes, publicAuthRoutes } from './auth.routes.js';
import * as summaryCtrl from '../controllers/summary.controller.js';
import { validate } from '../middleware/validate.js';
import { requireUnlocked } from '../middleware/requireUnlocked.js';
import { summaryQuerySchema } from '../validators/schemas.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

router.use('/auth', publicAuthRoutes);

// Everything below needs an unlocked session once an app lock is set up.
router.use(requireUnlocked);

router.use('/auth', protectedAuthRoutes);
router.use('/transactions', transactionRoutes);
router.use('/splits', splitRoutes);
router.use('/accounts', accountRoutes);
router.get('/summary', validate({ query: summaryQuerySchema }), summaryCtrl.summary);
router.get('/categories', summaryCtrl.categories);
router.use(advisorRoutes);

export default router;
