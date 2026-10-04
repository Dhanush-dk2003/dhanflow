import app from './app.js';
import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { startScheduler, stopScheduler } from './scheduler.js';

async function start() {
  try {
    await connectDB();
  } catch (err) {
    console.error(`Failed to connect to MongoDB at ${env.mongoUri}:`, err.message);
    process.exit(1);
  }

  const server = app.listen(env.port, (err) => {
    if (err) {
      const hint = err.code === 'EADDRINUSE' ? ' (port already in use — stop the other process or change PORT in .env)' : '';
      console.error(`Failed to start server on port ${env.port}: ${err.message}${hint}`);
      process.exit(1);
    }
    console.log(`API running on http://localhost:${env.port}/api`);
    startScheduler();
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down...`);
    stopScheduler();
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
