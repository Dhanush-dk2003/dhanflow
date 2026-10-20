import { Router } from 'express';
import * as ctrl from '../controllers/split.controller.js';
import { validate } from '../middleware/validate.js';
import {
  debtListQuerySchema,
  debtParamSchema,
  participantParamSchema,
  payBodySchema,
  settleBodySchema,
  splitListQuerySchema,
} from '../validators/schemas.js';

const router = Router();

router.get('/', validate({ query: splitListQuerySchema }), ctrl.list);
router.get('/people', ctrl.people);
router.get('/debts', validate({ query: debtListQuerySchema }), ctrl.debts);
router.post('/settle', validate({ body: settleBodySchema }), ctrl.settle);

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

router.patch('/debts/:transactionId/pay', validate({ params: debtParamSchema, body: payBodySchema }), ctrl.payDebt);
router.patch('/debts/:transactionId/unpay', validate({ params: debtParamSchema }), ctrl.unpayDebt);

export default router;
