import mongoose, { type Document, type Model, Schema } from "mongoose";

export type WebhookEventStatus = "received" | "processed" | "failed" | "ignored";

export interface IWebhookEvent extends Document {
  shopId: string;
  topic: string;
  webhookId: string;
  payloadHash: string;
  status: WebhookEventStatus;
  errorMessage?: string;
  receivedAt: Date;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const webhookEventSchema = new Schema<IWebhookEvent>(
  {
    shopId: { type: String, required: true, index: true },
    topic: { type: String, required: true, index: true },
    webhookId: { type: String, required: true },
    payloadHash: { type: String, required: true },
    status: {
      type: String,
      enum: ["received", "processed", "failed", "ignored"],
      default: "received",
      index: true,
    },
    errorMessage: { type: String },
    receivedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
  },
  { timestamps: true },
);

webhookEventSchema.index({ shopId: 1, webhookId: 1 }, { unique: true });
webhookEventSchema.index({ shopId: 1, receivedAt: -1 });

export const WebhookEvent: Model<IWebhookEvent> =
  mongoose.models.WebhookEvent ||
  mongoose.model<IWebhookEvent>("WebhookEvent", webhookEventSchema);
