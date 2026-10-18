import { Router } from 'express';
import * as ctrl from '../controllers/report.controller.js';
import { validate } from '../middleware/validate.js';
import { reportParamSchema, reportQuerySchema } from '../validators/schemas.js';

const router = Router();

router.get('/:report', validate({ params: reportParamSchema, query: reportQuerySchema }), ctrl.report);

export default router;
