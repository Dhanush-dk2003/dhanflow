import mongoose from 'mongoose';

const { Schema } = mongoose;

// A transfer moves money between two of my own accounts: it changes account balances
// but is neither income nor spending.
export const TRANSACTION_TYPES = ['credit', 'debit', 'transfer'];
export const PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank', 'other'];
export const SPLIT_REPAYMENT_CATEGORY = 'Split Repayment';
export const TRANSFER_CATEGORY = 'Transfer';

const participantSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  amount: { type: Number, required: true, min: 0.01 },
  isPaid: { type: Boolean, default: false },
  paidAt: { type: Date, default: null },
  settlementTxn: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
});

const settlementSchema = new Schema(
  {
    transaction: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true },
    participant: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const transactionSchema = new Schema(
  {
    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    category: { type: String, required: true, trim: true, maxlength: 40 },
    description: { type: String, trim: true, maxlength: 200, default: '' },
    date: { type: Date, required: true, default: Date.now },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'upi' },
    // null = not linked to an account (entries created before accounts existed).
    // For transfers this is the source account.
    account: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    toAccount: { type: Schema.Types.ObjectId, ref: 'Account', default: undefined },
    // People who owe me a part of this (debit) transaction.
    participants: { type: [participantSchema], default: [] },
    // Present only on credit entries auto-created when a split participant pays back.
    settlementOf: { type: settlementSchema, default: undefined },
  },
  { timestamps: true, versionKey: false },
);

transactionSchema.index({ date: -1, _id: -1 });
transactionSchema.index({ type: 1, date: -1 });
transactionSchema.index({ category: 1, date: -1 });
transactionSchema.index({ account: 1, date: -1 });
transactionSchema.index({ toAccount: 1 }, { sparse: true });
transactionSchema.index({ 'participants.isPaid': 1 });
transactionSchema.index({ 'settlementOf.transaction': 1 }, { sparse: true });

export const Transaction = mongoose.model('Transaction', transactionSchema);
