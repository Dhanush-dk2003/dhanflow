import mongoose from 'mongoose';

const { Schema } = mongoose;

export const NOTIFICATION_TYPES = ['budget', 'overdue', 'month_end', 'info'];
export const SEVERITIES = ['info', 'success', 'warning', 'danger'];

const notificationSchema = new Schema(
  {
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    severity: { type: String, enum: SEVERITIES, default: 'info' },
    title: { type: String, required: true, maxlength: 200 },
    message: { type: String, default: '', maxlength: 1000 },
    // Dedupe key: the same reminder is never created twice.
    key: { type: String, required: true, unique: true },
    data: { type: Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

notificationSchema.index({ read: 1, createdAt: -1 });
notificationSchema.index({ type: 1, 'data.participantId': 1 });

export const Notification = mongoose.model('Notification', notificationSchema);
