import { Router } from 'express';
import * as ctrl from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.js';
import { removeLockSchema, setupLockSchema, unlockSchema, updateLockSchema } from '../validators/schemas.js';

// Reachable while locked.
export const publicAuthRoutes = Router();
publicAuthRoutes.get('/status', ctrl.status);
publicAuthRoutes.post('/setup', validate({ body: setupLockSchema }), ctrl.setup);
publicAuthRoutes.post('/unlock', validate({ body: unlockSchema }), ctrl.unlock);
publicAuthRoutes.post('/lock', ctrl.lock);

// Mounted behind requireUnlocked.
export const protectedAuthRoutes = Router();
protectedAuthRoutes.patch('/settings', validate({ body: updateLockSchema }), ctrl.update);
protectedAuthRoutes.delete('/setup', validate({ body: removeLockSchema }), ctrl.remove);
