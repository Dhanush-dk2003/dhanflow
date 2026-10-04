// Removes the app lock (PIN/pattern) and signs out every device. Your money data is untouched.
// Usage: npm run reset-lock
import { connectDB, disconnectDB } from '../src/config/db.js';
import { AuthConfig, Session } from '../src/models/Auth.js';

try {
  await connectDB();
  const [{ deletedCount: configs }, { deletedCount: sessions }] = await Promise.all([
    AuthConfig.deleteMany({}),
    Session.deleteMany({}),
  ]);
  console.log(
    configs
      ? `App lock removed and ${sessions} session(s) signed out. Open DhanFlow to set a new PIN or pattern.`
      : 'No app lock was set, nothing to reset.',
  );
} catch (err) {
  console.error('Reset failed:', err.message);
  process.exitCode = 1;
} finally {
  await disconnectDB();
}
