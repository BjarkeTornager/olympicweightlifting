// Run the same standalone server packaged for Railway, including the offline shell.
process.env.HOSTNAME = process.env.APP_HOST ?? "127.0.0.1";
await import("../.next/standalone/server.js");
