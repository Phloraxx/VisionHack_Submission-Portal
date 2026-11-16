// This file runs before each test file.
// Set up default env values so getEnv() doesn't throw in tests
// An in-memory database keeps every test file isolated and leaves no file behind.
process.env.SQLITE_PATH = process.env.SQLITE_PATH ?? ":memory:";
process.env.APP_JWT_SECRET =
	process.env.APP_JWT_SECRET ?? "test-secret-0123456789abcdef0123456789abcdef";
process.env.UPLOADS_DIR = process.env.UPLOADS_DIR ?? "/tmp/vh-uploads-test";
