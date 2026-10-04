import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';
import { isProd } from '../config/env.js';

export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
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

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Malformed JSON body' });
  }

  console.error(err);
  return res.status(500).json({ message: isProd ? 'Internal server error' : err.message });
}
