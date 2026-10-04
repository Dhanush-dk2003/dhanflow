import mongoose from 'mongoose';

const { Schema } = mongoose;

export const LOCK_METHODS = ['pin', 'pattern'];

// Single document: the app lock secret is stored only as a salted scrypt hash.
const authConfigSchema = new Schema(
  {
    _id: { type: String, default: 'app' },
    method: { type: String, enum: LOCK_METHODS, required: true },
    hash: { type: String, required: true },
    salt: { type: String, required: true },
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

// Only a SHA-256 of the session token is stored, so a DB dump can't be replayed as a cookie.
const sessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    userAgent: { type: String, maxlength: 300, default: '' },
  },
  { timestamps: true, versionKey: false },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthConfig = mongoose.model('AuthConfig', authConfigSchema);
export const Session = mongoose.model('Session', sessionSchema);
