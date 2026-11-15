import 'server-only';
import { createHash } from 'crypto';
import mongoose, { Schema } from 'mongoose';
import connectDB from '@/lib/mongodb';

const schema = new Schema({ _id: String, count: { type: Number, default: 0 }, expiresAt: Date }, { versionKey: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Bucket = mongoose.models.SecurityRateBucket || mongoose.model('SecurityRateBucket', schema);

// Shared fixed-window counters survive worker restarts and concurrent serverless instances.
export async function consumeRateLimit(key: string, { limit, windowMs }: { limit: number; windowMs: number }) {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const id = createHash('sha256').update(`${key}:${windowStart}`).digest('hex');
  try {
    await connectDB();
    const result = await Bucket.findOneAndUpdate({ _id: id }, {
      $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(windowStart + windowMs * 2) },
    }, { upsert: true, new: true });
    return { allowed: result.count <= limit, retryAfter: Math.ceil((windowStart + windowMs - now) / 1000) };
  } catch {
    return { allowed: false, retryAfter: Math.ceil(windowMs / 1000) };
  }
}

export function requestIp(headers: { get(name: string): string | null }) {
  return (headers.get('x-vercel-forwarded-for') || headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().slice(0, 128);
}
