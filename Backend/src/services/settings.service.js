import { Settings } from '../models/Settings.js';

const ID = 'app';
const upsertOptions = { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, runValidators: true };

let cache = null;

export async function getSettings() {
  cache ??= await Settings.findOneAndUpdate({ _id: ID }, { $setOnInsert: { name: 'Dhanush' } }, upsertOptions).lean();
  return cache;
}

export async function updateSettings(patch) {
  cache = await Settings.findOneAndUpdate({ _id: ID }, { $set: patch }, upsertOptions).lean();
  return cache;
}
