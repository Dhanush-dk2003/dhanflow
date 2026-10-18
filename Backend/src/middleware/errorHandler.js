import mongoose from 'mongoose';
import multer from 'multer';
import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';
import { isProd } from '../config/env.js';

export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    const errors = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const first = errors[0];
    return res.status(400).json({
      message: first ? (first.path ? `${first.path}: ${first.message}` : first.message) : 'Invalid request',
      errors,
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.status).json({ message: err.message, ...err.extra });
  }

  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ message: `Invalid value for ${err.path}` });
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const first = Object.values(err.errors)[0];
    return res.status(400).json({ message: first?.message ?? 'Validation failed' });
  }

  if (err.code === 11000) {
    return res.status(409).json({ message: 'That already exists' });
  }

  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({ message: tooBig ? 'That file is too big (15 MB max)' : 'Upload one PDF at a time' });
  }

  if (err.type === 'entity.too.large') {
    const message = req.path.endsWith('/voice')
      ? 'Voice notes can be up to 1 MB (about 2 minutes)'
      : 'Too much data in one request. Import fewer entries at a time';
    return res.status(413).json({ message });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Malformed JSON body' });
  }

  console.error(err);
  return res.status(500).json({ message: isProd ? 'Internal server error' : err.message });
}
