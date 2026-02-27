import { env } from "./env.js";
import { buildServer } from "./server.js";

const app = buildServer();

app.listen(env.PORT, () => {
  console.log(`✅ BeautifulMind Backend running on http://localhost:${env.PORT}`);
});
