import { Router } from 'express';
import multer from 'multer';
import * as ctrl from '../controllers/import.controller.js';
import { validate } from '../middleware/validate.js';
import { importCommitSchema, importPreviewSchema } from '../validators/schemas.js';
import { ApiError } from '../utils/ApiError.js';
import { ACCEPTED_EXTENSIONS } from '../services/file.reader.js';

const ACCEPTED_RX = new RegExp(`\\.(${ACCEPTED_EXTENSIONS.join('|')})$`, 'i');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, done) =>
    ACCEPTED_RX.test(file.originalname) || file.mimetype === 'application/pdf'
      ? done(null, true)
      : done(ApiError.badRequest('Upload a PDF, Excel (.xlsx/.xls), CSV, Word (.docx) or text file')),
});

const router = Router();

router.post('/preview', upload.single('file'), validate({ body: importPreviewSchema }), ctrl.preview);
router.post('/commit', validate({ body: importCommitSchema }), ctrl.commit);

export default router;
