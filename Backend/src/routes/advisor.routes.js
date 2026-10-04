import { Router } from 'express';
import * as ctrl from '../controllers/advisor.controller.js';
import { validate } from '../middleware/validate.js';
import {
  budgetBodySchema,
  idParamSchema,
  monthParamSchema,
  notificationQuerySchema,
  settingsBodySchema,
} from '../validators/schemas.js';

const router = Router();

router
  .route('/budgets/:month')
  .get(validate({ params: monthParamSchema }), ctrl.budgetStatus)
  .put(validate({ params: monthParamSchema, body: budgetBodySchema }), ctrl.saveBudget)
  .delete(validate({ params: monthParamSchema }), ctrl.deleteBudget);

router.get('/notifications', validate({ query: notificationQuerySchema }), ctrl.listNotifications);
router.post('/notifications/check', ctrl.runChecks);
router.patch('/notifications/read-all', ctrl.readAllNotifications);
router.delete('/notifications/read', ctrl.clearReadNotifications);
router.patch('/notifications/:id/read', validate({ params: idParamSchema }), ctrl.readNotification);
router.delete('/notifications/:id', validate({ params: idParamSchema }), ctrl.deleteNotification);

router.get('/insights', ctrl.insights);

router
  .route('/settings')
  .get(ctrl.getSettings)
  .patch(validate({ body: settingsBodySchema }), ctrl.updateSettings);

export default router;
