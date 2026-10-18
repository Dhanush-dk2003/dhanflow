import { Router } from 'express';
import * as ctrl from '../controllers/ai.controller.js';
import { validate } from '../middleware/validate.js';
import { aiChatSchema } from '../validators/schemas.js';

const router = Router();

router.get('/status', ctrl.status);
router.post('/chat', validate({ body: aiChatSchema }), ctrl.chat);

export default router;
