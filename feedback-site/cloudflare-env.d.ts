declare namespace Cloudflare {
  interface Env {
    ADMIN_TOKEN_HASH?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
