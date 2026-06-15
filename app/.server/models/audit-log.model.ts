import mongoose, { type Document, type Model, Schema } from "mongoose";

export type AuditActorType = "super_admin" | "merchant" | "system" | "webhook";

export interface IAuditLog extends Document {
  actorType: AuditActorType;
  actorId: string;
  shopId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorType: {
      type: String,
      enum: ["super_admin", "merchant", "system", "webhook"],
      required: true,
      index: true,
    },
    actorId: { type: String, required: true },
    shopId: { type: String, index: true },
    action: { type: String, required: true, index: true },
    targetType: { type: String, required: true },
    targetId: { type: String },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ shopId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export const AuditLog: Model<IAuditLog> =
  mongoose.models.AuditLog ||
  mongoose.model<IAuditLog>("AuditLog", auditLogSchema);

export async function recordAuditLog(input: {
  actorType: AuditActorType;
  actorId: string;
  shopId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) {
  return AuditLog.create({
    actorType: input.actorType,
    actorId: input.actorId,
    shopId: input.shopId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata || {},
  });
}
