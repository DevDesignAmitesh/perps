import os from "os";
import cluster from "cluster";
import { app } from ".";

const cpus = os.cpus().length;
const PORT = 4000;

if (process.env.NODE_ENV === "production") {
  if (cluster.isPrimary) {
    for (let i = 0; i < cpus; i++) {
      cluster.fork();
    }

    cluster.on("exit", () => cluster.fork());
  } else {
    app.listen(PORT, () => console.log("http-backend is running at ", PORT));
  }
} else {
  app.listen(PORT, () => console.log("http-backend is running at ", PORT));
}
