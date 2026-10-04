import mongoose from 'mongoose';

const { Schema } = mongoose;

export const ACCOUNT_TYPES = ['bank', 'cash', 'wallet', 'card', 'other'];
export const ACCOUNT_COLORS = ['lime', 'aqua', 'orchid', 'rose', 'amber', 'sky', 'emerald', 'orange'];

const accountSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    type: { type: String, enum: ACCOUNT_TYPES, default: 'bank' },
    // Money already in the account before its first tracked entry. Negative for card dues.
    openingBalance: { type: Number, default: 0 },
    color: { type: String, enum: ACCOUNT_COLORS, default: 'lime' },
    isDefault: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

accountSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export const Account = mongoose.model('Account', accountSchema);
