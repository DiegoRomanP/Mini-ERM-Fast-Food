import 'dotenv/config';

process.env.NODE_ENV = 'test';

process.env.JWT_SECRET = 'test-jwt-secret-dummy-value-at-least-32-chars-long';
process.env.COOKIE_SECRET = 'test-cookie-secret-dummy-value-at-least-32-chars-long';

if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}
