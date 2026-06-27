// This file runs before each test file.
// Set up default env values so getEnv() doesn't throw in tests
process.env.POCKETBASE_URL = process.env.POCKETBASE_URL ?? "http://localhost:8090";
