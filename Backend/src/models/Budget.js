import mongoose from 'mongoose';

const { Schema } = mongoose;

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const categoryLimitSchema = new Schema(
  {
    category: { type: String, required: true, trim: true, maxlength: 40 },
    limit: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

// A budget applies to its month and every later month until a newer one is saved.
const budgetSchema = new Schema(
  {
    month: { type: String, required: true, unique: true, match: MONTH_PATTERN },
    total: { type: Number, required: true, min: 0 },
    categories: { type: [categoryLimitSchema], default: [] },
  },
  { timestamps: true, versionKey: false },
);

export const Budget = mongoose.model('Budget', budgetSchema);
