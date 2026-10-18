import mongoose from 'mongoose';

// "Payments to this merchant/person are <category>", learned from imports you confirmed.
const categoryRuleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 60 },
    type: { type: String, enum: ['credit', 'debit'], required: true },
    category: { type: String, required: true, trim: true, maxlength: 40 },
    uses: { type: Number, default: 1 },
  },
  { timestamps: true, versionKey: false },
);

categoryRuleSchema.index({ key: 1, type: 1 }, { unique: true });

export const CategoryRule = mongoose.model('CategoryRule', categoryRuleSchema);
