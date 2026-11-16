// This file runs before each test file.
// Set up default env values so getEnv() doesn't throw in tests
process.env.DATABASE_URL =
	process.env.DATABASE_URL ?? "postgres://visionhack:test@localhost:5432/visionhack_test?sslmode=disable";
process.env.APP_JWT_SECRET =
	process.env.APP_JWT_SECRET ?? "test-secret-0123456789abcdef0123456789abcdef";
process.env.UPLOADS_DIR = process.env.UPLOADS_DIR ?? "/tmp/vh-uploads-test";
