import 'server-only';
import mongoose from 'mongoose';
import User from '@/models/user';
import Family from '@/models/family';
import connectDB from '@/lib/mongodb';
import type { IUser } from '@/models/types/personal/user';
import { matchesSession, profileUpdate } from './policy';

export async function updateProfile(actor: IUser, input: unknown) {
  const update = profileUpdate(input);
  await connectDB();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const user = await User.findById(actor._id).select('+sessionVersion').session(session);
      if (!matchesSession(user, {id: String(actor._id), sessionVersion: actor.sessionVersion})) throw new Error('Your session changed. Sign in again');
      await User.updateOne({_id: actor._id}, {$set: update}, {session, runValidators: true});
      if (update.name) {
        await Family.updateMany({deletedAt: null, 'familyMembers.familyMemberID': String(actor._id)},
          {$set: {'familyMembers.$[member].familyMemberName': update.name}},
          {session, arrayFilters: [{'member.familyMemberID': String(actor._id)}]});
      }
    });
  } finally { await session.endSession(); }
}
