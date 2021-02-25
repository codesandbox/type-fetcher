import express from "express";
import respond, { prepareTypingsFolder } from "./typings";

const app = express();
app.use(respond);

const port = process.env.PORT || 8080

prepareTypingsFolder("/tmp/typings").then(() => {
  app.listen(port, () => {
    console.log(`Listening on ${port}!`);
  });
});
