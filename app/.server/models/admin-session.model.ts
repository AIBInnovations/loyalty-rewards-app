import mongoose, { type Document, type Model, Schema } from "mongoose";

/**
 * Server-side admin sessions.
 *
 * The admin cookie previously carried {email, role} as a self-asserted claim
 * that was never validated against the database. That meant disabling or
 * deleting an admin did not end their session, role demotions did not take
 * effect, and logout only cleared the client copy — a stolen cookie stayed
 * valid for its full lifetime with no way to revoke it.
 *
 * Only a hash of the token is stored, so a database read does not yield
 * usable session credentials.
 */
export interface IAdminSession extends Document {
  tokenHash: string;
  adminUserId: mongoose.Types.ObjectId;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
}

const adminSessionSchema = new Schema<IAdminSession>({
  tokenHash: { type: String, required: true, unique: true },
  adminUserId: {
    type: Schema.Types.ObjectId,
    ref: "AdminUser",
    required: true,
    index: true,
  },
  ip: { type: String },
  userAgent: { type: String },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date },
});

// Let Mongo reap expired sessions rather than accumulating them forever.
adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AdminSessionModel: Model<IAdminSession> =
  mongoose.models.AdminSession ||
  mongoose.model<IAdminSession>("AdminSession", adminSessionSchema);
