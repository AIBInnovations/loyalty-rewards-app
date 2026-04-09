import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IReview extends Document {
  shopId: string;
  productId: string;
  customerId: string;
  authorName: string;
  authorEmail: string;
  rating: number;
  body: string;
  photoUrls: string[];
  videoUrl: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  updatedAt: Date;
}

export interface IQuestion extends Document {
  shopId: string;
  productId: string;
  question: string;
  answer: string;
  answered: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<IReview>(
  {
    shopId:      { type: String, required: true, index: true },
    productId:   { type: String, required: true, index: true },
    customerId:  { type: String, default: "" },
    authorName:  { type: String, default: "Customer" },
    authorEmail: { type: String, default: "" },
    rating:      { type: Number, required: true, min: 1, max: 5 },
    body:        { type: String, required: true },
    photoUrls:   { type: [String], default: [] },
    videoUrl:    { type: String, default: "" },
    status:      { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  },
  { timestamps: true },
);

const questionSchema = new Schema<IQuestion>(
  {
    shopId:    { type: String, required: true, index: true },
    productId: { type: String, required: true, index: true },
    question:  { type: String, required: true },
    answer:    { type: String, default: "" },
    answered:  { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Review: Model<IReview> =
  mongoose.models.Review ||
  mongoose.model<IReview>("Review", reviewSchema);

export const Question: Model<IQuestion> =
  mongoose.models.Question ||
  mongoose.model<IQuestion>("Question", questionSchema);
