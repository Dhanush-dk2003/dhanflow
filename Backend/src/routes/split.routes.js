import { Router } from 'express';
import * as ctrl from '../controllers/split.controller.js';
import { validate } from '../middleware/validate.js';
import { participantParamSchema, payBodySchema, splitListQuerySchema } from '../validators/schemas.js';

const router = Router();

router.get('/', validate({ query: splitListQuerySchema }), ctrl.list);
router.get('/people', ctrl.people);

router.patch(
  '/:transactionId/participants/:participantId/pay',
  validate({ params: participantParamSchema, body: payBodySchema }),
  ctrl.pay,
);
router.patch(
  '/:transactionId/participants/:participantId/unpay',
  validate({ params: participantParamSchema }),
  ctrl.unpay,
);

export default router;
