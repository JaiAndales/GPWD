import "dotenv/config";
import app from "./app.js";
import { initializeRegistryStore } from "./registryStore.js";

const port = Number(process.env.PORT) || 4000;

async function startServer() {
  await initializeRegistryStore();
  app.listen(port, () => {
    console.log(`Gun-ob PWD API listening on http://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error("Could not start Gun-ob PWD API:", error.message);
  process.exitCode = 1;
});