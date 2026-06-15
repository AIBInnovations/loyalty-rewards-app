import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const output = execFileSync(
  "git",
  ["ls-files", "app/routes", "app/.server"],
  { cwd: root, encoding: "utf8" },
);

const allowedGlobalReads = [
  "app/routes/admin._index.tsx",
  "app/routes/public.config.tsx",
];

const riskyPatterns = [
  /\.findById(?:AndUpdate|AndDelete)?\(/,
  /\.findOne\(\{\s*idempotencyKey/,
  /\.deleteMany\(\{\s*customerId/,
  /\.find\(\{\}\)/,
  /\.findOne\(\{\}\)/,
];

let failed = false;

for (const file of output.split(/\r?\n/).filter(Boolean)) {
  const content = readFileSync(join(root, file), "utf8");
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (
      allowedGlobalReads.includes(file) &&
      (line.includes(".find({})") || line.includes("FeatureFlag.find({})"))
    ) {
      return;
    }

    if (riskyPatterns.some((pattern) => pattern.test(line))) {
      failed = true;
      console.error(`${file}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (failed) {
  console.error("\nTenant isolation audit failed.");
  process.exit(1);
}

console.log("Tenant isolation audit passed.");
