import mongoose from 'mongoose';

// Extend global type to include mongoose cache
declare global {
  var mongoose: {
    conn: mongoose.Mongoose | null;
    promise: Promise<mongoose.Mongoose> | null;
  } | undefined;
}

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error('Please define the MONGODB_URI environment variable inside .env.local');
}

// Initialize the global mongoose cache
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

export async function connectDB(): Promise<mongoose.Mongoose> {
  // Return existing connection if available
  if (cached!.conn) {
    return cached!.conn;
  }

  // Create new connection promise if none exists
  if (!cached!.promise) {
    const opts: mongoose.ConnectOptions = {
      bufferCommands: false,
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      family: 4 // Use IPv4, skip trying IPv6
    };

    cached!.promise = mongoose.connect(MONGODB_URI!, opts).then((mongoose) => {
      console.log('✅ Connected to MongoDB');
      return mongoose;
    });
  }

  try {
    cached!.conn = await cached!.promise;
  } catch (e) {
    cached!.promise = null;
    console.error('❌ MongoDB connection error:', e);
    throw e;
  }

  return cached!.conn;
}

// Graceful disconnection
export async function disconnectDB(): Promise<void> {
  try {
    if (cached?.conn) {
      await cached.conn.connection.close();
      cached.conn = null;
      cached.promise = null;
      console.log('✅ Disconnected from MongoDB');
    }
  } catch (error) {
    console.error('❌ Error disconnecting from MongoDB:', error);
    throw error;
  }
}

// Check connection status
export function isConnected(): boolean {
  return cached?.conn?.connection?.readyState === 1;
}

// Get connection status string
export function getConnectionStatus(): string {
  const state = cached?.conn?.connection?.readyState;
  switch (state) {
    case 0:
      return 'disconnected';
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    default:
      return 'unknown';
  }
}

// Handle connection events
if (typeof window === 'undefined') { // Only on server side
  mongoose.connection.on('connected', () => {
    console.log('📡 Mongoose connected to MongoDB');
  });

  mongoose.connection.on('error', (err) => {
    console.error('❌ Mongoose connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.log('📴 Mongoose disconnected from MongoDB');
  });

  // Handle app termination
  process.on('SIGINT', async () => {
    try {
      await disconnectDB();
      process.exit(0);
    } catch (error) {
      console.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  });
}