import { Transaction } from '../models/Transaction.js';
import { VOICE_NOTE_MAX_BYTES, VoiceNote } from '../models/VoiceNote.js';
import { ApiError } from '../utils/ApiError.js';

export async function saveVoiceNote(transactionId, data, { mimeType, duration = 0, transcript = '' }) {
  if (!Buffer.isBuffer(data) || !data.length) throw ApiError.badRequest('The recording is empty');
  if (data.length > VOICE_NOTE_MAX_BYTES) throw ApiError.badRequest('Voice notes can be up to 1 MB (about 2 minutes)');
  if (!(await Transaction.exists({ _id: transactionId }))) throw ApiError.notFound('Transaction not found');

  const info = { duration: Math.round(duration * 10) / 10, transcript: transcript.trim(), size: data.length };
  await VoiceNote.findOneAndUpdate(
    { transaction: transactionId },
    { mimeType, data, ...info },
    { upsert: true, runValidators: true },
  );
  await Transaction.updateOne({ _id: transactionId }, { $set: { voiceNote: info } });
  return info;
}

export async function getVoiceNote(transactionId) {
  const note = await VoiceNote.findOne({ transaction: transactionId });
  if (!note) throw ApiError.notFound('No voice note on this entry');
  return note;
}

export async function deleteVoiceNote(transactionId) {
  await VoiceNote.deleteOne({ transaction: transactionId });
  await Transaction.updateOne({ _id: transactionId }, { $unset: { voiceNote: 1 } });
}
