import { config } from "dotenv";
config({ path: ".env.test", quiet: true });
config({ quiet: true });
process.env.TZ = "UTC";
