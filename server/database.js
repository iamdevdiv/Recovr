import mongoose from 'mongoose'

export async function connectDatabase() {
  const isProd = process.env.NODE_ENV === 'production';
  const uri = (isProd && process.env.MONGODB_URI_PROD) ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI;
  if (!uri) throw new Error(isProd ? 'MONGODB_URI_PROD or MONGODB_URI is required' : 'MONGODB_URI is required to start the secure API.');
  await mongoose.connect(uri)
  return mongoose.connection
}
