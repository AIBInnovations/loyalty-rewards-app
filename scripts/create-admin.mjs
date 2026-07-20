#!/usr/bin/env node
/**
 * Create or update an admin user.
 *
 * This replaces the previous auto-seeding bootstrap, which ran on every login
 * attempt and created a super_admin with the credentials admin / admin123 when
 * ADMIN_USERNAME / ADMIN_PASSWORD were unset.
 *
 * Usage:
 *   node scripts/create-admin.mjs <email> <role>
 *
 * The password is read from stdin so it never lands in shell history or the
 * process list. Roles: super_admin | operations_admin | support_admin | billing_admin
 */
import crypto from "node:crypto";
import readline from "node:readline";
import mongoose from "mongoose";

const ROLES = [
  "super_admin",
  "operations_admin",
  "support_admin",
  "billing_admin",
];

const MIN_PASSWORD_LENGTH = 12;

function hashAdminPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 210000, 32, "sha256")
    .toString("hex");
  return `${salt}:${hash}`;
}

function prompt(question, { silent = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(
        new Error(
          "Refusing to run non-interactively — a password must be typed, not scripted.",
        ),
      );
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    if (silent) {
      // Suppress echo while the password is typed.
      const onData = (char) => {
        if (["\n", "\r", ""].includes(char.toString())) {
          process.stdin.removeListener("data", onData);
        } else {
          process.stdout.write("\x1b[2K\x1b[200D" + question + "*".repeat(rl.line.length));
        }
      };
      process.stdin.on("data", onData);
    }

    rl.question(question, (answer) => {
      rl.close();
      if (silent) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const [email, role] = process.argv.slice(2);

  if (!email || !role) {
    console.error("Usage: node scripts/create-admin.mjs <email> <role>");
    console.error(`Roles: ${ROLES.join(" | ")}`);
    process.exit(1);
  }

  if (!ROLES.includes(role)) {
    console.error(`Invalid role "${role}". Must be one of: ${ROLES.join(", ")}`);
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set.");
    process.exit(1);
  }

  const password = await prompt("Password: ", { silent: true });
  const confirm = await prompt("Confirm password: ", { silent: true });

  if (password !== confirm) {
    console.error("Passwords do not match.");
    process.exit(1);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }

  await mongoose.connect(uri);

  const AdminUser =
    mongoose.models.AdminUser ||
    mongoose.model(
      "AdminUser",
      new mongoose.Schema(
        {
          email: { type: String, required: true, unique: true, lowercase: true },
          name: String,
          passwordHash: String,
          role: { type: String, enum: ROLES },
          status: { type: String, default: "active" },
          allowedShops: { type: [String], default: [] },
          lastLoginAt: Date,
        },
        { timestamps: true },
      ),
    );

  const normalized = email.trim().toLowerCase();
  const existing = await AdminUser.findOne({ email: normalized });

  await AdminUser.findOneAndUpdate(
    { email: normalized },
    {
      $set: {
        passwordHash: hashAdminPassword(password),
        role,
        status: "active",
      },
      $setOnInsert: { name: normalized, allowedShops: [] },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );

  console.log(
    existing
      ? `Updated admin ${normalized} (role: ${role}).`
      : `Created admin ${normalized} (role: ${role}).`,
  );

  if (role !== "super_admin") {
    console.log(
      "Note: allowedShops is empty, so this admin can access no shops yet. " +
        "Assign shops in the admin panel.",
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
