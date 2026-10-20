import mongoose from 'mongoose';

const { Schema } = mongoose;

const settingsSchema = new Schema(
  {
    _id: { type: String, default: 'app' },
    name: { type: String, trim: true, maxlength: 40, default: 'Dhanush' },
    reminderAfterDays: { type: Number, min: 1, max: 60, default: 7 },
    monthEndReminder: { type: Boolean, default: true },
    // Categories I added myself, offered in the entry form and budget even before they're used.
    customCategories: {
      debit: { type: [{ type: String, trim: true, maxlength: 40 }], default: [] },
      credit: { type: [{ type: String, trim: true, maxlength: 40 }], default: [] },
    },
  },
  { timestamps: true, versionKey: false },
);

export const Settings = mongoose.model('Settings', settingsSchema);
