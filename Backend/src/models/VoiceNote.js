import mongoose from 'mongoose';

const { Schema } = mongoose;

export const VOICE_NOTE_MAX_BYTES = 1024 * 1024;
export const VOICE_NOTE_MAX_SECONDS = 120;

// The recording lives apart from its transaction so lists and reports never load audio.
const voiceNoteSchema = new Schema(
  {
    transaction: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true, unique: true },
    mimeType: { type: String, required: true, maxlength: 80 },
    data: { type: Buffer, required: true },
    duration: { type: Number, min: 0, max: VOICE_NOTE_MAX_SECONDS, default: 0 },
    transcript: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true, versionKey: false },
);

export const VoiceNote = mongoose.model('VoiceNote', voiceNoteSchema);
