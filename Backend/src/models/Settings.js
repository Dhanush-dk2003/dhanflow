import mongoose from 'mongoose';

const { Schema } = mongoose;

const settingsSchema = new Schema(
  {
    _id: { type: String, default: 'app' },
    name: { type: String, trim: true, maxlength: 40, default: 'Dhanush' },
    reminderAfterDays: { type: Number, min: 1, max: 60, default: 7 },
    monthEndReminder: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);

export const Settings = mongoose.model('Settings', settingsSchema);
