import express, { Router } from 'express';
import * as ctrl from '../controllers/transaction.controller.js';
import { validate } from '../middleware/validate.js';
import {
  createTransactionSchema,
  idParamSchema,
  listQuerySchema,
  updateTransactionSchema,
  voiceNoteQuerySchema,
} from '../validators/schemas.js';

const router = Router();

router
  .route('/')
  .get(validate({ query: listQuerySchema }), ctrl.list)
  .post(validate({ body: createTransactionSchema }), ctrl.create);

router.get('/export', validate({ query: listQuerySchema }), ctrl.exportExcel);

router
  .route('/:id')
  .get(validate({ params: idParamSchema }), ctrl.getOne)
  .patch(validate({ params: idParamSchema, body: updateTransactionSchema }), ctrl.update)
  .delete(validate({ params: idParamSchema }), ctrl.remove);

router
  .route('/:id/voice')
  .get(validate({ params: idParamSchema }), ctrl.getVoice)
  .put(
    express.raw({ type: 'audio/*', limit: '1mb' }),
    validate({ params: idParamSchema, query: voiceNoteQuerySchema }),
    ctrl.saveVoice,
  )
  .delete(validate({ params: idParamSchema }), ctrl.removeVoice);

export default router;
