import mongoose, { type Document, type Model, Schema } from "mongoose";

export type SyncJobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ISyncJob extends Document {
  shopId: string;
  jobType: string;
  objectId?: string;
  state: SyncJobState;
  attempts: number;
  errorMessage?: string;
  metadata: Record<string, unknown>;
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const syncJobSchema = new Schema<ISyncJob>(
  {
    shopId: { type: String, required: true, index: true },
    jobType: { type: String, required: true, index: true },
    objectId: { type: String },
    state: {
      type: String,
      enum: ["queued", "running", "completed", "failed", "cancelled"],
      default: "queued",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    errorMessage: { type: String },
    metadata: { type: Schema.Types.Mixed, default: {} },
    queuedAt: { type: Date, default: Date.now },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

syncJobSchema.index({ shopId: 1, state: 1, queuedAt: -1 });

export const SyncJob: Model<ISyncJob> =
  mongoose.models.SyncJob ||
  mongoose.model<ISyncJob>("SyncJob", syncJobSchema);
