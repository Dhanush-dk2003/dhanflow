import { Router } from 'express';
import * as ctrl from '../controllers/account.controller.js';
import { validate } from '../middleware/validate.js';
import { createAccountSchema, idParamSchema, updateAccountSchema } from '../validators/schemas.js';

const router = Router();

router.route('/').get(ctrl.list).post(validate({ body: createAccountSchema }), ctrl.create);

router
  .route('/:id')
  .patch(validate({ params: idParamSchema, body: updateAccountSchema }), ctrl.update)
  .delete(validate({ params: idParamSchema }), ctrl.remove);

router.post('/:id/assign-unassigned', validate({ params: idParamSchema }), ctrl.assignUnassigned);

export default router;
