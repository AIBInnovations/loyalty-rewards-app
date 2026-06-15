import mongoose, { type Document, type Model, Schema } from "mongoose";

export type AdminRole =
  | "super_admin"
  | "operations_admin"
  | "support_admin"
  | "billing_admin";

export interface IAdminUser extends Document {
  email: string;
  name: string;
  passwordHash: string;
  role: AdminRole;
  status: "active" | "disabled";
  allowedShops: string[];
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const adminUserSchema = new Schema<IAdminUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: "" },
    passwordHash: { type: String, default: "" },
    role: {
      type: String,
      enum: ["super_admin", "operations_admin", "support_admin", "billing_admin"],
      default: "support_admin",
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
      index: true,
    },
    allowedShops: { type: [String], default: [] },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

export const AdminUser: Model<IAdminUser> =
  mongoose.models.AdminUser ||
  mongoose.model<IAdminUser>("AdminUser", adminUserSchema);
